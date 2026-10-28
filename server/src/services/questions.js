import db from '../db.js';
import { HttpError } from '../errors.js';
import { notify } from './realtime.js';

export const MAX_QUESTIONS_PER_AUCTION = 3;
export const QUESTION_COOLDOWN_MS = 30_000;
const DUPLICATE_SCORE = 0.6;
const SIMILAR_SCORE = 0.3;

const STOP_WORDS = new Set(('a an the is are was were be it its this that does do did any there have has had of to in on for '
  + 'with and or but if can could will would should you your i me my how what when which still').split(' '));

function words(text) {
  return new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .map((w) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
}

export function similarity(a, b) {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / new Set([...x, ...y]).size;
}

function loadAuction(auctionId) {
  const a = db.prepare('SELECT id, seller_id, title, status, ends_at FROM auctions WHERE id = ?').get(auctionId);
  if (!a) throw new HttpError(404, 'Auction not found');
  return a;
}

function rows(auctionId) {
  return db.prepare(`
    SELECT q.*, u.name AS asker_name, (SELECT COUNT(*) FROM question_votes v WHERE v.question_id = q.id) AS same_count
    FROM questions q JOIN users u ON u.id = q.asker_id WHERE q.auction_id = ?`).all(auctionId);
}

function toPublic(q, viewerId) {
  return {
    id: q.id,
    askerName: q.asker_name,
    text: q.text,
    answer: q.answer,
    answeredAt: q.answered_at,
    createdAt: q.created_at,
    sameCount: q.same_count,
    hidden: Boolean(q.hidden),
    mine: q.asker_id === viewerId,
    viewerVoted: viewerId != null
      && Boolean(db.prepare('SELECT 1 FROM question_votes WHERE question_id = ? AND user_id = ?').get(q.id, viewerId)),
  };
}

// Answered first, then the questions most students share, then oldest first.
export function listQuestions(auctionId, viewerId = null) {
  const a = loadAuction(auctionId);
  const isSeller = viewerId === a.seller_id;
  return rows(auctionId)
    .filter((q) => !q.hidden || isSeller)
    .sort((p, q) => (q.answer ? 1 : 0) - (p.answer ? 1 : 0) || q.same_count - p.same_count || p.id - q.id)
    .map((q) => toPublic(q, viewerId));
}

export function findSimilar(auctionId, text, viewerId = null) {
  return rows(auctionId)
    .filter((q) => !q.hidden)
    .map((q) => ({ q, score: similarity(text, q.text) }))
    .filter((x) => x.score >= SIMILAR_SCORE)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => ({ ...toPublic(x.q, viewerId), score: Math.round(x.score * 100) / 100 }));
}

export function askQuestion(auctionId, userId, rawText, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const a = loadAuction(auctionId);
    if (a.status !== 'live' || a.ends_at <= now) throw new HttpError(409, 'Questions are closed because bidding has ended');
    if (a.seller_id === userId) throw new HttpError(403, 'Sellers answer questions; add details to your description instead');

    const text = String(rawText ?? '').trim().replace(/\s+/g, ' ');
    if (text.length < 8 || text.length > 300) throw new HttpError(400, 'Questions must be 8-300 characters');
    if (/https?:\/\/|www\.|\.com\b/i.test(text)) throw new HttpError(400, 'Links are not allowed in questions');

    const mineHere = db.prepare('SELECT COUNT(*) AS c FROM questions WHERE auction_id = ? AND asker_id = ?').get(a.id, userId).c;
    if (mineHere >= MAX_QUESTIONS_PER_AUCTION) {
      throw new HttpError(429, `You can ask up to ${MAX_QUESTIONS_PER_AUCTION} questions per item`);
    }
    const last = db.prepare('SELECT MAX(created_at) AS t FROM questions WHERE asker_id = ?').get(userId).t;
    if (last && now - last < QUESTION_COOLDOWN_MS) {
      throw new HttpError(429, `Please wait ${Math.ceil((QUESTION_COOLDOWN_MS - (now - last)) / 1000)}s before asking another question`);
    }

    const duplicate = rows(a.id)
      .filter((q) => !q.hidden)
      .map((q) => ({ q, score: similarity(text, q.text) }))
      .sort((x, y) => y.score - x.score)[0];
    if (duplicate && duplicate.score >= DUPLICATE_SCORE) {
      throw new HttpError(409, 'This looks like a question that was already asked', { duplicateOf: toPublic(duplicate.q, userId) });
    }

    const { lastInsertRowid } = db.prepare('INSERT INTO questions (auction_id, asker_id, text, created_at) VALUES (?, ?, ?, ?)')
      .run(a.id, userId, text, now);
    notify(a.seller_id, 'question', `New question on "${a.title}": "${text}"`, a.id);
    return Number(lastInsertRowid);
  })();
}

function loadQuestionForSeller(questionId, userId) {
  const q = db.prepare('SELECT q.*, a.seller_id, a.title FROM questions q JOIN auctions a ON a.id = q.auction_id WHERE q.id = ?').get(questionId);
  if (!q) throw new HttpError(404, 'Question not found');
  if (q.seller_id !== userId) throw new HttpError(403, 'Only the seller can do this');
  return q;
}

export function answerQuestion(questionId, userId, rawAnswer, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const q = loadQuestionForSeller(questionId, userId);
    const answer = String(rawAnswer ?? '').trim();
    if (answer.length < 1 || answer.length > 500) throw new HttpError(400, 'Answers must be 1-500 characters');
    db.prepare('UPDATE questions SET answer = ?, answered_at = ?, hidden = 0 WHERE id = ?').run(answer, now, q.id);
    const waiting = new Set([q.asker_id, ...db.prepare('SELECT user_id FROM question_votes WHERE question_id = ?').all(q.id).map((v) => v.user_id)]);
    for (const uid of waiting) notify(uid, 'question_answered', `The seller answered "${q.text}" on "${q.title}": ${answer}`, q.auction_id);
    return q.auction_id;
  })();
}

export function setHidden(questionId, userId, hidden) {
  const q = loadQuestionForSeller(questionId, userId);
  db.prepare('UPDATE questions SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, q.id);
  return q.auction_id;
}

export function sameQuestion(questionId, userId, { now = Date.now() } = {}) {
  const q = db.prepare('SELECT q.*, a.seller_id FROM questions q JOIN auctions a ON a.id = q.auction_id WHERE q.id = ?').get(questionId);
  if (!q || q.hidden) throw new HttpError(404, 'Question not found');
  if (q.asker_id === userId || q.seller_id === userId) throw new HttpError(409, 'You cannot vote on this question');
  db.prepare('INSERT OR IGNORE INTO question_votes (question_id, user_id, created_at) VALUES (?, ?, ?)').run(q.id, userId, now);
  return q.auction_id;
}

export function answeredFaq(auctionId) {
  return db.prepare('SELECT text AS question, answer FROM questions WHERE auction_id = ? AND answer IS NOT NULL AND hidden = 0 ORDER BY id').all(auctionId);
}
