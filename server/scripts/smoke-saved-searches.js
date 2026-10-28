// Live saved-search test against a running server: `npm run dev`, then `node scripts/smoke-saved-searches.js`.
import { io } from 'socket.io-client';

const ORIGIN = process.env.SERVER_URL || 'http://localhost:4000';
const BASE = `${ORIGIN}/api`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail !== '' ? `  (${detail})` : ''}`);
  if (!condition) failures++;
}

async function api(method, path, { token, json, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let body = form;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch(BASE + path, { method, headers, body });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function register(name) {
  const email = `${name.toLowerCase()}${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.edu`;
  return (await api('POST', '/auth/register', { json: { name, email, password: 'secret1' } })).data;
}

async function list(token, title, startPrice) {
  const form = new FormData();
  Object.entries({ title, category: 'calculator', condition: 'good', startPrice, minIncrement: 10, endsAt: Date.now() + 3600_000 })
    .forEach(([k, v]) => form.append(k, String(v)));
  form.append('photos', new Blob([PNG], { type: 'image/png' }), 'p.png');
  return (await api('POST', '/auctions', { token, form })).data.auction;
}

const tag = `zz${Date.now().toString(36)}`;
const seller = await register('Seller');
const online = await register('Online');
const offline = await register('Offline');

let r = await api('POST', '/saved-searches', { json: { keyword: 'x' } });
check('saving a search requires login', r.status === 401);

r = await api('POST', '/saved-searches', { token: online.token, json: { keyword: `${tag} scientific`, maxPrice: 400 } });
check('online student saves "scientific, up to ₹400"', r.status === 201, r.data?.search?.label);
await api('POST', '/saved-searches', { token: offline.token, json: { keyword: `${tag} scientific`, maxPrice: 400 } });

const inbox = [];
const socket = io(ORIGIN, { transports: ['websocket'], auth: { token: online.token } });
socket.on('notification', (n) => inbox.push(n));
await new Promise((resolve) => socket.on('connect', resolve));

const match = await list(seller.token, `Casio scientific calculator ${tag}`, 350);
const tooPricey = await list(seller.token, `Scientific calculator deluxe ${tag}`, 900);
await sleep(400);

check('online student got a live alert for the match', inbox.some((n) => n.type === 'saved_search_match' && n.auctionId === match.id));
check('no alert for the listing above their price', !inbox.some((n) => n.auctionId === tooPricey.id));

r = await api('GET', '/notifications', { token: offline.token });
check('offline student finds the alert waiting when they come back', r.data.notifications.some((n) => n.type === 'saved_search_match' && n.auctionId === match.id));

r = await api('GET', '/saved-searches', { token: online.token });
check('saved search shows 1 live match', r.data.searches[0]?.liveMatches === 1, r.data.searches[0]?.liveMatches);

r = await api('DELETE', `/saved-searches/${r.data.searches[0].id}`, { token: offline.token });
check("a student cannot delete someone else's saved search", r.status === 404);

socket.close();
for (const a of [match, tooPricey]) await api('POST', `/auctions/${a.id}/cancel`, { token: seller.token, json: { reason: 'test cleanup' } });
console.log(failures === 0 ? '\nAll saved-search checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
