import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { register, login, logout } from '../services/authService';

const router = Router();

const asyncHandler = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const user = await register(normalizedEmail, password);
      res.status(201).json({ user });
      return;
    } catch (error) {
      if (error instanceof Error && error.message === 'Email already registered') {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    try {
      const result = await login(email.trim().toLowerCase(), password);
      res.json(result);
      return;
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid credentials') {
        res.status(401).json({ error: error.message });
        return;
      }
      throw error;
    }
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.session) {
      res.status(204).send();
      return;
    }
    logout(req.session.token);
    res.status(204).send();
  })
);

router.get('/me', requireAuth, (_req, res) => res.json({ user: _req.user }));

export default router;
