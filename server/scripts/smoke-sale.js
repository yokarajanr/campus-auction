// Live sale-flow test against a running server: `npm run dev`, then `node scripts/smoke-sale.js`.
// Moves closing times forward directly in the database so it doesn't have to wait.
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

async function closedWithWinner(seller, winner, title) {
  const form = new FormData();
  Object.entries({ title, category: 'books', condition: 'good', startPrice: 200, minIncrement: 10, endsAt: Date.now() + 3600_000 })
    .forEach(([k, v]) => form.append(k, String(v)));
  form.append('photos', new Blob([PNG], { type: 'image/png' }), 'p.png');
  const { auction } = (await api('POST', '/auctions', { token: seller.token, form })).data;
  await api('POST', `/auctions/${auction.id}/bids`, { token: winner.token, json: { amount: 250 } });
  db.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(Date.now() + 300, auction.id);
  await sleep(2000);
  return auction.id;
}

function listen(user) {
  const events = [];
  const socket = io(ORIGIN, { transports: ['websocket'], auth: { token: user.token } });
  socket.on('notification', (n) => events.push(n));
  return { socket, events, ready: new Promise((r) => socket.on('connect', r)) };
}

const seller = await register('Seller');
const winner = await register('Winner');
const other = await register('Other');
const winnerInbox = listen(winner);
const otherInbox = listen(other);
await Promise.all([winnerInbox.ready, otherInbox.ready]);

const a = await closedWithWinner(seller, winner, 'Smoke test DSA book');
let d = (await api('GET', `/auctions/${a}`)).data;
check('closed auction is awaiting the seller with a provisional winner', d.auction.status === 'awaiting_seller' && d.auction.winnerName === 'Winner');
check('winner was notified live about the provisional win', winnerInbox.events.some((n) => n.type === 'provisional_win' && n.auctionId === a));

let r = await api('POST', `/auctions/${a}/approve`, { token: winner.token });
check('winner cannot approve their own win', r.status === 403);

r = await api('POST', `/auctions/${a}/approve`, { token: seller.token });
check('seller approves -> reserved', r.status === 200 && r.data.auction.status === 'reserved', r.data?.auction?.status);
check('seller does not see the pickup code', r.data.pickupCode === null);
await sleep(300);

const asWinner = (await api('GET', `/auctions/${a}`, { token: winner.token })).data;
const asOther = (await api('GET', `/auctions/${a}`, { token: other.token })).data;
const anonymous = (await api('GET', `/auctions/${a}`)).data;
const code = asWinner.pickupCode;
check('winner sees a 4-digit pickup code', /^\d{4}$/.test(code ?? ''), code);
check('other students and visitors do not see the code', asOther.pickupCode === null && anonymous.pickupCode === null);
check('winner got the code in a live notification', winnerInbox.events.some((n) => n.type === 'sale_approved' && n.message.includes(code)));
check("the code never reached another student's socket", !otherInbox.events.some((n) => n.message.includes(code)));

r = await api('POST', `/auctions/${a}/handover`, { token: seller.token, json: { code: code === '0000' ? '1111' : '0000' } });
check('wrong pickup code is rejected', r.status === 400, r.data?.error);

r = await api('POST', `/auctions/${a}/handover`, { token: seller.token, json: { code } });
check('correct code completes the sale', r.status === 200 && r.data.auction.status === 'completed', r.data?.auction?.outcomeNote);

const b = await closedWithWinner(seller, winner, 'Smoke test reject');
r = await api('POST', `/auctions/${b}/reject`, { token: seller.token, json: { reason: 'Expected more' } });
check('seller rejects with a recorded reason', r.data?.auction.status === 'rejected' && r.data.auction.outcomeNote.includes('Expected more'));

const c = await closedWithWinner(seller, winner, 'Smoke test failed pickup');
await api('POST', `/auctions/${c}/approve`, { token: seller.token });
r = await api('POST', `/auctions/${c}/failed-pickup`, { token: other.token, json: { reason: 'x' } });
check('a stranger cannot report failed pickup', r.status === 403);
r = await api('POST', `/auctions/${c}/failed-pickup`, { token: winner.token, json: { reason: 'Seller did not turn up' } });
check('winner reports failed pickup with a clear outcome', r.data?.auction.status === 'failed_pickup', r.data?.auction?.outcomeNote);

r = await api('GET', '/auctions/bidding', { token: winner.token });
check('My bids lists all 3 auctions the winner bid on', r.data?.auctions.length === 3);

r = await api('GET', '/notifications', { token: winner.token });
check('notification history is stored for offline users', r.data?.notifications.length >= 5 && r.data.unread >= 5, `${r.data?.unread} unread`);
await api('POST', '/notifications/read', { token: winner.token });
r = await api('GET', '/notifications', { token: winner.token });
check('mark all as read', r.data?.unread === 0);

r = await api('GET', '/notifications');
check('notifications require login', r.status === 401);

winnerInbox.socket.close();
otherInbox.socket.close();
db.close();
console.log(failures === 0 ? '\nAll sale-flow checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
