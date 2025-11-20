import { RequestHandler } from 'express';
import { authenticateToken } from '../services/authService';

const extractToken = (header: string | undefined) => {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return undefined;
  return token;
};

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = extractToken(req.header('Authorization'));
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const payload = authenticateToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = payload.user;
  req.session = payload.session;
  return next();
};
