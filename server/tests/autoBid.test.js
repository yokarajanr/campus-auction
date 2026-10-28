import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { default: db } = await import('../src/db.js');
const { placeBid, setAutoBid, cancelAutoBid, EXTENSION_MS } = await import('../src/services/bidEngine.js');

const T0 = 1_800_000_000_000;
let tick = 0;
const now = () => T0 + ++tick;

function user(name) {
  return Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, `${name}${Math.random()}@test.edu`, 'x', T0).lastInsertRowid);
}

function cycle({ endsAt = T0 + 3600_000 } = {}) {
  return Number(db.prepare(`
    INSERT INTO auctions (seller_id, title, category, condition, start_price, min_increment, ends_at, created_at, updated_at)
    VALUES (?, 'Hero cycle', 'cycle', 'good', 1000, 50, ?, ?, ?)`).run(seller, endsAt, T0, T0).lastInsertRowid);
}

const row = (id) => db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);
const bids = (id) => db.prepare('SELECT bidder_id, amount, is_auto FROM bids WHERE auction_id = ? ORDER BY id').all(id);
const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);

const seller = user('seller');
const asha = user('asha');
const bala = user('bala');
const chitra = user('chitra');

test('setting a maximum places the opening bid at the starting price', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  assert.deepEqual(bids(id), [{ bidder_id: asha, amount: 1000, is_auto: 1 }]);
});

test('auto-bid answers a manual bid with only one increment', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  placeBid(id, bala, 1100, { now: now() });
  assert.equal(row(id).leader_id, asha);
  assert.equal(row(id).current_price, 1150);
});

test('auto-bid never goes above the maximum', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  placeBid(id, bala, 1800, { now: now() });
  assert.equal(row(id).leader_id, bala);
  assert.equal(row(id).current_price, 1800);
  assert.ok(bids(id).filter((b) => b.bidder_id === asha).every((b) => b.amount <= 1800));
  placeBid(id, chitra, 1850, { now: now() });
  assert.ok(bids(id).filter((b) => b.bidder_id === asha).every((b) => b.amount <= 1800));
});

test('two maximums: the higher wins at one increment above the lower', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  setAutoBid(id, bala, 1500, { now: now() });
  assert.equal(row(id).leader_id, asha);
  assert.equal(row(id).current_price, 1550);
  const beaten = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type = 'autobid_beaten' AND auction_id = ?").get(bala, id);
  assert.equal(beaten.c, 1);
});

test('a new higher maximum takes the lead just above the old maximum', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  setAutoBid(id, bala, 2000, { now: now() });
  assert.equal(row(id).leader_id, bala);
  assert.equal(row(id).current_price, 1850);
});

test('higher maximum within one increment wins at its own maximum', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  setAutoBid(id, bala, 1820, { now: now() });
  assert.equal(row(id).leader_id, bala);
  assert.equal(row(id).current_price, 1820);
});

test('equal maximums: the one set first keeps the lead', () => {
  const id = cycle();
  setAutoBid(id, asha, 1500, { now: now() });
  setAutoBid(id, bala, 1500, { now: now() });
  assert.equal(row(id).leader_id, asha);
  assert.equal(row(id).current_price, 1500);
});

test('three maximums settle correctly', () => {
  const id = cycle();
  setAutoBid(id, asha, 1300, { now: now() });
  setAutoBid(id, bala, 1600, { now: now() });
  setAutoBid(id, chitra, 1450, { now: now() });
  assert.equal(row(id).leader_id, bala);
  assert.equal(row(id).current_price, 1500);
});

test('automatic bids are marked as automatic in the public history', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  placeBid(id, bala, 1100, { now: now() });
  assert.deepEqual(bids(id).map((b) => b.is_auto), [1, 0, 1]);
});

test('maximum must cover the next valid bid, seller cannot use it, closed auctions refuse it', () => {
  const id = cycle();
  placeBid(id, asha, 1200, { now: now() });
  rejects(() => setAutoBid(id, bala, 1240, { now: now() }), 409);
  rejects(() => setAutoBid(id, seller, 5000, { now: now() }), 403);
  rejects(() => setAutoBid(id, bala, 1.5, { now: now() }), 400);
  rejects(() => setAutoBid(id, bala, 5000, { now: T0 + 3600_000 }), 409);
});

test('the leader can set a maximum to defend their lead', () => {
  const id = cycle();
  placeBid(id, asha, 1000, { now: now() });
  setAutoBid(id, asha, 1400, { now: now() });
  assert.equal(row(id).current_price, 1000, 'no new bid needed while already leading');
  placeBid(id, bala, 1100, { now: now() });
  assert.equal(row(id).leader_id, asha);
  assert.equal(row(id).current_price, 1150);
});

test('removing a maximum stops further automatic bids', () => {
  const id = cycle();
  setAutoBid(id, asha, 1800, { now: now() });
  cancelAutoBid(id, asha);
  placeBid(id, bala, 1050, { now: now() });
  assert.equal(row(id).leader_id, bala);
  rejects(() => cancelAutoBid(id, asha), 404);
});

test('automatic bids in the last 30 seconds also extend the closing time', () => {
  const endsAt = T0 + 3600_000;
  const id = cycle({ endsAt });
  setAutoBid(id, asha, 1800, { now: now() });
  const lateAt = endsAt - 10_000;
  const r = placeBid(id, bala, 1100, { now: lateAt });
  assert.equal(r.extended, true);
  assert.equal(row(id).ends_at, lateAt + EXTENSION_MS);
  assert.equal(row(id).leader_id, asha);
});
