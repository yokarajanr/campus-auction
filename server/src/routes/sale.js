import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { auctionDetail } from '../services/auctions.js';
import { approveSale, rejectSale, confirmHandover, reportFailedPickup } from '../services/sale.js';
import { emitAuctionUpdate } from '../services/realtime.js';

const router = Router();

function respond(req, res, auctionId, reason) {
  emitAuctionUpdate(auctionId, { reason });
  res.json(auctionDetail(auctionId, { viewerId: req.user.id }));
}

router.post('/:id/approve', requireAuth, (req, res) => {
  respond(req, res, approveSale(Number(req.params.id), req.user.id), 'approved');
});

router.post('/:id/reject', requireAuth, (req, res) => {
  respond(req, res, rejectSale(Number(req.params.id), req.user.id, req.body?.reason), 'rejected');
});

router.post('/:id/handover', requireAuth, (req, res) => {
  respond(req, res, confirmHandover(Number(req.params.id), req.user.id, req.body?.code), 'completed');
});

router.post('/:id/failed-pickup', requireAuth, (req, res) => {
  respond(req, res, reportFailedPickup(Number(req.params.id), req.user.id, req.body?.reason), 'failed_pickup');
});

export default router;
