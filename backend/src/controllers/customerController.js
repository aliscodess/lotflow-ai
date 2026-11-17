import { z } from 'zod';
import { Customer, ServiceTask } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { findCustomer, updateStatus, sendUpdate, publicView } from '../services/customerService.js';
import { SERVICE_STEPS } from '../utils/constants.js';

/* ---------------- Customers ---------------- */

export const statusPatchSchema = z.object({
  stage: z.enum(SERVICE_STEPS.map((s) => s.key)).optional(),
  estimatedCompletion: z.coerce.date().optional(),
  note: z.string().max(300).optional(),
  notify: z.boolean().default(true),
});

export async function listCustomers(_req, res) {
  const items = await Customer.find().sort({ updatedAt: -1 }).lean();
  res.json({ items: items.map((c) => ({ ...c, view: publicView(c) })) });
}

export async function customerStatus(req, res) {
  const c = await findCustomer(req.params.id);
  const task = c.serviceTaskId ? await ServiceTask.findOne({ taskId: c.serviceTaskId }).lean() : null;
  res.json({ customer: c, status: publicView(c), task });
}

export async function patchCustomerStatus(req, res) {
  const c = await updateStatus(req.params.id, req.body, req.user.name);
  res.json({ customer: c, status: publicView(c) });
}

export async function notifyCustomer(req, res) {
  const { customer, message } = await sendUpdate(req.params.id, { channel: req.body?.channel || 'WHATSAPP', message: req.body?.message });
  res.json({ customer, message });
}

export async function publicTrack(req, res) {
  const code = String(req.params.code || '').toUpperCase();
  if (!/^[A-Z0-9-]{4,16}$/.test(code)) throw ApiError.badRequest('Invalid tracking code.');
  const c = await Customer.findOne({ trackingCode: code }).lean();
  if (!c) throw ApiError.notFound('We could not find that tracking code. Check the link in your SMS.');
  res.json(publicView(c));
}
