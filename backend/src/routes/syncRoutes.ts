import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { config } from '../config/env';
import { requireAuth } from '../middleware/authMiddleware';
import { loadSnapshotForUser, persistSnapshotForUser } from '../services/snapshotService';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.scoreMaxUploadBytes },
});

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
  upload.any(),
  asyncHandler(async (req, res) => {
    if (!req.body || (!req.body.metadata && !Object.keys(req.body).length)) {
      res.status(400).json({ error: '请求体不能为空' });
      return;
    }
    let payload: unknown = req.body;
    if (req.body.metadata) {
      try {
        payload = JSON.parse(req.body.metadata);
      } catch (error) {
        res.status(400).json({ error: 'metadata 需要是合法的 JSON' });
        return;
      }
    }
    const fileMap = new Map<string, Express.Multer.File>();
    if (Array.isArray(req.files)) {
      req.files.forEach((file) => {
        if (file && typeof file.fieldname === 'string') {
          fileMap.set(file.fieldname, file);
        }
      });
    }
    const record = await persistSnapshotForUser(req.user!.id, payload, fileMap);
    res.status(201).json(record);
  })
);

export default router;
