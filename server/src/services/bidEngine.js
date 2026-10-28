import db from '../db.js';
import { HttpError } from '../errors.js';
import { nextMinBid } from './auctions.js';
import { notify } from './realtime.js';

export const EXTENSION_WINDOW_MS = 30_000;
export const EXTENSION_MS = 60_000;

// The single entry point for every bid. Runs in one transaction so the checks and the write can't interleave
// with another bid or with the closing job. `now` is injectable for tests.
export function placeBid(auctionId, bidderId, amount, { now = Date.now(), isAuto = false } = {}) {
  return db.transaction(() => {
    const a = db.prepare('SELECT * FROM auctions WHERE id = ?').get(auctionId);
    if (!a) throw new HttpError(404, 'Auction not found');
    if (a.status !== 'live' || now >= a.ends_at) throw new HttpError(409, 'Bidding has closed for this item');
    if (a.seller_id === bidderId) throw new HttpError(403, "You can't bid on your own item");
    if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'Bid must be a whole number of rupees');
    if (a.leader_id === bidderId) throw new HttpError(409, 'You are already the leading bidder');

    const minimum = nextMinBid(a);
    if (amount < minimum) {
      throw new HttpError(409, a.current_price == null
        ? `The first bid must be at least the starting price of ₹${minimum}`
        : `Bid must be at least ₹${minimum} (current ₹${a.current_price} + increment ₹${a.min_increment})`);
    }

    const extended = a.ends_at - now <= EXTENSION_WINDOW_MS;
    const endsAt = extended ? now + EXTENSION_MS : a.ends_at;

    const { lastInsertRowid } = db
      .prepare('INSERT INTO bids (auction_id, bidder_id, amount, is_auto, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(a.id, bidderId, amount, isAuto ? 1 : 0, now);
    db.prepare('UPDATE auctions SET current_price = ?, leader_id = ?, ends_at = ?, updated_at = ? WHERE id = ?')
      .run(amount, bidderId, endsAt, now, a.id);

    if (a.leader_id != null) {
      notify(a.leader_id, 'outbid', `You were outbid on "${a.title}". Leading bid is now ₹${amount}.`, a.id);
    }
    notify(a.seller_id, 'new_bid', `New bid of ₹${amount} on "${a.title}".`, a.id);

    return { bidId: Number(lastInsertRowid), auctionId: a.id, amount, endsAt, extended };
  })();
}
