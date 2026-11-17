import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { UPLOAD_DIR } from './services/storageService.js';

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** CORS origin check shared by Express and Socket.IO. */
export function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true); // curl, mobile apps, same-origin
  const clean = origin.replace(/\/$/, '');
  if (env.clientUrls.includes('*') || env.clientUrls.includes(clean)) return callback(null, true);
  if (!env.isProd && LOCALHOST.test(clean)) return callback(null, true);
  if (!env.isProd && /^https?:\/\/(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(clean)) return callback(null, true); // phones on the same Wi-Fi
  return callback(new Error(`Origin ${origin} is not allowed by CORS. Add it to CLIENT_URL.`));
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  if (!env.isProd) app.use(morgan('dev', { skip: (req) => req.url === '/api/health' }));

  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }));
  app.get('/', (_req, res) => res.json({ name: 'LotFlow AI API', docs: '/api/health' }));
  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
