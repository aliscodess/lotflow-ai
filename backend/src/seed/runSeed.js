import { connectDB, disconnectDB } from '../config/db.js';
import { seedDatabase } from './seed.js';
import { logger } from '../utils/logger.js';

(async () => {
  try {
    const info = await connectDB();
    if (info.mode === 'memory') {
      logger.warn('Seeding an in-memory database has no lasting effect. The server seeds itself on start when the DB is empty.');
    }
    const result = await seedDatabase({ log: (m) => logger.info(`[seed] ${m}`) });
    logger.info(`[seed] Done: ${JSON.stringify(result)}`);
    logger.info('[seed] Demo logins (password Demo@123): manager@lotflow.demo, associate@lotflow.demo, advisor@lotflow.demo');
    await disconnectDB();
    process.exit(0);
  } catch (err) {
    logger.error(`[seed] Failed: ${err.message}`);
    process.exit(1);
  }
})();
