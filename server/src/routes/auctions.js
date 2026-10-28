import { Router } from 'express';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { optionalAuth, requireAuth } from '../auth.js';
import { uploadPhotos, photoUrl, deletePhotoFiles, MAX_PHOTOS } from '../upload.js';
import { CATEGORIES, CONDITIONS, getAuctionRow, auctionDetail, searchAuctions, toPublicAuction } from '../services/auctions.js';
import { emitAuctionUpdate, notify } from '../services/realtime.js';

const router = Router();
const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function toInt(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function parseClosingTime(value) {
  const t = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(t)) throw new HttpError(400, 'Closing time is invalid');
  const now = Date.now();
  if (t < now + MIN_DURATION_MS) throw new HttpError(400, 'Closing time must be at least 1 minute from now');
  if (t > now + MAX_DURATION_MS) throw new HttpError(400, 'Closing time must be within 30 days');
  return t;
}

// Returns DB column names -> cleaned values. With partial=true only provided fields are validated.
function parseListing(body, { partial }) {
  const given = (key) => body[key] !== undefined && body[key] !== '';
  const out = {};

  if (!partial || given('title')) {
    const title = String(body.title ?? '').trim();
    if (title.length < 3 || title.length > 80) throw new HttpError(400, 'Title must be 3-80 characters');
    out.title = title;
  }
  if (!partial || given('category')) {
    if (!CATEGORIES.includes(body.category)) throw new HttpError(400, `Category must be one of: ${CATEGORIES.join(', ')}`);
    out.category = body.category;
  }
  if (!partial || given('condition')) {
    if (!CONDITIONS.includes(body.condition)) throw new HttpError(400, `Condition must be one of: ${CONDITIONS.join(', ')}`);
    out.condition = body.condition;
  }
  if (!partial || body.description !== undefined) {
    const description = String(body.description ?? '').trim();
    if (description.length > 2000) throw new HttpError(400, 'Description must be under 2000 characters');
    out.description = description;
  }
  if (!partial || given('startPrice')) out.start_price = toInt(body.startPrice, 'Starting price', 0, 1_000_000);
  if (!partial || given('minIncrement')) out.min_increment = toInt(body.minIncrement, 'Minimum increment', 1, 100_000);
  if (!partial || given('endsAt')) out.ends_at = parseClosingTime(body.endsAt);
  return out;
}

function parseOptionalInt(value, label) {
  if (value === undefined || value === '') return undefined;
  return toInt(value, label, 0, 10_000_000);
}

function loadOwnedOpenAuction(id, userId) {
  const row = getAuctionRow(id);
  if (!row) throw new HttpError(404, 'Auction not found');
  if (row.seller_id !== userId) throw new HttpError(403, 'Only the seller can do this');
  if (row.status !== 'live' || row.ends_at <= Date.now()) throw new HttpError(409, 'This auction is no longer open');
  return row;
}

function withUploadCleanup(handler) {
  return (req, res) => {
    try {
      return handler(req, res);
    } catch (err) {
      deletePhotoFiles((req.files ?? []).map(photoUrl));
      throw err;
    }
  };
}

router.get('/', (req, res) => {
  const { q, category, condition, sort } = req.query;
  if (category && !CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown category');
  if (condition && !CONDITIONS.includes(condition)) throw new HttpError(400, 'Unknown condition');
  const auctions = searchAuctions({
    q,
    category,
    condition,
    sort,
    minPrice: parseOptionalInt(req.query.minPrice, 'Minimum price'),
    maxPrice: parseOptionalInt(req.query.maxPrice, 'Maximum price'),
    closingSoon: req.query.closingSoon === '1' || req.query.closingSoon === 'true',
  });
  res.json({ auctions, serverNow: Date.now() });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id FROM auctions WHERE seller_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ auctions: rows.map((r) => toPublicAuction(getAuctionRow(r.id))), serverNow: Date.now() });
});

router.get('/bidding', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT auction_id AS id FROM bids WHERE bidder_id = ? GROUP BY auction_id ORDER BY MAX(id) DESC`).all(req.user.id);
  res.json({ auctions: rows.map((r) => toPublicAuction(getAuctionRow(r.id))), serverNow: Date.now() });
});

router.get('/:id', optionalAuth, (req, res) => {
  const detail = auctionDetail(Number(req.params.id), { viewerId: req.user?.id });
  if (!detail) throw new HttpError(404, 'Auction not found');
  res.json(detail);
});

router.post('/', requireAuth, uploadPhotos, withUploadCleanup((req, res) => {
  const fields = parseListing(req.body ?? {}, { partial: false });
  const photos = (req.files ?? []).map(photoUrl);
  if (photos.length === 0) throw new HttpError(400, 'Add at least one photo');

  const now = Date.now();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO auctions (seller_id, title, category, description, condition, photos_json,
                          start_price, min_increment, ends_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`).run(
    req.user.id, fields.title, fields.category, fields.description, fields.condition, JSON.stringify(photos),
    fields.start_price, fields.min_increment, fields.ends_at, now, now,
  );

  const id = Number(lastInsertRowid);
  emitAuctionUpdate(id, { reason: 'created' });
  res.status(201).json(auctionDetail(id));
}));

router.patch('/:id', requireAuth, uploadPhotos, withUploadCleanup((req, res) => {
  const row = loadOwnedOpenAuction(Number(req.params.id), req.user.id);
  const body = req.body ?? {};
  const fields = parseListing(body, { partial: true });
  const hasBids = row.bid_count > 0;

  if (hasBids) {
    const changedLocked = Object.keys(fields).filter((k) => k !== 'description' && fields[k] !== row[k]);
    if (changedLocked.length > 0) {
      throw new HttpError(409, 'After the first bid you can only change the description and add photos');
    }
  }

  let photos = JSON.parse(row.photos_json);
  let removed = [];
  if (body.keepPhotos !== undefined) {
    let keep;
    try { keep = JSON.parse(body.keepPhotos); } catch { throw new HttpError(400, 'keepPhotos must be a JSON array'); }
    if (!Array.isArray(keep)) throw new HttpError(400, 'keepPhotos must be a JSON array');
    removed = photos.filter((p) => !keep.includes(p));
    if (hasBids && removed.length > 0) throw new HttpError(409, 'Photos cannot be removed after the first bid');
    photos = photos.filter((p) => keep.includes(p));
  }
  photos = [...photos, ...(req.files ?? []).map(photoUrl)];
  if (photos.length === 0) throw new HttpError(400, 'Keep at least one photo');
  if (photos.length > MAX_PHOTOS) throw new HttpError(400, `A listing can have at most ${MAX_PHOTOS} photos`);

  const updates = { ...fields, photos_json: JSON.stringify(photos), updated_at: Date.now() };
  const columns = Object.keys(updates);
  db.prepare(`UPDATE auctions SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...columns.map((c) => updates[c]), row.id);

  deletePhotoFiles(removed);
  emitAuctionUpdate(row.id, { reason: 'edited' });
  res.json(auctionDetail(row.id));
}));

router.post('/:id/cancel', requireAuth, (req, res) => {
  const row = loadOwnedOpenAuction(Number(req.params.id), req.user.id);
  const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
  const note = reason ? `Cancelled by seller: ${reason}` : 'Cancelled by seller';

  db.transaction(() => {
    db.prepare("UPDATE auctions SET status = 'cancelled', outcome_note = ?, updated_at = ? WHERE id = ?")
      .run(note, Date.now(), row.id);
    const bidders = db.prepare('SELECT DISTINCT bidder_id FROM bids WHERE auction_id = ?').all(row.id);
    for (const { bidder_id } of bidders) {
      notify(bidder_id, 'auction_cancelled', `"${row.title}" was cancelled by the seller.`, row.id);
    }
  })();

  emitAuctionUpdate(row.id, { reason: 'cancelled' });
  res.json(auctionDetail(row.id));
});

export default router;
