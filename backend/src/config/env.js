import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const port = Number(process.env.PORT || 5000);

let jwtSecret = process.env.JWT_SECRET;
let jwtSecretGenerated = false;
if (!jwtSecret) {
  if (isProd) {
    // Never run production with a guessable secret.
    console.error('[config] JWT_SECRET is required in production. Set it in your environment.');
    process.exit(1);
  }
  jwtSecret = crypto.randomBytes(48).toString('hex');
  jwtSecretGenerated = true;
}

const aiKey = process.env.AI_API_KEY || '';
let aiProvider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
if (!aiProvider) aiProvider = aiKey ? 'anthropic' : 'demo';
if (!aiKey) aiProvider = 'demo';

export const env = {
  nodeEnv,
  isProd,
  port,
  mongoUri: process.env.MONGODB_URI || '',
  useMemoryDb: bool(process.env.USE_MEMORY_DB, false) || process.argv.includes('--memory'),
  memoryFallback: bool(process.env.MEMORY_DB_FALLBACK, !isProd),
  autoSeed: bool(process.env.AUTO_SEED, true),
  jwt: {
    secret: jwtSecret,
    refreshSecret: process.env.JWT_REFRESH_SECRET || `${jwtSecret}.refresh`,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    generated: jwtSecretGenerated,
  },
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  demoMode: bool(process.env.DEMO_MODE, true),
  ai: {
    provider: aiProvider, // anthropic | openai | groq | demo
    apiKey: aiKey,
    model: process.env.AI_MODEL || '',
    baseUrl: process.env.AI_BASE_URL || '',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 12000),
  },
  cloudinary: {
    url: process.env.CLOUDINARY_URL || '',
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  serverUrl: (process.env.SERVER_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  // Dealership local time offset in minutes (IST = +330). Used for display-friendly scheduling.
  tzOffsetMinutes: Number(process.env.DEALERSHIP_TZ_OFFSET_MIN || 330),
  primaryStore: process.env.PRIMARY_STORE || 'S1',
};

export const cloudinaryEnabled = Boolean(
  env.cloudinary.url || (env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret),
);
