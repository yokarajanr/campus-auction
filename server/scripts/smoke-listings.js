// Smoke test for listings against a running server: `npm run dev`, then `node scripts/smoke-listings.js`.
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const BASE = process.env.API_URL || 'http://localhost:4000/api';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
let failures = 0;

function check(label, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!condition) failures++;
}

async function api(method, path, { token, json, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(BASE + path, { method, headers, body });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function register(name) {
  const r = await api('POST', '/auth/register', {
    json: { name, email: `${name.toLowerCase()}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.edu`, password: 'secret1' },
  });
  return r.data;
}

function listingForm(fields, photoCount = 1) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  for (let i = 0; i < photoCount; i++) form.append('photos', new Blob([PNG], { type: 'image/png' }), `p${i}.png`);
  return form;
}

const tag = `zq${Date.now().toString(36)}`;
const inHours = (h) => Date.now() + h * 3600 * 1000;
const base = { category: 'calculator', condition: 'good', description: `Casio fx-991 ${tag}`, startPrice: 300, minIncrement: 20 };

const seller = await register('Seller');
const buyer = await register('Buyer');

let r = await api('POST', '/auctions', { form: listingForm({ ...base, title: 'Scientific calculator', endsAt: inHours(2) }) });
check('create without login is rejected', r.status === 401, r.status);

r = await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Scientific calculator', endsAt: inHours(2) }, 0) });
check('create without photo is rejected', r.status === 400, r.data?.error);

r = await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Scientific calculator', startPrice: -5, endsAt: inHours(2) }) });
check('negative starting price is rejected', r.status === 400, r.data?.error);

r = await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Scientific calculator', endsAt: Date.now() + 5000 }) });
check('closing time under 1 minute is rejected', r.status === 400, r.data?.error);

r = await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Scientific calculator', category: 'spaceship', endsAt: inHours(2) }) });
check('unknown category is rejected', r.status === 400, r.data?.error);

r = await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Scientific calculator', endsAt: new Date(inHours(2)).toISOString() }, 2) });
const calc = r.data?.auction;
check('valid listing with 2 photos is created', r.status === 201 && calc?.photos.length === 2, r.status);
check('new listing has no bids and next min bid = start price', calc?.bidCount === 0 && calc?.nextMinBid === 300);
check('listing response does not leak emails', !JSON.stringify(r.data).includes('@'));

const photo = await fetch(BASE.replace('/api', '') + calc.photos[0]);
check('uploaded photo is served', photo.status === 200 && photo.headers.get('content-type') === 'image/png', photo.status);

r = await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Hero cycle', category: 'cycle', condition: 'fair', startPrice: 1500, minIncrement: 50, endsAt: inHours(48) }) });
const cycle = r.data?.auction;
check('second listing (cycle, closes in 48h) is created', r.status === 201);

r = await api('GET', `/auctions?q=${tag}`);
check('keyword search finds both test items', r.data?.auctions.length === 2, r.data?.auctions.length);

r = await api('GET', `/auctions?q=${tag}%20casio%20fx`);
check('multi-word search matches all words', r.data?.auctions.length === 2);

r = await api('GET', `/auctions?q=${tag}&category=cycle`);
check('category filter', r.data?.auctions.length === 1 && r.data.auctions[0].id === cycle.id);

r = await api('GET', `/auctions?q=${tag}&condition=good`);
check('condition filter', r.data?.auctions.length === 1 && r.data.auctions[0].id === calc.id);

r = await api('GET', `/auctions?q=${tag}&maxPrice=1000`);
check('max price filter', r.data?.auctions.length === 1 && r.data.auctions[0].id === calc.id);

r = await api('GET', `/auctions?q=${tag}&minPrice=1000`);
check('min price filter', r.data?.auctions.length === 1 && r.data.auctions[0].id === cycle.id);

r = await api('GET', `/auctions?q=${tag}&closingSoon=1`);
check('closing soon (24h) filter', r.data?.auctions.length === 1 && r.data.auctions[0].id === calc.id);

r = await api('GET', '/auctions?q=100%25');
check('search with % does not crash', r.status === 200);

r = await api('GET', `/auctions/${calc.id}`);
check('detail has bids, autoBids and serverNow', Array.isArray(r.data?.bids) && Array.isArray(r.data?.autoBids) && typeof r.data?.serverNow === 'number');

r = await api('GET', '/auctions/999999');
check('missing auction returns 404', r.status === 404);

r = await api('PATCH', `/auctions/${calc.id}`, { token: buyer.token, json: { title: 'Hacked' } });
check('non-seller cannot edit', r.status === 403, r.data?.error);

r = await api('PATCH', `/auctions/${calc.id}`, { token: seller.token, json: { title: 'Casio scientific calculator', startPrice: 280 } });
check('seller edits title and price before any bid', r.status === 200 && r.data.auction.title === 'Casio scientific calculator' && r.data.auction.startPrice === 280);

r = await api('PATCH', `/auctions/${calc.id}`, { token: seller.token, json: { keepPhotos: JSON.stringify([calc.photos[0]]) } });
check('seller removes a photo before any bid', r.status === 200 && r.data.auction.photos.length === 1);

// Bidding arrives in M3; insert one bid directly so the edit lock can be tested now.
const db = new Database(fileURLToPath(new URL('../data/campus.db', import.meta.url)));
db.prepare('INSERT INTO bids (auction_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?)').run(calc.id, buyer.user.id, 280, Date.now());
db.prepare('UPDATE auctions SET current_price = 280, leader_id = ? WHERE id = ?').run(buyer.user.id, calc.id);
db.close();

r = await api('PATCH', `/auctions/${calc.id}`, { token: seller.token, json: { startPrice: 10 } });
check('price is locked after the first bid', r.status === 409, r.data?.error);

r = await api('PATCH', `/auctions/${calc.id}`, { token: seller.token, json: { endsAt: inHours(10) } });
check('closing time is locked after the first bid', r.status === 409);

r = await api('PATCH', `/auctions/${calc.id}`, { token: seller.token, json: { description: 'Display is perfect, cover included' } });
check('description can still change after the first bid', r.status === 200 && r.data.auction.description.startsWith('Display'));

r = await api('POST', `/auctions/${calc.id}/cancel`, { token: buyer.token, json: {} });
check('non-seller cannot cancel', r.status === 403);

r = await api('POST', `/auctions/${calc.id}/cancel`, { token: seller.token, json: { reason: 'Sold to a friend' } });
check('seller cancels with a recorded outcome', r.status === 200 && r.data.auction.status === 'cancelled' && r.data.auction.outcomeNote === 'Cancelled by seller: Sold to a friend');

r = await api('PATCH', `/auctions/${calc.id}`, { token: seller.token, json: { description: 'x' } });
check('cancelled listing can no longer be edited', r.status === 409);

r = await api('GET', `/auctions?q=${tag}`);
check('cancelled listing disappears from browse', r.data?.auctions.length === 1 && r.data.auctions[0].id === cycle.id);

r = await api('GET', '/auctions/mine', { token: seller.token });
check('seller sees both listings (incl. cancelled) in /mine', r.data?.auctions.length === 2);

r = await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Relist me', relistFrom: cycle.id, endsAt: inHours(5) }, 0) });
check('a live item cannot be listed again', r.status === 409, r.data?.error);

const lamp = (await api('POST', '/auctions', { token: seller.token, form: listingForm({ ...base, title: 'Study lamp', category: 'electronics', endsAt: inHours(1) }, 2) })).data.auction;
const closeDb = new Database(fileURLToPath(new URL('../data/campus.db', import.meta.url)));
closeDb.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(Date.now() - 1, lamp.id);
closeDb.close();
await new Promise((resolve) => setTimeout(resolve, 2000));
check('lamp with no bids closed as unsold', (await api('GET', `/auctions/${lamp.id}`)).data.auction.status === 'unsold');

r = await api('POST', '/auctions', { token: buyer.token, form: listingForm({ ...base, title: 'Study lamp', relistFrom: lamp.id, endsAt: inHours(5) }, 0) });
check("someone else cannot list the seller's item again", r.status === 403);

r = await api('POST', '/auctions', {
  token: seller.token,
  form: listingForm({ ...base, title: 'Study lamp', category: 'electronics', relistFrom: lamp.id, keepPhotos: JSON.stringify([lamp.photos[0]]), endsAt: inHours(5) }, 0),
});
const relisted = r.data?.auction;
check('seller lists the unsold item again with its photo', r.status === 201 && relisted.status === 'live' && relisted.photos.length === 1, r.data?.error ?? '');
check('relisted photo is a separate copy that is served', relisted && relisted.photos[0] !== lamp.photos[0]
  && (await fetch(BASE.replace('/api', '') + relisted.photos[0])).status === 200);
check('new auction accepts bids', (await api('POST', `/auctions/${relisted.id}/bids`, { token: buyer.token, json: { amount: 300 } })).status === 201);
check('the earlier auction stays unsold in history', (await api('GET', `/auctions/${lamp.id}`)).data.auction.status === 'unsold');

await api('POST', `/auctions/${cycle.id}/cancel`, { token: seller.token, json: { reason: 'test cleanup' } });
await api('POST', `/auctions/${relisted.id}/cancel`, { token: seller.token, json: { reason: 'test cleanup' } });

console.log(failures === 0 ? '\nAll listing checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
