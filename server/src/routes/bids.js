import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { auctionDetail } from '../services/auctions.js';
import { placeBid } from '../services/bidEngine.js';
import { emitAuctionUpdate } from '../services/realtime.js';

const router = Router();

router.post('/:id/bids', requireAuth, (req, res) => {
  const result = placeBid(Number(req.params.id), req.user.id, Number(req.body?.amount));
  emitAuctionUpdate(result.auctionId, { reason: 'bid', amount: result.amount, endsAt: result.endsAt, extended: result.extended });
  res.status(201).json({ ...auctionDetail(result.auctionId, { viewerId: req.user.id }), extended: result.extended });
});

export default router;
