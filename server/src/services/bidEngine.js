import db from '../db.js';
import { HttpError } from '../errors.js';
import { nextMinBid } from './auctions.js';
import { notify } from './realtime.js';

export const EXTENSION_WINDOW_MS = 30_000;
export const EXTENSION_MS = 60_000;
const MAX_AUTO_ROUNDS = 200;

const loadAuction = (id) => db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);

function assertOpen(a, now) {
  if (!a) throw new HttpError(404, 'Auction not found');
  if (a.status !== 'live' || now >= a.ends_at) throw new HttpError(409, 'Bidding has closed for this item');
}

// Shared by manual and automatic bids. Must run inside a transaction.
function recordBid(a, bidderId, amount, now, isAuto) {
  if (a.seller_id === bidderId) throw new HttpError(403, "You can't bid on your own item");
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'Bid must be a whole number of rupees');
  const minimum = nextMinBid(a);
  if (amount < minimum) {
    throw new HttpError(409, a.current_price == null
      ? `The first bid must be at least the starting price of ₹${minimum}`
      : `Bid must be at least ₹${minimum} (current ₹${a.current_price} + increment ₹${a.min_increment})`);
  }

  const endsAt = a.ends_at - now <= EXTENSION_WINDOW_MS ? now + EXTENSION_MS : a.ends_at;
  db.prepare('INSERT INTO bids (auction_id, bidder_id, amount, is_auto, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(a.id, bidderId, amount, isAuto ? 1 : 0, now);
  db.prepare('UPDATE auctions SET current_price = ?, leader_id = ?, ends_at = ?, updated_at = ? WHERE id = ?')
    .run(amount, bidderId, endsAt, now, a.id);

  if (a.leader_id != null && a.leader_id !== bidderId) {
    notify(a.leader_id, 'outbid', `You were outbid on "${a.title}". Leading bid is now ₹${amount}.`, a.id);
  }
  notify(a.seller_id, 'new_bid', `New ${isAuto ? 'automatic ' : ''}bid of ₹${amount} on "${a.title}".`, a.id);
}

const activeAutoBid = (auctionId, userId) => db
  .prepare('SELECT * FROM auto_bids WHERE auction_id = ? AND user_id = ? AND active = 1').get(auctionId, userId);

// Lets automatic bids answer each other until nobody can raise any more. Each step either hands the lead to a
// strictly higher maximum, or raises the leader just enough to stay ahead of a lower (or equal, later) maximum.
// No automatic bid ever goes above its maximum.
function resolveAutoBids(auctionId, now) {
  for (let round = 0; round < MAX_AUTO_ROUNDS; round++) {
    const a = loadAuction(auctionId);
    if (a.status !== 'live' || now >= a.ends_at) return;
    const minimum = nextMinBid(a);
    const challenger = db.prepare(`
      SELECT * FROM auto_bids
      WHERE auction_id = ? AND active = 1 AND user_id != ? AND max_amount >= ?
      ORDER BY max_amount DESC, updated_at ASC, id ASC LIMIT 1`).get(a.id, a.leader_id ?? -1, minimum);
    if (!challenger) return;

    const defender = a.leader_id == null ? null : activeAutoBid(a.id, a.leader_id);
    if (!defender || challenger.max_amount > defender.max_amount) {
      const amount = defender
        ? Math.min(challenger.max_amount, Math.max(minimum, defender.max_amount + a.min_increment))
        : minimum;
      recordBid(a, challenger.user_id, amount, now, true);
    } else {
      const amount = Math.min(defender.max_amount, challenger.max_amount + a.min_increment);
      recordBid(a, defender.user_id, amount, now, true);
      notify(challenger.user_id, 'autobid_beaten',
        `Your automatic bid (max ₹${challenger.max_amount}) on "${a.title}" was beaten by a higher or earlier maximum.`, a.id);
    }
  }
}

function finish(auctionId, startEndsAt, amount) {
  const a = loadAuction(auctionId);
  return { auctionId, amount, endsAt: a.ends_at, extended: a.ends_at !== startEndsAt };
}

// The single entry point for manual bids. `now` is injectable for tests.
export function placeBid(auctionId, bidderId, amount, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const a = loadAuction(auctionId);
    assertOpen(a, now);
    if (a.seller_id !== bidderId && a.leader_id === bidderId) throw new HttpError(409, 'You are already the leading bidder');
    recordBid(a, bidderId, amount, now, false);
    resolveAutoBids(a.id, now);
    return finish(a.id, a.ends_at, amount);
  })();
}

export function setAutoBid(auctionId, userId, maxAmount, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const a = loadAuction(auctionId);
    assertOpen(a, now);
    if (a.seller_id === userId) throw new HttpError(403, "You can't bid on your own item");
    if (!Number.isInteger(maxAmount) || maxAmount <= 0) throw new HttpError(400, 'Maximum must be a whole number of rupees');
    const floor = a.leader_id === userId ? a.current_price : nextMinBid(a);
    if (maxAmount < floor) throw new HttpError(409, `Your maximum must be at least ₹${floor}`);

    const existing = db.prepare('SELECT * FROM auto_bids WHERE auction_id = ? AND user_id = ?').get(a.id, userId);
    if (existing) {
      const keepPriority = existing.active === 1 && existing.max_amount === maxAmount;
      db.prepare('UPDATE auto_bids SET max_amount = ?, active = 1, updated_at = ? WHERE id = ?')
        .run(maxAmount, keepPriority ? existing.updated_at : now, existing.id);
    } else {
      db.prepare('INSERT INTO auto_bids (auction_id, user_id, max_amount, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
        .run(a.id, userId, maxAmount, now, now);
    }

    resolveAutoBids(a.id, now);
    return finish(a.id, a.ends_at, maxAmount);
  })();
}

export function cancelAutoBid(auctionId, userId) {
  const { changes } = db.prepare('UPDATE auto_bids SET active = 0 WHERE auction_id = ? AND user_id = ? AND active = 1')
    .run(auctionId, userId);
  if (changes === 0) throw new HttpError(404, 'You have no automatic bid on this item');
  return auctionId;
}
