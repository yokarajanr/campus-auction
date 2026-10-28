import db from '../db.js';
import { HttpError } from '../errors.js';
import { CATEGORIES, CONDITIONS, searchAuctions } from './auctions.js';
import { notify } from './realtime.js';

export function describeSearch(s) {
  const parts = [s.keyword || (s.category ? s.category : 'anything')];
  if (s.keyword && s.category) parts.push(`in ${s.category}`);
  if (s.condition) parts.push(`(${s.condition.replace('_', ' ')})`);
  if (s.max_price != null) parts.push(`up to ₹${s.max_price}`);
  return parts.join(' ');
}

export function matchesSearch(s, a) {
  const haystack = `${a.title} ${a.description} ${a.category}`.toLowerCase();
  const words = String(s.keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.every((w) => haystack.includes(w))) return false;
  if (s.category && s.category !== a.category) return false;
  if (s.condition && s.condition !== a.condition) return false;
  const price = a.current_price ?? a.start_price;
  if (s.max_price != null && price > s.max_price) return false;
  return true;
}

// Called once when a listing is published. Notifications are stored, so students who are offline see them later.
export function notifySavedSearchMatches(auctionId) {
  const a = db.prepare('SELECT * FROM auctions WHERE id = ?').get(auctionId);
  if (!a || a.status !== 'live') return 0;
  const searches = db.prepare('SELECT * FROM saved_searches WHERE user_id != ? ORDER BY id').all(a.seller_id);
  const notified = new Set();
  for (const s of searches) {
    if (notified.has(s.user_id) || !matchesSearch(s, a)) continue;
    notified.add(s.user_id);
    notify(s.user_id, 'saved_search_match',
      `New listing for "${describeSearch(s)}": "${a.title}", starting at ₹${a.start_price}.`, a.id);
  }
  return notified.size;
}

function toPublic(s) {
  return {
    id: s.id,
    keyword: s.keyword,
    category: s.category,
    condition: s.condition,
    maxPrice: s.max_price,
    label: describeSearch(s),
    createdAt: s.created_at,
  };
}

function liveMatches(s) {
  return searchAuctions({ q: s.keyword, category: s.category, condition: s.condition, maxPrice: s.max_price ?? undefined });
}

export function listSavedSearches(userId) {
  return db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC').all(userId)
    .map((s) => ({ ...toPublic(s), liveMatches: liveMatches(s).length }));
}

export function createSavedSearch(userId, input, { now = Date.now() } = {}) {
  const keyword = String(input.keyword ?? '').trim().slice(0, 80);
  const category = input.category || null;
  const condition = input.condition || null;
  const rawMax = input.maxPrice;
  const maxPrice = rawMax === undefined || rawMax === null || rawMax === '' ? null : Number(rawMax);

  if (category && !CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown category');
  if (condition && !CONDITIONS.includes(condition)) throw new HttpError(400, 'Unknown condition');
  if (maxPrice != null && (!Number.isInteger(maxPrice) || maxPrice < 0)) throw new HttpError(400, 'Maximum price must be a whole number of rupees');
  if (!keyword && !category) throw new HttpError(400, 'Say what you are looking for: a keyword or a category');

  const count = db.prepare('SELECT COUNT(*) AS c FROM saved_searches WHERE user_id = ?').get(userId).c;
  if (count >= 20) throw new HttpError(409, 'You can save up to 20 searches. Delete one first.');

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO saved_searches (user_id, keyword, category, condition, max_price, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, keyword, category, condition, maxPrice, now);
  const saved = db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(lastInsertRowid);
  return { search: toPublic(saved), currentMatches: liveMatches(saved) };
}

export function deleteSavedSearch(userId, id) {
  const { changes } = db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(id, userId);
  if (changes === 0) throw new HttpError(404, 'Saved search not found');
}
