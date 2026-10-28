// Demo data. `npm run seed` adds demo students and items if they don't exist yet.
// `npm run seed -- --reset` first deletes ALL data (users, auctions, bids, ...) so the demo starts clean.
// Safe to run while the server is running. Closing times are relative to "now", so seed shortly before a demo.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import db from '../src/db.js';
import { UPLOADS_DIR } from '../src/upload.js';
import { placeBid, setAutoBid } from '../src/services/bidEngine.js';
import { createSavedSearch } from '../src/services/savedSearches.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const PASSWORD = 'demo1234';

const STUDENTS = [
  { key: 'ravi', name: 'Ravi (Final year)', email: 'ravi@campus.demo' },
  { key: 'meena', name: 'Meena (Final year)', email: 'meena@campus.demo' },
  { key: 'priya', name: 'Priya (1st year)', email: 'priya@campus.demo' },
  { key: 'arjun', name: 'Arjun (1st year)', email: 'arjun@campus.demo' },
  { key: 'karthik', name: 'Karthik (2nd year)', email: 'karthik@campus.demo' },
];

const COLORS = {
  cycle: ['#1e9e5a', '#0f6b3c'],
  calculator: ['#2f5bea', '#1a3596'],
  books: ['#c77700', '#8a4f00'],
  electronics: ['#7a3fd1', '#4b2190'],
  other: ['#d83a6a', '#8f1f43'],
};

const ITEMS = [
  {
    seller: 'ravi', title: 'Hero Sprint 26" cycle', category: 'cycle', condition: 'good', start: 1500, inc: 50, closesIn: 2 * 24 * HOUR,
    description: 'Ridden daily to class for 3 years. Front and back brakes work well, new rear tyre in August. Small rust spot on the stand. Lock and key included.',
    bids: [['priya', 1500], ['arjun', 1550]], autoBids: [['karthik', 1800]],
  },
  {
    seller: 'ravi', title: 'Casio fx-991EX scientific calculator', category: 'calculator', condition: 'like_new', start: 350, inc: 20, closesIn: 6 * MIN,
    description: 'Allowed in university exams. Display is bright and clear, no faded segments. All buttons work. Original cover included.',
    bids: [['arjun', 350]],
  },
  {
    seller: 'meena', title: 'Engineering Mathematics by B.S. Grewal (44th ed.)', category: 'books', condition: 'good', start: 200, inc: 10, closesIn: 5 * HOUR,
    description: 'A few pages have pencil marks in chapters 3 and 4 that can be erased. No torn pages. Cover slightly bent.',
    bids: [['priya', 200], ['karthik', 210]],
  },
  {
    seller: 'meena', title: 'Mini drafter + drawing board kit', category: 'other', condition: 'good', start: 120, inc: 10, closesIn: 45 * MIN,
    description: 'Omega mini drafter with A2 board clips, set squares and a compass. Everything needed for first-year Engineering Graphics.',
    bids: [],
  },
  {
    seller: 'ravi', title: 'boAt Rockerz 450 Bluetooth headphones', category: 'electronics', condition: 'fair', start: 600, inc: 50, closesIn: 26 * HOUR,
    description: 'Battery still lasts about 8 hours. Left ear cushion is a little worn. Charging cable included, no box.',
    bids: [['karthik', 600]],
  },
  {
    seller: 'meena', title: 'Data Structures notes + Karumanchi book', category: 'books', condition: 'fair', start: 150, inc: 10, closesIn: 3 * HOUR,
    description: 'Handwritten notes for all 5 units plus "Data Structures and Algorithms Made Easy". Highlighting on many pages.',
    bids: [],
  },
  {
    seller: 'meena', title: 'Ladybird ladies cycle with basket', category: 'cycle', condition: 'fair', start: 1200, inc: 50, closesIn: 12 * MIN,
    description: 'Comfortable for hostel to campus rides. Chain was oiled last week. The bell is missing; basket is solid.',
    bids: [['priya', 1200]],
  },
  {
    seller: 'ravi', title: 'LED study table lamp (USB)', category: 'electronics', condition: 'like_new', start: 250, inc: 20, closesIn: 3 * MIN,
    description: 'Three brightness levels, foldable neck. Used for one semester only.',
    bids: [],
  },
];

function escapeXml(text) {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

function wrap(text, max = 24) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function coverImage(item, index) {
  const [from, to] = COLORS[item.category];
  const lines = wrap(item.title).map((l, i) =>
    `<text x="40" y="${250 + i * 44}" font-size="36" font-weight="700" fill="#fff">${escapeXml(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <circle cx="540" cy="90" r="140" fill="#fff" opacity="0.08"/>
  <circle cx="600" cy="420" r="90" fill="#fff" opacity="0.06"/>
  <text x="40" y="90" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" fill="#fff" opacity="0.85" letter-spacing="4">${item.category.toUpperCase()}</text>
  <g font-family="Segoe UI, Arial, sans-serif">${lines}</g>
  <text x="40" y="440" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#fff" opacity="0.7">Campus Auction demo listing</text>
</svg>`;
  const file = `demo-${index + 1}-${item.category}.svg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), svg);
  return `/uploads/${file}`;
}

function resetAll() {
  db.transaction(() => {
    for (const table of ['notifications', 'saved_searches', 'questions', 'auto_bids', 'bids', 'auctions', 'users']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare("DELETE FROM sqlite_sequence").run();
  })();
  for (const f of fs.readdirSync(UPLOADS_DIR)) fs.rmSync(path.join(UPLOADS_DIR, f), { force: true });
  console.log('Reset: all users, auctions, bids and uploads deleted.');
}

if (process.argv.includes('--reset')) resetAll();

if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(STUDENTS[0].email)) {
  console.log('Demo data already exists. Use `npm run seed -- --reset` to start fresh.');
  process.exit(0);
}

const now = Date.now();
const hash = bcrypt.hashSync(PASSWORD, 10);
const ids = {};
for (const s of STUDENTS) {
  ids[s.key] = Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(s.name, s.email, hash, now - 3 * 24 * HOUR).lastInsertRowid);
}

createSavedSearch(ids.priya, { keyword: 'scientific calculator', maxPrice: 400 }, { now: now - 2 * HOUR });
createSavedSearch(ids.arjun, { category: 'cycle', maxPrice: 2000 }, { now: now - 2 * HOUR });

ITEMS.forEach((item, index) => {
  const createdAt = now - (2 + index) * HOUR;
  const auctionId = Number(db.prepare(`
    INSERT INTO auctions (seller_id, title, category, description, condition, photos_json, start_price, min_increment, ends_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`).run(
    ids[item.seller], item.title, item.category, item.description, item.condition, JSON.stringify([coverImage(item, index)]),
    item.start, item.inc, now + item.closesIn, createdAt, createdAt,
  ).lastInsertRowid);

  let t = createdAt + 10 * MIN;
  for (const [who, amount] of item.bids) placeBid(auctionId, ids[who], amount, { now: (t += 7 * MIN) });
  for (const [who, max] of item.autoBids ?? []) setAutoBid(auctionId, ids[who], max, { now: (t += 7 * MIN) });
});

console.log(`Seeded ${STUDENTS.length} students and ${ITEMS.length} live auctions.`);
console.log(`Log in with any of: ${STUDENTS.map((s) => s.email).join(', ')}  (password: ${PASSWORD})`);
