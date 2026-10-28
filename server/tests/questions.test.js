import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { default: db } = await import('../src/db.js');
const Q = await import('../src/services/questions.js');

const T0 = 1_800_000_000_000;
let clock = T0;
const later = () => (clock += Q.QUESTION_COOLDOWN_MS + 1);

function user(name) {
  return Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, `${name}${Math.random()}@test.edu`, 'x', T0).lastInsertRowid);
}
function cycle() {
  return Number(db.prepare(`
    INSERT INTO auctions (seller_id, title, category, condition, start_price, min_increment, ends_at, created_at, updated_at)
    VALUES (?, 'Hero cycle', 'cycle', 'good', 1000, 50, ?, ?, ?)`).run(seller, T0 + 1e9, T0, T0).lastInsertRowid);
}
const rejects = (fn, status, check = () => true) => assert.throws(fn, (e) => e.status === status && check(e));
const notes = (uid, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ?').all(uid, type);

const seller = user('seller');
const asha = user('asha');
const bala = user('bala');
const chitra = user('chitra');

test('similar wording is recognised', () => {
  assert.ok(Q.similarity('Do the brakes work?', 'Are the brakes working properly?') >= 0.6);
  assert.ok(Q.similarity('Do the brakes work?', 'Is the tyre new?') < 0.3);
});

test('buyer asks, seller is notified, answer notifies the asker', () => {
  const id = cycle();
  const qid = Q.askQuestion(id, asha, 'Do the brakes work well?', { now: later() });
  assert.ok(notes(seller, 'question').some((n) => n.auction_id === id));
  Q.answerQuestion(qid, seller, 'Yes, both brakes were serviced last month.', { now: later() });
  assert.ok(notes(asha, 'question_answered').some((n) => n.message.includes('serviced')));
  assert.equal(Q.listQuestions(id)[0].answer, 'Yes, both brakes were serviced last month.');
});

test('the same question asked again is refused and points to the existing one', () => {
  const id = cycle();
  const qid = Q.askQuestion(id, asha, 'Do the brakes work?', { now: later() });
  rejects(() => Q.askQuestion(id, bala, 'Are the brakes working?', { now: later() }), 409, (e) => e.extra.duplicateOf.id === qid);
  assert.equal(Q.findSimilar(id, 'brakes working?')[0].id, qid);
});

test('"I have the same question" counts once per student and they hear the answer', () => {
  const id = cycle();
  const qid = Q.askQuestion(id, asha, 'Is there any rust on the frame?', { now: later() });
  Q.sameQuestion(qid, bala);
  Q.sameQuestion(qid, bala);
  Q.sameQuestion(qid, chitra);
  assert.equal(Q.listQuestions(id)[0].sameCount, 2);
  rejects(() => Q.sameQuestion(qid, asha), 409);
  rejects(() => Q.sameQuestion(qid, seller), 409);
  Q.answerQuestion(qid, seller, 'A small spot on the stand only.', { now: later() });
  assert.ok(notes(bala, 'question_answered').some((n) => n.message.includes('small spot')));
});

test('spam protection: length, links, per-item limit and cooldown', () => {
  const id = cycle();
  rejects(() => Q.askQuestion(id, asha, 'ok?', { now: later() }), 400);
  rejects(() => Q.askQuestion(id, asha, 'Buy cheaper at www.spam.example now', { now: later() }), 400);
  rejects(() => Q.askQuestion(id, asha, 'x'.repeat(301), { now: later() }), 400);
  const t = later();
  Q.askQuestion(id, asha, 'What size is the frame?', { now: t });
  rejects(() => Q.askQuestion(id, asha, 'Does it come with a lock?', { now: t + 1000 }), 429, (e) => /wait/.test(e.message));
  Q.askQuestion(id, asha, 'Does it come with a lock?', { now: later() });
  Q.askQuestion(id, asha, 'Can I test ride it first?', { now: later() });
  rejects(() => Q.askQuestion(id, asha, 'Is the seat height adjustable?', { now: later() }), 429, (e) => /up to 3/.test(e.message));
});

test('seller can hide spam; hidden questions are only visible to the seller', () => {
  const id = cycle();
  const qid = Q.askQuestion(id, bala, 'Selling my phone too, message me', { now: later() });
  rejects(() => Q.setHidden(qid, asha, true), 403);
  Q.setHidden(qid, seller, true);
  assert.equal(Q.listQuestions(id, asha).length, 0);
  assert.equal(Q.listQuestions(id, seller).length, 1);
  assert.equal(Q.findSimilar(id, 'selling phone message').length, 0);
});

test('only the seller answers; sellers cannot ask; no questions after closing', () => {
  const id = cycle();
  const qid = Q.askQuestion(id, chitra, 'Is the chain rusty at all?', { now: later() });
  rejects(() => Q.answerQuestion(qid, asha, 'No idea'), 403);
  rejects(() => Q.askQuestion(id, seller, 'Asking my own question?', { now: later() }), 403);
  db.prepare("UPDATE auctions SET status = 'unsold' WHERE id = ?").run(id);
  rejects(() => Q.askQuestion(id, bala, 'Is it still available?', { now: later() }), 409);
});

test('answered questions are listed first and exposed as an FAQ without names', () => {
  const id = cycle();
  Q.askQuestion(id, asha, 'What colour is the cycle?', { now: later() });
  const q2 = Q.askQuestion(id, bala, 'Does the bell work?', { now: later() });
  Q.answerQuestion(q2, seller, 'Yes', { now: later() });
  assert.equal(Q.listQuestions(id)[0].id, q2);
  assert.deepEqual(Q.answeredFaq(id), [{ question: 'Does the bell work?', answer: 'Yes' }]);
});
