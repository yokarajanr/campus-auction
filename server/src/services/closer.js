import db from '../db.js';
import { emitAuctionUpdate, notify } from './realtime.js';

// Re-checks inside the transaction so a bid that was accepted just before closing is never lost.
function closeAuction(id, now) {
  return db.transaction(() => {
    const a = db.prepare("SELECT * FROM auctions WHERE id = ? AND status = 'live' AND ends_at <= ?").get(id, now);
    if (!a) return null;

    if (a.leader_id == null) {
      db.prepare("UPDATE auctions SET status = 'unsold', outcome_note = ?, updated_at = ? WHERE id = ?")
        .run('Closed with no bids. Unsold.', now, a.id);
      notify(a.seller_id, 'unsold', `"${a.title}" closed with no bids. You can list it again.`, a.id);
      return 'unsold';
    }

    db.prepare("UPDATE auctions SET status = 'awaiting_seller', winner_id = leader_id, updated_at = ? WHERE id = ?")
      .run(now, a.id);
    notify(a.seller_id, 'approve_needed', `"${a.title}" closed at ₹${a.current_price}. Approve or reject the winning bid.`, a.id);
    notify(a.leader_id, 'provisional_win', `You are the provisional winner of "${a.title}" at ₹${a.current_price}. Waiting for the seller to approve.`, a.id);
    const others = db.prepare('SELECT DISTINCT bidder_id FROM bids WHERE auction_id = ? AND bidder_id != ?').all(a.id, a.leader_id);
    for (const { bidder_id } of others) {
      notify(bidder_id, 'auction_lost', `"${a.title}" closed at ₹${a.current_price}. You didn't win this one.`, a.id);
    }
    return 'awaiting_seller';
  })();
}

export function closeExpiredAuctions(now = Date.now()) {
  const due = db.prepare("SELECT id FROM auctions WHERE status = 'live' AND ends_at <= ?").all(now);
  const closed = [];
  for (const { id } of due) {
    const outcome = closeAuction(id, now);
    if (outcome) {
      closed.push({ id, outcome });
      emitAuctionUpdate(id, { reason: 'closed', status: outcome });
    }
  }
  return closed;
}

export function startCloser(intervalMs = 1000) {
  closeExpiredAuctions();
  return setInterval(() => {
    try {
      closeExpiredAuctions();
    } catch (err) {
      console.error('Closing job failed:', err);
    }
  }, intervalMs);
}
