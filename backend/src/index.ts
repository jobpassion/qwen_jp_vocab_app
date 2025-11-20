/// <reference path="./types/express.d.ts" />

import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import path from 'path';
import { config } from './config/env';
import { initializeDatabase } from './db/schema';

const app = express();

// 初始化数据库后再加载依赖它的路由，避免表未建时报错。
initializeDatabase();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const authRouter = require('./routes/authRoutes').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vocabRouter = require('./routes/vocabRoutes').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const syncRouter = require('./routes/syncRoutes').default;

app.use(cors());
app.use(express.json({ limit: config.jsonBodyLimit }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/vocab', vocabRouter);
app.use('/sync', syncRouter);
app.use(express.static(config.publicDir));

app.use((req, res, next) => {
  const acceptsHtml = typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html');
  const isHtmlNavigation = req.method === 'GET' && acceptsHtml;
  const isApiRoute = req.path.startsWith('/auth')
    || req.path.startsWith('/vocab')
    || req.path.startsWith('/sync')
    || req.path.startsWith('/health');
  const bypass = isApiRoute || req.path === '/sw.js' || req.path === '/manifest.webmanifest';

  // API 请求或静态文件直通；仅对导航请求返回 index.html。
  if (!isHtmlNavigation || bypass) {
    next();
    return;
  }

  res.sendFile(path.join(config.publicDir, 'index.html'), (err) => {
    if (err) {
      next(err);
    }
  });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  const status = typeof err.status === 'number' ? err.status : 500;
  const message = status >= 500 ? 'Internal server error' : err.message;
  res.status(status).json({ error: message ?? 'Internal server error' });
};

app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`API server running on port ${config.port}`);
  });
}

export default app;
