import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { addEntryForUser, getEntriesForUser, removeEntryForUser, updateEntryForUser } from '../services/vocabService';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const entries = getEntriesForUser(req.user!.id);
  res.json({ items: entries });
});

router.post('/', (req, res) => {
  const { term, definition, notes } = req.body ?? {};
  if (typeof term !== 'string' || term.trim().length === 0) {
    res.status(400).json({ error: 'term is required' });
    return;
  }
  if (typeof definition !== 'string') {
    res.status(400).json({ error: 'definition is required' });
    return;
  }
  const entry = addEntryForUser(req.user!.id, {
    term: term.trim(),
    definition: definition.trim(),
    notes: typeof notes === 'string' ? notes : '',
  });
  res.status(201).json({ entry });
});

router.put('/:id', (req, res) => {
  const entryId = Number(req.params.id);
  if (Number.isNaN(entryId)) {
    res.status(400).json({ error: 'Invalid entry id' });
    return;
  }
  const { term, definition, notes } = req.body ?? {};
  if (typeof term !== 'string' || term.trim().length === 0) {
    res.status(400).json({ error: 'term is required' });
    return;
  }
  if (typeof definition !== 'string') {
    res.status(400).json({ error: 'definition is required' });
    return;
  }
  const updated = updateEntryForUser(req.user!.id, entryId, {
    term: term.trim(),
    definition: definition.trim(),
    notes: typeof notes === 'string' ? notes : '',
  });
  if (!updated) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  res.json({ entry: updated });
});

router.delete('/:id', (req, res) => {
  const entryId = Number(req.params.id);
  if (Number.isNaN(entryId)) {
    res.status(400).json({ error: 'Invalid entry id' });
    return;
  }
  removeEntryForUser(req.user!.id, entryId);
  res.status(204).send();
});

export default router;
