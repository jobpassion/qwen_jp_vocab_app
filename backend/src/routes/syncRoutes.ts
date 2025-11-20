import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { loadSnapshotForUser, persistSnapshotForUser } from '../services/snapshotService';

const router = Router();

const asyncHandler = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const record = loadSnapshotForUser(req.user!.id);
    if (!record) {
      res.status(404).json({ error: '后端尚未收到任何同步快照' });
      return;
    }
    res.json(record);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.body) {
      res.status(400).json({ error: '请求体不能为空' });
      return;
    }
    const record = persistSnapshotForUser(req.user!.id, req.body);
    res.status(201).json(record);
  })
);

export default router;
