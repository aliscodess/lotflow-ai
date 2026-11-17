import { Activity } from '../models/index.js';
import { emit } from './socketService.js';

/** Records a vehicle timeline entry and pushes it to connected dashboards. */
export async function logActivity({ vehicleId, type = 'INFO', message, actor, source = 'SYSTEM', meta }) {
  const doc = await Activity.create({
    vehicleId,
    type,
    message,
    actor: actor || { name: 'LotFlow AI', role: 'SYSTEM' },
    source,
    meta,
  });
  emit('activity:new', doc.toJSON());
  return doc;
}

export async function logMany(entries) {
  const out = [];
  for (const e of entries) out.push(await logActivity(e));
  return out;
}

export const AI_ACTOR = { name: 'LotFlow AI', role: 'SYSTEM' };
