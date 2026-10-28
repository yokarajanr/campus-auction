import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { createSavedSearch, deleteSavedSearch, listSavedSearches, setEmailAlerts } from '../services/savedSearches.js';
import { emailHtml, recentEmails } from '../services/mailer.js';
import { HttpError } from '../errors.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ searches: listSavedSearches(req.user.id) });
});

router.get('/emails', requireAuth, (req, res) => {
  res.json({ emails: recentEmails(req.user.id) });
});

router.get('/emails/:id', requireAuth, (req, res) => {
  const html = emailHtml(req.user.id, Number(req.params.id));
  if (!html) throw new HttpError(404, 'Email not found');
  res.json({ html });
});

router.post('/', requireAuth, (req, res) => {
  res.status(201).json(createSavedSearch(req.user.id, req.body ?? {}));
});

router.patch('/:id', requireAuth, (req, res) => {
  setEmailAlerts(req.user.id, Number(req.params.id), req.body?.emailAlerts !== false);
  res.json({ searches: listSavedSearches(req.user.id) });
});

router.delete('/:id', requireAuth, (req, res) => {
  deleteSavedSearch(req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

export default router;
