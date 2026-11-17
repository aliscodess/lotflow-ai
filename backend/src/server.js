import http from 'node:http';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp, corsOrigin } from './app.js';
import { initSocket } from './services/socketService.js';
import { primeStoreName } from './services/customerService.js';
import { aiStatus } from './services/ai/aiService.js';
import { Vehicle } from './models/index.js';
import { seedDatabase } from './seed/seed.js';
import { logger } from './utils/logger.js';

async function start() {
  if (env.jwt.generated) logger.warn('[config] JWT_SECRET not set. Using a random secret for this run; sessions reset on restart.');

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server, corsOrigin);

  try {
    const db = await connectDB();
    const count = await Vehicle.estimatedDocumentCount();
    if (count === 0 && env.autoSeed) {
      logger.info('[seed] Database is empty. Loading the demo dataset...');
      await seedDatabase({ log: (m) => logger.info(`[seed] ${m}`) });
    }
    await primeStoreName();
    logger.info(`[db] mode: ${db.mode}`);
  } catch (err) {
    logger.error(`[db] ${err.message}`);
    logger.error('[db] The API will start but return 503 until the database is reachable.');
  }

  const ai = aiStatus();
  server.listen(env.port, () => {
    logger.info(`LotFlow API listening on http://localhost:${env.port}`);
    logger.info(`AI engine: ${ai.label} (${ai.mode}${ai.mode === 'live' ? `, model ${ai.model}` : ''}) · demo mode: ${env.demoMode ? 'on' : 'off'}`);
    logger.info(`Allowed client origins: ${env.clientUrls.join(', ')}${env.isProd ? '' : ' (+ localhost / LAN in development)'}`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down...`);
    server.close();
    await disconnectDB().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error('[process] Unhandled rejection:', err));
}

start();
