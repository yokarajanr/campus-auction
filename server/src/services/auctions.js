import db from '../db.js';

export const CATEGORIES = ['cycle', 'calculator', 'books', 'electronics', 'other'];
export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor'];
const CLOSING_SOON_MS = 24 * 60 * 60 * 1000;

const BASE_SELECT = `
  SELECT a.*, s.name AS seller_name, l.name AS leader_name, w.name AS winner_name,
         (SELECT COUNT(*) FROM bids b WHERE b.auction_id = a.id) AS bid_count
  FROM auctions a
  JOIN users s ON s.id = a.seller_id
  LEFT JOIN users l ON l.id = a.leader_id
  LEFT JOIN users w ON w.id = a.winner_id`;

export function nextMinBid(row) {
  return row.current_price == null ? row.start_price : row.current_price + row.min_increment;
}

export function getAuctionRow(id) {
  return db.prepare(`${BASE_SELECT} WHERE a.id = ?`).get(id);
}

// Never includes pickup_code or any email address.
export function toPublicAuction(row) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    title: row.title,
    category: row.category,
    description: row.description,
    condition: row.condition,
    photos: JSON.parse(row.photos_json),
    startPrice: row.start_price,
    minIncrement: row.min_increment,
    endsAt: row.ends_at,
    status: row.status,
    currentPrice: row.current_price,
    leaderId: row.leader_id,
    leaderName: row.leader_name,
    winnerId: row.winner_id,
    winnerName: row.winner_name,
    bidCount: row.bid_count,
    nextMinBid: nextMinBid(row),
    outcomeNote: row.outcome_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The pickup code is only revealed to the winner while the item is reserved.
export function auctionDetail(id, { viewerId = null } = {}) {
  const row = getAuctionRow(id);
  if (!row) return null;
  const bids = db.prepare(`
    SELECT b.id, b.bidder_id AS bidderId, u.name AS bidderName, b.amount, b.is_auto AS isAuto, b.created_at AS createdAt
    FROM bids b JOIN users u ON u.id = b.bidder_id
    WHERE b.auction_id = ? ORDER BY b.id DESC`).all(id);
  const autoBids = db.prepare(`
    SELECT ab.user_id AS userId, u.name AS userName, ab.max_amount AS maxAmount, ab.updated_at AS updatedAt
    FROM auto_bids ab JOIN users u ON u.id = ab.user_id
    WHERE ab.auction_id = ? AND ab.active = 1 ORDER BY ab.max_amount DESC`).all(id);
  return {
    auction: toPublicAuction(row),
    bids: bids.map((b) => ({ ...b, isAuto: Boolean(b.isAuto) })),
    autoBids,
    pickupCode: viewerId != null && viewerId === row.winner_id && row.status === 'reserved' ? row.pickup_code : null,
    serverNow: Date.now(),
  };
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function searchAuctions({ q, category, condition, minPrice, maxPrice, closingSoon, sort } = {}) {
  const now = Date.now();
  const where = ["a.status = 'live'", 'a.ends_at > ?'];
  const params = [now];

  for (const word of String(q ?? '').trim().split(/\s+/).filter(Boolean)) {
    const like = `%${escapeLike(word)}%`;
    where.push("(a.title LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\' OR a.category LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if (category) { where.push('a.category = ?'); params.push(category); }
  if (condition) { where.push('a.condition = ?'); params.push(condition); }
  if (minPrice != null) { where.push('COALESCE(a.current_price, a.start_price) >= ?'); params.push(minPrice); }
  if (maxPrice != null) { where.push('COALESCE(a.current_price, a.start_price) <= ?'); params.push(maxPrice); }
  if (closingSoon) { where.push('a.ends_at <= ?'); params.push(now + CLOSING_SOON_MS); }

  const orderBy = {
    closing_soon: 'a.ends_at ASC',
    price_asc: 'COALESCE(a.current_price, a.start_price) ASC',
    price_desc: 'COALESCE(a.current_price, a.start_price) DESC',
    newest: 'a.created_at DESC',
  }[sort] || (closingSoon ? 'a.ends_at ASC' : 'a.created_at DESC');

  return db
    .prepare(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT 100`)
    .all(...params)
    .map(toPublicAuction);
}
