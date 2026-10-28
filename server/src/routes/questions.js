import { Router } from 'express';
import { optionalAuth, requireAuth } from '../auth.js';
import { emitAuctionUpdate } from '../services/realtime.js';
import { answerQuestion, askQuestion, findSimilar, listQuestions, sameQuestion, setHidden } from '../services/questions.js';

const router = Router();

function respond(req, res, auctionId, status = 200) {
  emitAuctionUpdate(auctionId, { reason: 'question' });
  res.status(status).json({ questions: listQuestions(auctionId, req.user.id) });
}

router.get('/auctions/:id/questions', optionalAuth, (req, res) => {
  res.json({ questions: listQuestions(Number(req.params.id), req.user?.id ?? null) });
});

router.get('/auctions/:id/questions/similar', optionalAuth, (req, res) => {
  res.json({ similar: findSimilar(Number(req.params.id), String(req.query.text ?? ''), req.user?.id ?? null) });
});

router.post('/auctions/:id/questions', requireAuth, (req, res) => {
  const auctionId = Number(req.params.id);
  askQuestion(auctionId, req.user.id, req.body?.text);
  respond(req, res, auctionId, 201);
});

router.post('/questions/:id/answer', requireAuth, (req, res) => {
  respond(req, res, answerQuestion(Number(req.params.id), req.user.id, req.body?.answer));
});

router.post('/questions/:id/hide', requireAuth, (req, res) => {
  respond(req, res, setHidden(Number(req.params.id), req.user.id, req.body?.hidden !== false));
});

router.post('/questions/:id/same', requireAuth, (req, res) => {
  respond(req, res, sameQuestion(Number(req.params.id), req.user.id));
});

export default router;
