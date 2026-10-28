import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { default: db } = await import('../src/db.js');
const { placeBid } = await import('../src/services/bidEngine.js');
const { closeExpiredAuctions } = await import('../src/services/closer.js');
const { approveSale, rejectSale, confirmHandover, reportFailedPickup } = await import('../src/services/sale.js');
const { auctionDetail } = await import('../src/services/auctions.js');

const T0 = 1_800_000_000_000;

function user(name) {
  return Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, `${name}${Math.random()}@test.edu`, 'x', T0).lastInsertRowid);
}

const seller = user('seller');
const winner = user('winner');
const other = user('other');

// Creates an auction, has `winner` bid ₹500, and closes it -> awaiting_seller.
function closedAuction() {
  const id = Number(db.prepare(`
    INSERT INTO auctions (seller_id, title, category, condition, start_price, min_increment, ends_at, created_at, updated_at)
    VALUES (?, 'Hero cycle', 'cycle', 'good', 500, 50, ?, ?, ?)`).run(seller, T0 + 60_000, T0, T0).lastInsertRowid);
  placeBid(id, winner, 500, { now: T0 });
  closeExpiredAuctions(T0 + 60_000);
  return id;
}

const row = (id) => db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);
const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);

test('only the seller can approve, and only while awaiting a decision', () => {
  const id = closedAuction();
  rejects(() => approveSale(id, winner), 403);
  approveSale(id, seller);
  assert.equal(row(id).status, 'reserved');
  assert.match(row(id).pickup_code, /^\d{4}$/);
  rejects(() => approveSale(id, seller), 409);
});

test('pickup code is visible only to the winner', () => {
  const id = closedAuction();
  approveSale(id, seller);
  const code = row(id).pickup_code;
  assert.equal(auctionDetail(id, { viewerId: winner }).pickupCode, code);
  assert.equal(auctionDetail(id, { viewerId: seller }).pickupCode, null);
  assert.equal(auctionDetail(id, { viewerId: other }).pickupCode, null);
  assert.equal(auctionDetail(id).pickupCode, null);
  assert.ok(!JSON.stringify(auctionDetail(id).auction).includes(code));
});

test('approval notifies the winner with their code', () => {
  const id = closedAuction();
  approveSale(id, seller);
  const note = db.prepare("SELECT message FROM notifications WHERE user_id = ? AND type = 'sale_approved' AND auction_id = ?").get(winner, id);
  assert.ok(note.message.includes(row(id).pickup_code));
});

test('reject records the outcome and the reason', () => {
  const id = closedAuction();
  rejects(() => rejectSale(id, other, 'no'), 403);
  rejectSale(id, seller, 'Too low for me');
  assert.equal(row(id).status, 'rejected');
  assert.equal(row(id).outcome_note, 'Seller rejected the winning price of ₹500: Too low for me');
  rejects(() => approveSale(id, seller), 409);
});

test('handover needs the correct code and completes the sale', () => {
  const id = closedAuction();
  rejects(() => confirmHandover(id, seller, '1234'), 409);
  approveSale(id, seller);
  const code = row(id).pickup_code;
  const wrong = code === '1111' ? '2222' : '1111';
  rejects(() => confirmHandover(id, seller, wrong), 400);
  assert.equal(row(id).status, 'reserved');
  rejects(() => confirmHandover(id, winner, code), 403);
  confirmHandover(id, seller, code);
  assert.equal(row(id).status, 'completed');
  assert.match(row(id).outcome_note, /Sold to winner for ₹500/);
});

test('failed pickup can be reported by seller or winner only, while reserved', () => {
  const a = closedAuction();
  rejects(() => reportFailedPickup(a, seller, 'x'), 409);
  approveSale(a, seller);
  rejects(() => reportFailedPickup(a, other, 'x'), 403);
  reportFailedPickup(a, winner, 'Seller did not come');
  assert.equal(row(a).status, 'failed_pickup');
  assert.equal(row(a).outcome_note, 'Pickup failed (reported by the buyer): Seller did not come');

  const b = closedAuction();
  approveSale(b, seller);
  reportFailedPickup(b, seller, '');
  assert.equal(row(b).outcome_note, 'Pickup failed (reported by the seller).');
  rejects(() => confirmHandover(b, seller, row(b).pickup_code), 409);
});
