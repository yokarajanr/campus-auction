import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { HttpError } from '../errors.js';
import { chat } from '../services/assistant.js';

const router = Router();

router.post('/chat', requireAuth, async (req, res) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages)) throw new HttpError(400, 'messages must be an array');
  res.json(await chat(messages, req.user.id));
});

router.get('/status', requireAuth, (req, res) => {
  res.json({ mode: process.env.GEMINI_API_KEY ? 'gemini' : 'rules' });
});

export default router;
