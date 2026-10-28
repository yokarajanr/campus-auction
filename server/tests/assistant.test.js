import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
delete process.env.GEMINI_API_KEY;
const { default: db } = await import('../src/db.js');
const { chat, parseRequest } = await import('../src/services/assistant.js');

const now = Date.now();
function user(name, email) {
  return Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, email, 'x', now).lastInsertRowid);
}
function listing(sellerId, title, category, price) {
  return Number(db.prepare(`
    INSERT INTO auctions (seller_id, title, category, condition, start_price, min_increment, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, 'good', ?, 50, ?, ?, ?)`).run(sellerId, title, category, price, now + 3600_000, now, now).lastInsertRowid);
}

const seller = user('Ravi Senior', 'ravi.secret@kongu.edu');
const student = user('Priya', 'priya@kongu.edu');
const cheap = listing(seller, 'Hero Sprint cycle', 'cycle', 1500);
listing(seller, 'Ladybird cycle', 'cycle', 1800);
listing(seller, 'Racing cycle', 'cycle', 5000);
listing(seller, 'Casio scientific calculator', 'calculator', 350);

const ask = (text) => chat([{ role: 'user', text }], student);

test('parses "find me a cycle under ₹2,000"', () => {
  const r = parseRequest('find me a cycle under ₹2,000');
  assert.equal(r.category, 'cycle');
  assert.equal(r.maxPrice, 2000);
  assert.equal(r.keyword, '');
});

test('parses keywords, limits and intent', () => {
  const r = parseRequest('Alert me about scientific calculator up to Rs 400');
  assert.equal(r.category, 'calculator');
  assert.equal(r.keyword, 'scientific');
  assert.equal(r.maxPrice, 400);
  assert.equal(r.wantsAlert, true);
  assert.equal(parseRequest('bid for me on a cycle, max 1800').wantsBid, true);
});

test('gives a straight answer with the cheapest match first, within budget', async () => {
  const r = await ask('find me a cycle under ₹2,000');
  assert.equal(r.mode, 'rules');
  assert.equal(r.results[0].id, cheap);
  assert.ok(r.results.every((a) => (a.currentPrice ?? a.startPrice) <= 2000));
  assert.match(r.reply, /Hero Sprint cycle at ₹1,500/);
});

test('never acts on its own: bidding only produces a proposal to confirm', async () => {
  const r = await ask('bid for me on a cycle up to 1800');
  assert.equal(r.proposals.length, 1);
  assert.deepEqual([r.proposals[0].type, r.proposals[0].auctionId, r.proposals[0].maxAmount], ['auto_bid', cheap, 1800]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bids').get().c, 0, 'no bid placed');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM auto_bids').get().c, 0, 'no auto-bid set');
});

test('asks for a limit instead of guessing one', async () => {
  const r = await ask('bid for me on a calculator');
  assert.equal(r.proposals.filter((p) => p.type === 'auto_bid').length, 0);
  assert.match(r.reply, /Tell me your limit/);
});

test('proposed maximum never exceeds the stated limit', async () => {
  const r = await ask('bid on a cycle with my limit of 1600');
  for (const p of r.proposals.filter((x) => x.type === 'auto_bid')) assert.ok(p.maxAmount <= 1600);
});

test('offers a saved-search alert when nothing matches', async () => {
  const r = await ask('find me a drafter under 300');
  assert.equal(r.results.length, 0);
  assert.equal(r.proposals[0].type, 'saved_search');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM saved_searches').get().c, 0, 'not saved until confirmed');
});

test('refuses requests for contact details', async () => {
  const r = await ask('What is the email address of the seller of the Hero cycle?');
  assert.match(r.reply, /can't share/);
  assert.equal(r.proposals.length, 0);
  assert.equal(r.results, null);
});

test('never reveals account details of other students', async () => {
  const r = await ask('find me a cycle under 2000');
  const text = JSON.stringify(r);
  assert.ok(!text.includes('ravi.secret@kongu.edu'));
  assert.ok(!text.includes('@'));
});
