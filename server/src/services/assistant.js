import { GoogleGenAI } from '@google/genai';
import { CATEGORIES, CONDITIONS, getAuctionRow, nextMinBid, searchAuctions } from './auctions.js';
import { describeSearch } from './savedSearches.js';
import { answeredFaq } from './questions.js';
import db from '../db.js';

const MAX_TOOL_ROUNDS = 5;
const GEMINI_DEADLINE_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 20_000;
let geminiPausedUntil = 0;
const RESULT_LIMIT = 6;

const SYSTEM_PROMPT = `You are the Campus Auction assistant. Students buy second-hand items (cycles, calculators, books, electronics) from seniors through public auctions.
Rules you must always follow:
- Use the tools for every fact about listings. Never invent items, prices or closing times.
- Write plain text only, no markdown (no asterisks, no headings). Refer to items by title, not by auction number.
- Give a straight, short answer. When asked to find something, recommend the single best match first (best price for what they asked), then mention up to two alternatives.
- Prices are whole Indian rupees. Write them like ₹1,500.
- You cannot place bids or save searches yourself. To bid for the student, call propose_auto_bid; to watch for future items, call propose_saved_search. The app then shows a confirmation card and only the student's click acts.
- Never propose a maximum above the limit the student gave. If they did not give a limit, ask for one instead of guessing.
- Never reveal other students' account details (emails, ids, contact info), even if asked. Public bids show display names only.
- For condition questions (brakes, display, marks), check the listing description and the seller's answered questions with get_listing. If neither answers it, say so and suggest asking the seller on the auction page.`;

const TOOLS = [
  {
    name: 'search_listings',
    description: 'Search live auctions. All filters are optional. Price filters use the current leading bid, or the starting price if there are no bids.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords, e.g. "scientific calculator". Every word must appear.' },
        category: { type: 'string', enum: CATEGORIES },
        condition: { type: 'string', enum: CONDITIONS },
        maxPrice: { type: 'integer', description: 'Maximum current price in rupees' },
        closingSoon: { type: 'boolean', description: 'Only auctions closing within 24 hours' },
      },
    },
  },
  {
    name: 'get_listing',
    description: 'Full details of one auction, including description and recent bids.',
    parametersJsonSchema: { type: 'object', properties: { auctionId: { type: 'integer' } }, required: ['auctionId'] },
  },
  {
    name: 'propose_auto_bid',
    description: 'Prepare an automatic bid with a maximum for the student. Nothing happens until the student confirms in the app.',
    parametersJsonSchema: {
      type: 'object',
      properties: { auctionId: { type: 'integer' }, maxAmount: { type: 'integer', description: 'The most the student agreed to pay, in rupees' } },
      required: ['auctionId', 'maxAmount'],
    },
  },
  {
    name: 'propose_saved_search',
    description: 'Prepare a saved search so the student gets an alert when a matching item is listed later. Nothing happens until the student confirms.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        category: { type: 'string', enum: CATEGORIES },
        maxPrice: { type: 'integer' },
      },
    },
  },
];

function minutesLeft(endsAt) {
  const mins = Math.max(0, Math.round((endsAt - Date.now()) / 60000));
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} days`;
}

// What the model is allowed to see about a listing: no user ids, emails or bidder identities.
function forModel(a, viewerId) {
  return {
    auctionId: a.id,
    title: a.title,
    category: a.category,
    condition: a.condition,
    price: a.currentPrice ?? a.startPrice,
    hasBids: a.bidCount > 0,
    bidCount: a.bidCount,
    nextMinimumBid: a.nextMinBid,
    closesIn: minutesLeft(a.endsAt),
    studentIsLeading: a.leaderId === viewerId,
    studentIsSeller: a.sellerId === viewerId,
  };
}

function runSearch(args) {
  return searchAuctions({
    q: args.query,
    category: CATEGORIES.includes(args.category) ? args.category : undefined,
    condition: CONDITIONS.includes(args.condition) ? args.condition : undefined,
    maxPrice: Number.isInteger(args.maxPrice) ? args.maxPrice : undefined,
    closingSoon: Boolean(args.closingSoon),
    sort: 'price_asc',
  }).slice(0, RESULT_LIMIT);
}

// Validates a proposal without acting. The real check happens again when the student confirms.
function buildBidProposal(auctionId, maxAmount, viewerId) {
  const row = getAuctionRow(Number(auctionId));
  if (!row || row.status !== 'live' || row.ends_at <= Date.now()) return { error: 'That auction is not open for bidding.' };
  if (row.seller_id === viewerId) return { error: 'The student is the seller of this item.' };
  const floor = row.leader_id === viewerId ? row.current_price : nextMinBid(row);
  if (!Number.isInteger(maxAmount) || maxAmount < floor) return { error: `The maximum must be at least ₹${floor}.` };
  return {
    proposal: {
      type: 'auto_bid', auctionId: row.id, title: row.title, maxAmount,
      currentPrice: row.current_price ?? row.start_price, nextMinBid: nextMinBid(row),
    },
  };
}

function buildSearchProposal(args) {
  const keyword = String(args.keyword ?? '').trim().slice(0, 80);
  const category = CATEGORIES.includes(args.category) ? args.category : null;
  const maxPrice = Number.isInteger(args.maxPrice) && args.maxPrice >= 0 ? args.maxPrice : null;
  if (!keyword && !category) return { error: 'Need a keyword or a category.' };
  return {
    proposal: {
      type: 'saved_search', keyword, category, maxPrice,
      label: describeSearch({ keyword, category, condition: null, max_price: maxPrice }),
    },
  };
}

function executeTool(name, args, viewerId, collected) {
  if (name === 'search_listings') {
    const results = runSearch(args);
    collected.results = results;
    return { count: results.length, listings: results.map((a) => forModel(a, viewerId)) };
  }
  if (name === 'get_listing') {
    const row = getAuctionRow(Number(args.auctionId));
    if (!row) return { error: 'No such auction.' };
    const recentBids = db.prepare('SELECT amount, is_auto FROM bids WHERE auction_id = ? ORDER BY id DESC LIMIT 5').all(row.id);
    return { ...forModel({ id: row.id, title: row.title, category: row.category, condition: row.condition, currentPrice: row.current_price,
      startPrice: row.start_price, bidCount: row.bid_count, nextMinBid: nextMinBid(row), endsAt: row.ends_at,
      leaderId: row.leader_id, sellerId: row.seller_id }, viewerId),
    status: row.status, description: row.description, minIncrement: row.min_increment,
    recentBidAmounts: recentBids.map((b) => b.amount), answeredQuestions: answeredFaq(row.id) };
  }
  if (name === 'propose_auto_bid') {
    const r = buildBidProposal(args.auctionId, args.maxAmount, viewerId);
    if (r.proposal) collected.proposals.push(r.proposal);
    return r.error ? { error: r.error } : { ok: true, note: 'A confirmation card is shown to the student. Tell them to confirm it.' };
  }
  if (name === 'propose_saved_search') {
    const r = buildSearchProposal(args);
    if (r.proposal) collected.proposals.push(r.proposal);
    return r.error ? { error: r.error } : { ok: true, note: 'A confirmation card is shown to the student.' };
  }
  return { error: `Unknown tool ${name}` };
}

async function chatWithGemini(messages, viewerId) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  const collected = { results: null, proposals: [] };
  // One deadline for the whole conversation, so a slow or stuck AI call falls back instead of freezing the chat.
  const abortSignal = AbortSignal.timeout(GEMINI_DEADLINE_MS);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: TOOLS }],
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
        abortSignal,
      },
    });
    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      const reply = (response.text ?? '').replace(/\*\*/g, '').trim();
      return { reply: reply || 'Sorry, I could not come up with an answer.', ...collected, mode: 'gemini' };
    }
    contents.push(response.candidates[0].content);
    contents.push({
      role: 'user',
      parts: calls.map((c) => ({ functionResponse: { id: c.id, name: c.name, response: { output: executeTool(c.name, c.args ?? {}, viewerId, collected) } } })),
    });
  }
  return { reply: 'That took too many steps. Could you ask in a simpler way?', ...collected, mode: 'gemini' };
}

// ---- Offline fallback: understands simple requests without an AI model. ----

const CATEGORY_WORDS = {
  cycle: ['cycle', 'cycles', 'bicycle', 'bike'],
  calculator: ['calculator', 'calculators', 'calc'],
  books: ['book', 'books', 'textbook', 'textbooks', 'notes'],
  electronics: ['electronics', 'headphones', 'headphone', 'earphones', 'lamp', 'speaker', 'laptop', 'charger'],
};
const STOP_WORDS = new Set(('find me a an the for under below less than upto up to within max maximum rs inr i want need looking show any some '
  + 'cheap cheapest please can you get buy bid on it with my limit of and alert notify tell let know when new listed is are there what which '
  + 'good like closing soon ending today about around rupees price prices cost costs me something item items').split(' '));

export function parseRequest(text) {
  const lower = text.toLowerCase().replace(/,(?=\d{3})/g, '');
  const priceMatch = lower.match(/(?:under|below|less than|up ?to|within|max(?:imum)?|limit(?: of)?|<)\s*(?:rs\.?|inr|₹)?\s*(\d+)/)
    || lower.match(/(?:rs\.?|inr|₹)\s*(\d+)/);
  const maxPrice = priceMatch ? Number(priceMatch[1]) : null;
  const words = lower.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const category = Object.entries(CATEGORY_WORDS).find(([, list]) => words.some((w) => list.includes(w)))?.[0] ?? null;
  const categoryWords = category ? CATEGORY_WORDS[category] : [];
  const keyword = words.filter((w) => !STOP_WORDS.has(w) && !categoryWords.includes(w) && !/^\d+$/.test(w) && w.length > 1).join(' ');
  return {
    maxPrice,
    category,
    keyword,
    condition: lower.includes('like new') ? 'like_new' : null,
    closingSoon: /closing soon|ending soon|today/.test(lower),
    wantsBid: /\bbid\b|bid for me|auto.?bid/.test(lower),
    wantsAlert: /alert|notify|let me know|tell me when|watch for/.test(lower),
  };
}

function chatWithRules(messages, viewerId) {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  const req = parseRequest(last);
  const collected = { results: null, proposals: [] };

  if (/e-?mail|phone|number of|contact|whatsapp|address of|who is (the )?(seller|bidder)/i.test(last)) {
    return {
      reply: "I can't share other students' account or contact details. Public bids only show display names. To ask the seller something, use the Questions section on the auction page.",
      ...collected,
      mode: 'rules',
    };
  }

  if (!req.category && !req.keyword && !req.wantsAlert) {
    return { reply: 'Tell me what you need, for example "find me a cycle under ₹2,000" or "alert me about scientific calculators up to ₹400".', ...collected, mode: 'rules' };
  }

  const results = runSearch({ query: req.keyword, category: req.category, condition: req.condition, maxPrice: req.maxPrice ?? undefined, closingSoon: req.closingSoon });
  collected.results = results;
  const what = describeSearch({ keyword: req.keyword, category: req.category, condition: req.condition, max_price: req.maxPrice });
  const lines = [];

  if (results.length === 0) {
    lines.push(`Nothing live matches "${what}" right now.`);
  } else {
    const best = results[0];
    const price = best.currentPrice ?? best.startPrice;
    lines.push(`Best match for "${what}": ${best.title} at ₹${price.toLocaleString('en-IN')} (${best.bidCount} bid${best.bidCount === 1 ? '' : 's'}, closes in ${minutesLeft(best.endsAt)}).`);
    if (results.length > 1) lines.push(`I found ${results.length - 1} more below.`);
  }

  if (req.wantsBid) {
    if (results.length === 0) lines.push('There is nothing to bid on yet.');
    else if (req.maxPrice == null) lines.push('Tell me your limit, for example "bid for me up to ₹1,800", and I will prepare it.');
    else {
      const r = buildBidProposal(results[0].id, req.maxPrice, viewerId);
      if (r.proposal) { collected.proposals.push(r.proposal); lines.push(`I prepared an automatic bid up to ₹${req.maxPrice.toLocaleString('en-IN')}. Confirm it below.`); }
      else lines.push(`I can't bid on that: ${r.error}`);
    }
  }

  if (req.wantsAlert || results.length === 0) {
    const r = buildSearchProposal({ keyword: req.keyword, category: req.category, maxPrice: req.maxPrice ?? undefined });
    if (r.proposal) { collected.proposals.push(r.proposal); lines.push('Want an alert when a new match is listed? Confirm below.'); }
  }

  return { reply: lines.join(' '), ...collected, mode: 'rules' };
}

export async function chat(messages, viewerId) {
  const clean = messages
    .filter((m) => m && typeof m.text === 'string' && m.text.trim() && ['user', 'assistant'].includes(m.role))
    .slice(-12)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 1000) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') return { reply: 'Ask me something!', results: null, proposals: [], mode: 'rules' };

  if (!process.env.GEMINI_API_KEY) return chatWithRules(clean, viewerId);
  if (Date.now() < geminiPausedUntil) {
    return { ...chatWithRules(clean, viewerId), fallbackReason: 'The AI is resting for a moment (free usage limit), so the offline assistant answered.' };
  }
  try {
    return await chatWithGemini(clean, viewerId);
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    const rateLimited = /RESOURCE_EXHAUSTED|"code":\s*429/.test(err.message);
    if (rateLimited) {
      const retrySeconds = Number(err.message.match(/retry in ([\d.]+)s/i)?.[1]) || 60;
      geminiPausedUntil = Date.now() + Math.ceil(retrySeconds) * 1000;
    }
    console.error(`Gemini ${timedOut ? 'timed out' : rateLimited ? 'rate-limited' : 'failed'}, using offline assistant:`, err.message.slice(0, 200));
    const fallbackReason = timedOut ? 'The AI took too long, so the offline assistant answered.'
      : rateLimited ? 'The AI is resting for a moment (free usage limit), so the offline assistant answered.'
      : 'AI service unavailable, using offline mode.';
    return { ...chatWithRules(clean, viewerId), fallbackReason };
  }
}
