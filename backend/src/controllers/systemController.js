import { ApiError } from '../utils/ApiError.js';
import { saveImage } from '../services/storageService.js';
import { aiStatus } from '../services/ai/aiService.js';
import { emit, notify } from '../services/socketService.js';
import { clearStoreCache } from '../services/partsService.js';
import { primeStoreName } from '../services/customerService.js';
import { seedDatabase } from '../seed/seed.js';
import { getDbInfo } from '../config/db.js';
import { env, cloudinaryEnabled } from '../config/env.js';

/* ---------------- Uploads ---------------- */

export async function upload(req, res) {
  if (!req.files?.length) throw ApiError.badRequest('Attach at least one photo.');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const files = [];
  for (const f of req.files) files.push(await saveImage(f, { baseUrl }));
  res.status(201).json({ files });
}

/* ---------------- System ---------------- */

export function systemStatus(_req, res) {
  res.json({
    status: 'ok',
    demoMode: env.demoMode,
    ai: aiStatus(),
    db: getDbInfo(),
    storage: cloudinaryEnabled ? 'cloudinary' : 'local',
    realtime: 'socket.io',
    time: new Date(),
  });
}

export async function resetDemo(req, res) {
  if (!env.demoMode) throw ApiError.forbidden('Demo reset is only available in demo mode.');
  const result = await seedDatabase();
  clearStoreCache();
  await primeStoreName();
  emit('system:reset', { by: req.user.name });
  notify({ title: 'Demo data reset', message: `${req.user.name} restored the demo dataset.`, kind: 'info' });
  res.json({ ok: true, ...result });
}
