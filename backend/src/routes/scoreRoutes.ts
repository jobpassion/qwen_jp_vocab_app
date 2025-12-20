import fs from 'fs';
import { randomUUID } from 'crypto';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import { config } from '../config/env';
import { requireAuth } from '../middleware/authMiddleware';
import { createScore, getScore, listScores, removeScore, updateScore } from '../services/scoreService';
import {
  createShareLinkForScore,
  getSharedScoreByToken,
  revokeShareLinkForScore,
} from '../services/scoreShareService';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.scoreUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = randomUUID();
    cb(null, `${name}${ext || ''}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.scoreMaxUploadBytes },
});

const asyncHandler = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

const cleanupUploadedFiles = (files?: Express.Multer.File[] | Express.Multer.File | null) => {
  if (!files) return;
  const list = Array.isArray(files) ? files : [files];
  list.forEach((file) => {
    fs.unlink(file.path, () => {});
  });
};

const parsePagesMeta = (input: unknown) => {
  if (!input) return [];
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseBooleanFlag = (input: unknown, fallback = false) => {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    return ['true', '1', 'yes', 'on'].includes(input.toLowerCase());
  }
  return fallback;
};

const parseCoverIndex = (input: unknown) => {
  const num = Number(input);
  if (Number.isInteger(num) && num >= 0) {
    return num;
  }
  return 0;
};

const parseExpiresInHours = (input: unknown) => {
  const num = Number(input);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }
  return num;
};

router.get(
  '/share/:token',
  (req, res) => {
    const token = (req.params.token ?? '').trim();
    if (!token) {
      res.status(400).json({ error: '无效的分享 token' });
      return;
    }
    const shared = getSharedScoreByToken(token);
    if (!shared) {
      res.status(404).json({ error: '分享链接已失效或不存在' });
      return;
    }
    res.json({
      share: {
        token: shared.token,
        sharePath: shared.sharePath,
        shareUrl: shared.shareUrl,
        shareApiPath: shared.shareApiPath,
        shareApiUrl: shared.shareApiUrl,
        expiresAt: shared.expiresAt,
        createdAt: shared.createdAt,
        sharedByUserId: shared.sharedByUserId,
      },
      score: shared.score,
    });
  }
);

router.use(requireAuth);

router.get(
  '/',
  (req, res) => {
    const scores = listScores(req.user!.id);
    res.json({ scores });
  }
);

router.post(
  '/',
  upload.array('images'),
  asyncHandler((req, res) => {
    const { title, composer, description, config: configInput, pages: pagesInput, appendPages } = req.body ?? {};
    const files = Array.isArray(req.files) ? req.files : [];
    console.log('[scores] POST / - user:', req.user?.id, 'title:', title, 'files:', files.map((f) => f.originalname));
    if (typeof title !== 'string' || title.trim().length === 0) {
      cleanupUploadedFiles(files);
      res.status(400).json({ error: 'title 必填' });
      return;
    }
    if (!files.length) {
      res.status(400).json({ error: '缺少乐谱图片文件(images)' });
      return;
    }
    try {
      const score = createScore(
        req.user!.id,
        {
          title: title.trim(),
          composer: typeof composer === 'string' ? composer.trim() : '',
          description: typeof description === 'string' ? description : '',
          config: configInput,
          imageFilename: files[0]?.filename,
        },
        {
          uploadedFiles: files,
          pagesMeta: parsePagesMeta(pagesInput),
          appendPages: parseBooleanFlag(appendPages, false),
          coverIndex: parseCoverIndex(req.body?.coverIndex),
        }
      );
      res.status(201).json({ score });
    } catch (error) {
      cleanupUploadedFiles(files);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  })
);

router.post(
  '/:id/share',
  (req, res) => {
    const scoreId = Number(req.params.id);
    if (Number.isNaN(scoreId)) {
      res.status(400).json({ error: '无效的乐谱 id' });
      return;
    }
    const expiresInHours = parseExpiresInHours(req.body?.expiresInHours);
    try {
      const share = createShareLinkForScore(
        req.user!.id,
        scoreId,
        expiresInHours !== undefined ? { expiresInHours } : undefined
      );
      res.status(201).json({
        share: {
          token: share.token,
          sharePath: share.sharePath,
          shareUrl: share.shareUrl,
          shareApiPath: share.shareApiPath,
          shareApiUrl: share.shareApiUrl,
          expiresAt: share.expiresAt,
          createdAt: share.createdAt,
        },
        score: share.score,
      });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  }
);

router.get(
  '/:id',
  (req, res) => {
    const scoreId = Number(req.params.id);
    if (Number.isNaN(scoreId)) {
      res.status(400).json({ error: '无效的乐谱 id' });
      return;
    }
    const score = getScore(req.user!.id, scoreId);
    if (!score) {
      res.status(404).json({ error: '乐谱不存在' });
      return;
    }
    res.json({ score });
  }
);

router.put(
  '/:id',
  upload.array('images'),
  asyncHandler((req, res) => {
    const scoreId = Number(req.params.id);
    const files = Array.isArray(req.files) ? req.files : [];
    console.log('[scores] PUT /:id - user:', req.user?.id, 'scoreId:', scoreId, 'files:', files.map((f) => f.originalname));
    if (Number.isNaN(scoreId)) {
      cleanupUploadedFiles(files);
      res.status(400).json({ error: '无效的乐谱 id' });
      return;
    }

    const { title, composer, description, config: configInput, pages: pagesInput, appendPages } = req.body ?? {};
    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      cleanupUploadedFiles(files);
      res.status(400).json({ error: 'title 需要为非空字符串' });
      return;
    }

    if (composer !== undefined && typeof composer !== 'string') {
      cleanupUploadedFiles(files);
      res.status(400).json({ error: 'composer 需要为字符串' });
      return;
    }

    if (description !== undefined && typeof description !== 'string') {
      cleanupUploadedFiles(files);
      res.status(400).json({ error: 'description 需要为字符串' });
      return;
    }

    try {
      const score = updateScore(
        req.user!.id,
        scoreId,
        {
          title: typeof title === 'string' ? title.trim() : undefined,
          composer: typeof composer === 'string' ? composer.trim() : undefined,
          description: typeof description === 'string' ? description : undefined,
          config: configInput,
          imageFilename: files[0]?.filename,
        },
        {
          uploadedFiles: files,
          pagesMeta: parsePagesMeta(pagesInput),
          appendPages: parseBooleanFlag(appendPages, false),
          coverIndex: parseCoverIndex(req.body?.coverIndex),
        }
      );
      if (!score) {
        cleanupUploadedFiles(files);
        res.status(404).json({ error: '乐谱不存在' });
        return;
      }
      res.json({ score });
    } catch (error) {
      cleanupUploadedFiles(files);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  })
);

router.delete(
  '/:id/share',
  (req, res) => {
    const scoreId = Number(req.params.id);
    if (Number.isNaN(scoreId)) {
      res.status(400).json({ error: '无效的乐谱 id' });
      return;
    }
    const removed = revokeShareLinkForScore(req.user!.id, scoreId);
    if (!removed) {
      res.status(404).json({ error: '分享链接不存在' });
      return;
    }
    res.status(204).send();
  }
);

router.delete(
  '/:id',
  (req, res) => {
    const scoreId = Number(req.params.id);
    if (Number.isNaN(scoreId)) {
      res.status(400).json({ error: '无效的乐谱 id' });
      return;
    }
    const removed = removeScore(req.user!.id, scoreId);
    if (!removed) {
      res.status(404).json({ error: '乐谱不存在' });
      return;
    }
    res.status(204).send();
  }
);

export default router;
