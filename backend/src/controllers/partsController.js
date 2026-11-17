import { z } from 'zod';
import { Part, PartTransfer, ServiceTask } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf } from '../middleware/auth.js';
import { availability, buildResolution, resolveShortage, receiveTransfer, getStores } from '../services/partsService.js';

/* ---------------- Parts ---------------- */

export const resolveSchema = z.object({
  taskId: z.string().trim().min(3),
  partNumber: z.string().trim().min(3),
  strategy: z.enum(['TRANSFER', 'RESCHEDULE', 'BACKORDER']).optional(),
});

export async function listParts(req, res) {
  const { q, shortage } = req.query;
  let items = await Part.find().sort({ category: 1, name: 1 }).lean();
  if (q) {
    const n = String(q).toLowerCase();
    items = items.filter((p) => [p.partNumber, p.name, p.category, p.brand, ...(p.compatibleModels || [])].some((f) => String(f || '').toLowerCase().includes(n)));
  }
  const stores = await getStores();
  items = items.map((p) => {
    const local = p.inventoryByStore.find((i) => i.storeCode === 'S1') || { quantity: 0, reserved: 0 };
    return { ...p, localAvailable: Math.max(0, local.quantity - (local.reserved || 0)), lowStock: local.quantity - (local.reserved || 0) <= (local.reorderLevel || 0) };
  });
  if (shortage === 'true') items = items.filter((p) => p.localAvailable === 0);
  res.json({ items, stores: stores.map((s) => ({ code: s.code, name: s.name, label: s.label, distanceKm: s.distanceKm })) });
}

export async function partAvailability(req, res) {
  const qty = Number(req.query.qty || 1);
  if (req.query.taskId) {
    const task = await ServiceTask.findOne({ taskId: req.query.taskId }).lean();
    if (!task) throw ApiError.notFound('Repair order not found.');
    return res.json(await buildResolution(task, req.params.partNumber, qty));
  }
  return res.json(await availability(req.params.partNumber, qty));
}

export async function resolveParts(req, res) {
  const r = await resolveShortage(req.body, actorOf(req));
  res.json(r);
}

export async function listTransfers(_req, res) {
  res.json({ items: await PartTransfer.find().sort({ createdAt: -1 }).limit(30).lean() });
}

export async function receive(req, res) {
  res.json(await receiveTransfer(req.params.id, actorOf(req)));
}
