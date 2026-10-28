import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { createSavedSearch, deleteSavedSearch, listSavedSearches } from '../services/savedSearches.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ searches: listSavedSearches(req.user.id) });
});

router.post('/', requireAuth, (req, res) => {
  res.status(201).json(createSavedSearch(req.user.id, req.body ?? {}));
});

router.delete('/:id', requireAuth, (req, res) => {
  deleteSavedSearch(req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

export default router;
