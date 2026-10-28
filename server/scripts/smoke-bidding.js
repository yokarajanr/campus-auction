// Live bidding test against a running server: `npm run dev`, then `node scripts/smoke-bidding.js`.
// To avoid waiting minutes, it moves closing times forward directly in the database.
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { io } from 'socket.io-client';

const ORIGIN = process.env.SERVER_URL || 'http://localhost:4000';
const BASE = `${ORIGIN}/api`;
const db = new Database(fileURLToPath(new URL('../data/campus.db', import.meta.url)));
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

async function createAuction(token, title) {
  const form = new FormData();
  Object.entries({ title, category: 'cycle', condition: 'good', description: 'smoke test', startPrice: 1000, minIncrement: 50, endsAt: Date.now() + 3600_000 })
    .forEach(([k, v]) => form.append(k, String(v)));
  form.append('photos', new Blob([PNG], { type: 'image/png' }), 'p.png');
  return (await api('POST', '/auctions', { token, form })).data.auction;
}

const setEndsAt = (id, ms) => db.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(ms, id);

const seller = await register('Seller');
const asha = await register('Asha');
const bala = await register('Bala');
const crowd = await Promise.all(['C1', 'C2', 'C3', 'C4', 'C5'].map(register));

const cycle = await createAuction(seller.token, 'Smoke test cycle');

const events = [];
const socket = io(ORIGIN, { transports: ['websocket'] });
await new Promise((resolve) => socket.on('connect', resolve));
socket.emit('auction:join', cycle.id);
socket.on('auction:update', (p) => events.push(p));
await sleep(200);

let r = await api('POST', `/auctions/${cycle.id}/bids`, { json: { amount: 1000 } });
check('bidding requires login', r.status === 401);

r = await api('POST', `/auctions/${cycle.id}/bids`, { token: asha.token, json: { amount: 900 } });
check('first bid below starting price rejected', r.status === 409, r.data?.error);

r = await api('POST', `/auctions/${cycle.id}/bids`, { token: asha.token, json: { amount: 1000 } });
check('first bid at starting price accepted', r.status === 201 && r.data.auction.currentPrice === 1000);

r = await api('POST', `/auctions/${cycle.id}/bids`, { token: bala.token, json: { amount: 1020 } });
check('bid below current + increment rejected', r.status === 409, r.data?.error);

r = await api('POST', `/auctions/${cycle.id}/bids`, { token: seller.token, json: { amount: 5000 } });
check('seller cannot bid', r.status === 403);

r = await api('POST', `/auctions/${cycle.id}/bids`, { token: bala.token, json: { amount: 1050 } });
check('valid outbid accepted, history has 2 bids', r.status === 201 && r.data.bids.length === 2 && r.data.bids[0].bidderName === 'Bala');

await sleep(300);
check('watchers received live bid events', events.filter((e) => e.reason === 'bid').length === 2, events.length);

const results = await Promise.all(crowd.map((u) => api('POST', `/auctions/${cycle.id}/bids`, { token: u.token, json: { amount: 1100 } })));
const accepted = results.filter((x) => x.status === 201).length;
check('5 simultaneous bids of the same amount: exactly 1 accepted', accepted === 1, `${accepted} accepted`);
const detail = (await api('GET', `/auctions/${cycle.id}`)).data;
check('price and history stay consistent after the race', detail.auction.currentPrice === 1100 && detail.bids.length === 3);

const outbid = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type = 'outbid' AND auction_id = ?").get(asha.user.id, cycle.id).c;
check('outbid student got a notification', outbid === 1);

setEndsAt(cycle.id, Date.now() + 20_000);
const before = Date.now();
r = await api('POST', `/auctions/${cycle.id}/bids`, { token: asha.token, json: { amount: 1200 } });
const newEnd = r.data?.auction.endsAt;
const SKEW_MS = 100; // test and server are separate processes; allow small clock-read differences
check('bid with 20s left extends closing to ~60s after the bid',
  r.data?.extended === true && newEnd >= before + 60_000 - SKEW_MS && newEnd <= Date.now() + 60_000 + SKEW_MS,
  `${Math.round((newEnd - Date.now()) / 1000)}s left`);
await sleep(300);
check('watchers were told about the extension', events.some((e) => e.reason === 'bid' && e.extended === true && e.endsAt === newEnd));

setEndsAt(cycle.id, Date.now() + 500);
await sleep(2500);
const closed = (await api('GET', `/auctions/${cycle.id}`)).data.auction;
check('closing job closed it: highest bidder is provisional winner', closed.status === 'awaiting_seller' && closed.winnerName === 'Asha' && closed.currentPrice === 1200, closed.status);
check('watchers received the close event', events.some((e) => e.reason === 'closed'));

r = await api('POST', `/auctions/${cycle.id}/bids`, { token: bala.token, json: { amount: 2000 } });
check('bid after closing rejected', r.status === 409, r.data?.error);

const lonely = await createAuction(seller.token, 'Smoke test nobody wants');
setEndsAt(lonely.id, Date.now() + 500);
await sleep(2500);
const unsold = (await api('GET', `/auctions/${lonely.id}`)).data.auction;
check('auction with no bids becomes unsold', unsold.status === 'unsold', unsold.status);

socket.close();
db.close();
console.log(failures === 0 ? '\nAll bidding checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
