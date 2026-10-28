import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { auctionDetail } from '../services/auctions.js';
import { placeBid, setAutoBid, cancelAutoBid } from '../services/bidEngine.js';
import { emitAuctionUpdate } from '../services/realtime.js';

const router = Router();

function respond(req, res, result, status = 200) {
  emitAuctionUpdate(result.auctionId, { reason: 'bid', endsAt: result.endsAt, extended: result.extended });
  res.status(status).json({ ...auctionDetail(result.auctionId, { viewerId: req.user.id }), extended: result.extended });
}

router.post('/:id/bids', requireAuth, (req, res) => {
  respond(req, res, placeBid(Number(req.params.id), req.user.id, Number(req.body?.amount)), 201);
});

router.put('/:id/auto-bid', requireAuth, (req, res) => {
  respond(req, res, setAutoBid(Number(req.params.id), req.user.id, Number(req.body?.maxAmount)));
});

router.delete('/:id/auto-bid', requireAuth, (req, res) => {
  const auctionId = cancelAutoBid(Number(req.params.id), req.user.id);
  emitAuctionUpdate(auctionId, { reason: 'auto_bid_removed' });
  res.json({ ...auctionDetail(auctionId, { viewerId: req.user.id }), extended: false });
});

export default router;
