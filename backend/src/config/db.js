import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let memoryServer = null;
let dbInfo = { mode: 'disconnected', uri: '' };

mongoose.set('strictQuery', true);

async function startMemoryServer(reason) {
  logger.warn(`[db] ${reason} Starting an in-memory MongoDB (first run downloads the MongoDB binary, ~100 MB)...`);
  const { MongoMemoryServer } = await import('mongodb-memory-server-core');
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri('lotflow');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  dbInfo = { mode: 'memory', uri: 'in-memory' };
  logger.info('[db] Connected to in-memory MongoDB. Data resets when the server stops.');
}

export async function connectDB() {
  mongoose.connection.on('disconnected', () => {
    if (dbInfo.mode !== 'disconnected') logger.warn('[db] MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => logger.info('[db] MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error(`[db] MongoDB error: ${err.message}`));

  if (env.useMemoryDb) {
    await startMemoryServer('USE_MEMORY_DB is on.');
    return dbInfo;
  }

  if (!env.mongoUri) {
    if (env.memoryFallback) {
      await startMemoryServer('MONGODB_URI is not set.');
      return dbInfo;
    }
    throw new Error('MONGODB_URI is not set. Add it to backend/.env (see .env.example).');
  }

  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
    const host = mongoose.connection.host;
    dbInfo = { mode: 'mongodb', uri: host };
    logger.info(`[db] Connected to MongoDB at ${host}/${mongoose.connection.name}`);
  } catch (err) {
    logger.error(`[db] Could not connect to MongoDB: ${err.message}`);
    logger.error('[db] Check that MongoDB is running (mongod) or that your Atlas URI, user and IP allow-list are correct.');
    if (env.memoryFallback) {
      await startMemoryServer('Falling back to an in-memory database so the demo still runs.');
    } else {
      throw err;
    }
  }
  return dbInfo;
}

export function getDbInfo() {
  return { ...dbInfo, state: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' };
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}
