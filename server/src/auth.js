import jwt from 'jsonwebtoken';
import db from './db.js';
import { HttpError } from './errors.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is missing. Copy server/.env.example to server/.env and set it.');
}

export function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

export function userFromToken(token) {
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    return db.prepare('SELECT id, name FROM users WHERE id = ?').get(id) || null;
  } catch {
    return null;
  }
}

function userFromRequest(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return token ? userFromToken(token) : null;
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) throw new HttpError(401, 'Please log in first');
  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  req.user = userFromRequest(req);
  next();
}
