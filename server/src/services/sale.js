import crypto from 'node:crypto';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { notify } from './realtime.js';

function loadForSale(auctionId) {
  const a = db.prepare(`
    SELECT a.*, w.name AS winner_name FROM auctions a LEFT JOIN users w ON w.id = a.winner_id WHERE a.id = ?`).get(auctionId);
  if (!a) throw new HttpError(404, 'Auction not found');
  return a;
}

function requireSeller(a, userId) {
  if (a.seller_id !== userId) throw new HttpError(403, 'Only the seller can do this');
}

function requireStatus(a, status, message) {
  if (a.status !== status) throw new HttpError(409, message);
}

function setOutcome(a, status, note, now, extra = {}) {
  const updates = { status, outcome_note: note, updated_at: now, ...extra };
  const columns = Object.keys(updates);
  db.prepare(`UPDATE auctions SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...columns.map((c) => updates[c]), a.id);
}

const cleanReason = (reason) => String(reason ?? '').trim().slice(0, 200);

export function approveSale(auctionId, userId, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const a = loadForSale(auctionId);
    requireSeller(a, userId);
    requireStatus(a, 'awaiting_seller', 'Only a closed auction waiting for your decision can be approved');
    const code = String(crypto.randomInt(1000, 10000));
    setOutcome(a, 'reserved', `Seller approved ₹${a.current_price}. Reserved for ${a.winner_name} until campus handover.`, now, { pickup_code: code });
    notify(a.winner_id, 'sale_approved',
      `The seller approved your winning bid of ₹${a.current_price} for "${a.title}". Your pickup code is ${code}. Show it to the seller at handover.`, a.id);
    return a.id;
  })();
}

export function rejectSale(auctionId, userId, reason, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const a = loadForSale(auctionId);
    requireSeller(a, userId);
    requireStatus(a, 'awaiting_seller', 'Only a closed auction waiting for your decision can be rejected');
    const why = cleanReason(reason);
    setOutcome(a, 'rejected', `Seller rejected the winning price of ₹${a.current_price}${why ? `: ${why}` : '.'}`, now);
    notify(a.winner_id, 'sale_rejected', `The seller rejected your winning bid of ₹${a.current_price} for "${a.title}".`, a.id);
    return a.id;
  })();
}

export function confirmHandover(auctionId, userId, code, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const a = loadForSale(auctionId);
    requireSeller(a, userId);
    requireStatus(a, 'reserved', 'Only a reserved item can be handed over');
    if (String(code ?? '').trim() !== a.pickup_code) {
      throw new HttpError(400, "That code doesn't match. Ask the buyer to check the code on their auction page.");
    }
    setOutcome(a, 'completed', `Sold to ${a.winner_name} for ₹${a.current_price}. Handover confirmed on campus.`, now);
    notify(a.winner_id, 'sale_completed', `Handover confirmed. "${a.title}" is yours. Enjoy!`, a.id);
    return a.id;
  })();
}

export function reportFailedPickup(auctionId, userId, reason, { now = Date.now() } = {}) {
  return db.transaction(() => {
    const a = loadForSale(auctionId);
    const bySeller = a.seller_id === userId;
    if (!bySeller && a.winner_id !== userId) throw new HttpError(403, 'Only the seller or the winner can report this');
    requireStatus(a, 'reserved', 'Only a reserved item can have a failed pickup');
    const why = cleanReason(reason);
    setOutcome(a, 'failed_pickup', `Pickup failed (reported by the ${bySeller ? 'seller' : 'buyer'})${why ? `: ${why}` : '.'}`, now);
    notify(bySeller ? a.winner_id : a.seller_id, 'pickup_failed',
      `The pickup of "${a.title}" was marked as failed by the ${bySeller ? 'seller' : 'buyer'}.`, a.id);
    return a.id;
  })();
}
