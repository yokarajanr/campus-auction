import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { requireAuth, signToken } from '../auth.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Name must be 2-40 characters');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with this email already exists');
  }

  const hash = await bcrypt.hash(password, 10);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, email, hash, Date.now());

  const user = { id: Number(lastInsertRowid), name, email };
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const row = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, 'Wrong email or password');
  }

  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

export default router;
