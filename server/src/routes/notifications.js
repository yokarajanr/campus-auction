import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT id, type, message, auction_id AS auctionId, read, created_at AS createdAt
    FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(req.user.id)
    .map((n) => ({ ...n, read: Boolean(n.read) }));
  const { unread } = db.prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id);
  res.json({ notifications, unread });
});

router.post('/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  res.json({ ok: true });
});

export default router;
