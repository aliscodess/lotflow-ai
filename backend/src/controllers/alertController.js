import { z } from 'zod';
import mongoose from 'mongoose';
import { Alert } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf } from '../middleware/auth.js';
import { listActions, applyAction } from '../services/actionService.js';
import { emit } from '../services/socketService.js';

/* ---------------- Alerts & actions ---------------- */

export const alertPatchSchema = z.object({ status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']), note: z.string().max(300).optional() });

export async function listAlerts(req, res) {
  const { status = 'OPEN', type, limit = 50 } = req.query;
  const filter = {};
  if (status !== 'ALL') filter.status = status;
  if (type) filter.type = type;
  if (req.user.role !== 'MANAGER') filter.audience = req.user.role;
  const items = await Alert.find(filter).sort({ createdAt: -1 }).limit(Math.min(200, Number(limit) || 50)).lean();
  res.json({ items });
}

export async function patchAlert(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.badRequest('Invalid alert id.');
  const alert = await Alert.findById(req.params.id);
  if (!alert) throw ApiError.notFound('Alert not found.');
  alert.status = req.body.status;
  alert.resolution = req.body.status === 'OPEN' ? undefined : { by: req.user.name, at: new Date(), note: req.body.note || (req.body.status === 'DISMISSED' ? 'Dismissed' : 'Marked resolved') };
  await alert.save();
  emit('alert:updated', alert.toJSON());
  res.json({ alert });
}

export const listActionsHandler = async (req, res) => res.json(await listActions(req.user.role));
export const applyActionHandler = async (req, res) => res.json(await applyAction(req.params.id, actorOf(req)));
