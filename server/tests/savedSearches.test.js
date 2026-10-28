import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { default: db } = await import('../src/db.js');
const { createSavedSearch, deleteSavedSearch, listSavedSearches, notifySavedSearchMatches, matchesSearch } =
  await import('../src/services/savedSearches.js');

const T0 = Date.now();

function user(name) {
  return Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, `${name}${Math.random()}@test.edu`, 'x', T0).lastInsertRowid);
}

function listing(sellerId, { title, category = 'calculator', condition = 'good', price = 350, description = '' }) {
  return Number(db.prepare(`
    INSERT INTO auctions (seller_id, title, category, description, condition, start_price, min_increment, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?, ?)`).run(sellerId, title, category, description, condition, price, T0 + 3600_000, T0, T0).lastInsertRowid);
}

const matchNotes = (userId, auctionId) => db
  .prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'saved_search_match' AND auction_id = ?").all(userId, auctionId);
const rejects = (fn, status) => assert.throws(fn, (e) => e.status === status);

const senior = user('senior');
const junior = user('junior');
const other = user('other');

test('"scientific calculator, up to ₹400" matches the right listings only', () => {
  const s = { keyword: 'scientific calculator', category: null, condition: null, max_price: 400 };
  const base = { start_price: 350, current_price: null, category: 'calculator', condition: 'good', description: '' };
  assert.equal(matchesSearch(s, { ...base, title: 'Casio Scientific Calculator fx-991' }), true);
  assert.equal(matchesSearch(s, { ...base, title: 'Scientific calculator', start_price: 450 }), false, 'too expensive');
  assert.equal(matchesSearch(s, { ...base, title: 'Basic calculator' }), false, 'missing a word');
  assert.equal(matchesSearch(s, { ...base, title: 'Casio fx-82', description: 'A scientific model' }), true, 'words across title, description and category');
});

test('category and condition filters are respected', () => {
  const s = { keyword: '', category: 'cycle', condition: 'good', max_price: null };
  const base = { title: 'Hero cycle', description: '', start_price: 1500, current_price: null };
  assert.equal(matchesSearch(s, { ...base, category: 'cycle', condition: 'good' }), true);
  assert.equal(matchesSearch(s, { ...base, category: 'cycle', condition: 'poor' }), false);
  assert.equal(matchesSearch(s, { ...base, category: 'books', condition: 'good' }), false);
});

test('a matching new listing stores an alert for the student, even if offline', () => {
  createSavedSearch(junior, { keyword: 'scientific calculator', maxPrice: 400 });
  const match = listing(senior, { title: 'Casio scientific calculator', price: 350 });
  const miss = listing(senior, { title: 'Casio scientific calculator', price: 900 });
  notifySavedSearchMatches(match);
  notifySavedSearchMatches(miss);
  assert.equal(matchNotes(junior, match).length, 1);
  assert.match(matchNotes(junior, match)[0].message, /scientific calculator up to ₹400/);
  assert.equal(matchNotes(junior, miss).length, 0);
});

test('a student with several matching searches gets only one alert per listing', () => {
  createSavedSearch(other, { keyword: 'drafter' });
  createSavedSearch(other, { keyword: 'mini drafter', maxPrice: 500 });
  const id = listing(senior, { title: 'Mini drafter', category: 'other', price: 200 });
  assert.equal(notifySavedSearchMatches(id), 1);
  assert.equal(matchNotes(other, id).length, 1);
});

test('sellers are not alerted about their own listings', () => {
  createSavedSearch(senior, { keyword: 'lab coat' });
  const id = listing(senior, { title: 'Lab coat size M', category: 'other', price: 150 });
  notifySavedSearchMatches(id);
  assert.equal(matchNotes(senior, id).length, 0);
});

test('saving a search also returns what is already listed', () => {
  listing(senior, { title: 'Engineering graphics book', category: 'books', price: 120 });
  const { search, currentMatches } = createSavedSearch(other, { keyword: 'graphics', category: 'books', maxPrice: 200 });
  assert.equal(search.label, 'graphics in books up to ₹200');
  assert.ok(currentMatches.some((a) => a.title === 'Engineering graphics book'));
});

test('validation, listing and deleting', () => {
  rejects(() => createSavedSearch(junior, {}), 400);
  rejects(() => createSavedSearch(junior, { keyword: 'x', category: 'spaceship' }), 400);
  rejects(() => createSavedSearch(junior, { keyword: 'x', maxPrice: -1 }), 400);
  const { search } = createSavedSearch(junior, { category: 'cycle' });
  assert.ok(listSavedSearches(junior).some((s) => s.id === search.id));
  rejects(() => deleteSavedSearch(other, search.id), 404);
  deleteSavedSearch(junior, search.id);
  assert.ok(!listSavedSearches(junior).some((s) => s.id === search.id));
});
