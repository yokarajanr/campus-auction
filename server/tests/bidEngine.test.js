import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { default: db } = await import('../src/db.js');
const { placeBid, EXTENSION_MS } = await import('../src/services/bidEngine.js');
const { closeExpiredAuctions } = await import('../src/services/closer.js');

const T0 = 1_800_000_000_000;
const MINUTE = 60_000;

function user(name) {
  return Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, `${name}${Math.random()}@test.edu`, 'x', T0).lastInsertRowid);
}

function auction(sellerId, { startPrice = 300, increment = 20, endsAt = T0 + 10 * MINUTE } = {}) {
  return Number(db.prepare(`
    INSERT INTO auctions (seller_id, title, category, condition, start_price, min_increment, ends_at, created_at, updated_at)
    VALUES (?, 'Casio calculator', 'calculator', 'good', ?, ?, ?, ?, ?)`)
    .run(sellerId, startPrice, increment, endsAt, T0, T0).lastInsertRowid);
}

const row = (id) => db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);
const notes = (userId, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ?').all(userId, type);

function rejects(fn, status, pattern) {
  assert.throws(fn, (err) => err.status === status && pattern.test(err.message));
}

const seller = user('seller');
const asha = user('asha');
const bala = user('bala');

test('first bid must be at least the starting price', () => {
  const id = auction(seller);
  rejects(() => placeBid(id, asha, 299, { now: T0 }), 409, /starting price of ₹300/);
  const r = placeBid(id, asha, 300, { now: T0 });
  assert.equal(r.amount, 300);
  assert.equal(row(id).current_price, 300);
  assert.equal(row(id).leader_id, asha);
});

test('later bids must be at least current price + increment', () => {
  const id = auction(seller);
  placeBid(id, asha, 300, { now: T0 });
  rejects(() => placeBid(id, bala, 319, { now: T0 + 1 }), 409, /at least ₹320/);
  placeBid(id, bala, 320, { now: T0 + 2 });
  assert.equal(row(id).leader_id, bala);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bids WHERE auction_id = ?').get(id).c, 2);
});

test('rejected bids are not recorded', () => {
  const id = auction(seller);
  assert.throws(() => placeBid(id, asha, 10, { now: T0 }));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bids WHERE auction_id = ?').get(id).c, 0);
  assert.equal(row(id).current_price, null);
});

test('every bid records bidder, amount and time', () => {
  const id = auction(seller);
  placeBid(id, asha, 350, { now: T0 + 1234 });
  const bid = db.prepare('SELECT * FROM bids WHERE auction_id = ?').get(id);
  assert.deepEqual([bid.bidder_id, bid.amount, bid.created_at, bid.is_auto], [asha, 350, T0 + 1234, 0]);
});

test('seller cannot bid on their own item', () => {
  const id = auction(seller);
  rejects(() => placeBid(id, seller, 300, { now: T0 }), 403, /own item/);
});

test('leading bidder cannot outbid themselves', () => {
  const id = auction(seller);
  placeBid(id, asha, 300, { now: T0 });
  rejects(() => placeBid(id, asha, 400, { now: T0 + 1 }), 409, /already the leading/);
});

test('invalid amounts are rejected', () => {
  const id = auction(seller);
  for (const bad of [NaN, 300.5, -1, 0]) rejects(() => placeBid(id, asha, bad, { now: T0 }), 400, /whole number/);
});

test('no bids at or after the closing time', () => {
  const id = auction(seller, { endsAt: T0 + MINUTE });
  rejects(() => placeBid(id, asha, 300, { now: T0 + MINUTE }), 409, /closed/);
  rejects(() => placeBid(id, asha, 300, { now: T0 + 2 * MINUTE }), 409, /closed/);
});

test('no bids on a cancelled auction', () => {
  const id = auction(seller);
  db.prepare("UPDATE auctions SET status = 'cancelled' WHERE id = ?").run(id);
  rejects(() => placeBid(id, asha, 300, { now: T0 }), 409, /closed/);
});

test('bid in the last 30 seconds moves closing to 60 seconds after the bid', () => {
  const endsAt = T0 + 10 * MINUTE;
  const id = auction(seller, { endsAt });
  const bidAt = endsAt - 20_000;
  const r = placeBid(id, asha, 300, { now: bidAt });
  assert.equal(r.extended, true);
  assert.equal(row(id).ends_at, bidAt + EXTENSION_MS);

  const secondAt = bidAt + EXTENSION_MS - 5_000;
  placeBid(id, bala, 320, { now: secondAt });
  assert.equal(row(id).ends_at, secondAt + EXTENSION_MS, 'extends again on each late bid');
});

test('exactly 30 seconds left still extends; 31 seconds does not', () => {
  const endsAt = T0 + 10 * MINUTE;
  const a = auction(seller, { endsAt });
  assert.equal(placeBid(a, asha, 300, { now: endsAt - 30_000 }).extended, true);
  const b = auction(seller, { endsAt });
  const r = placeBid(b, asha, 300, { now: endsAt - 31_000 });
  assert.equal(r.extended, false);
  assert.equal(row(b).ends_at, endsAt);
});

test('outbid bidder and seller are notified', () => {
  const id = auction(seller);
  placeBid(id, asha, 300, { now: T0 });
  placeBid(id, bala, 320, { now: T0 + 1 });
  assert.ok(notes(asha, 'outbid').some((n) => n.auction_id === id));
  assert.equal(notes(seller, 'new_bid').filter((n) => n.auction_id === id).length, 2);
});

test('closing with no bids marks the item unsold', () => {
  const id = auction(seller, { endsAt: T0 + MINUTE });
  closeExpiredAuctions(T0 + MINUTE - 1);
  assert.equal(row(id).status, 'live', 'not closed before its time');
  closeExpiredAuctions(T0 + MINUTE);
  assert.equal(row(id).status, 'unsold');
  assert.equal(row(id).winner_id, null);
  assert.ok(notes(seller, 'unsold').some((n) => n.auction_id === id));
});

test('closing with bids makes the highest bidder the provisional winner', () => {
  const id = auction(seller, { endsAt: T0 + MINUTE });
  placeBid(id, asha, 300, { now: T0 });
  placeBid(id, bala, 340, { now: T0 + 1 });
  closeExpiredAuctions(T0 + MINUTE);
  const a = row(id);
  assert.equal(a.status, 'awaiting_seller');
  assert.equal(a.winner_id, bala);
  assert.equal(a.current_price, 340);
  assert.ok(notes(seller, 'approve_needed').some((n) => n.auction_id === id));
  assert.ok(notes(bala, 'provisional_win').some((n) => n.auction_id === id));
  assert.ok(notes(asha, 'auction_lost').some((n) => n.auction_id === id));
  rejects(() => placeBid(id, asha, 500, { now: T0 + MINUTE + 1 }), 409, /closed/);
});

test('closing job only closes auctions whose time has passed', () => {
  const later = auction(seller, { endsAt: T0 + 60 * MINUTE });
  closeExpiredAuctions(T0 + 2 * MINUTE);
  assert.equal(row(later).status, 'live');
});
