import { z } from 'zod';
import { ServiceTask, Inspection, Technician, Bay, Vehicle, Part, nextSequence } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf } from '../middleware/auth.js';
import { assignTask, getBoard, computeRecommendation, applyRecommendation, reassignTechnician } from '../services/dispatchService.js';
import { addPartToTask, compatibleParts, buildResolution } from '../services/partsService.js';
import { convertToServiceTask, createInspection } from '../services/inspectionService.js';
import { syncFromTask } from '../services/customerService.js';
import { applyHealth, setCondition } from '../services/healthService.js';
import { logActivity } from '../services/activityService.js';
import { emit } from '../services/socketService.js';
import { conditionKeyForArea } from '../services/ai/parsers.js';
import { formatLocalTime } from '../utils/time.js';
import { PRIORITIES, TASK_STATUS } from '../utils/constants.js';

const SKILL_FOR_CATEGORY = { INSPECTION: 'INSPECTION', REPAIR: 'GENERAL', MAINTENANCE: 'GENERAL', RECON: 'INSPECTION', BODY: 'BODY', EV: 'EV', TIRES: 'TIRES', DETAILING: 'DETAILING' };

export const createTaskSchema = z.object({
  vehicleId: z.string().trim().min(2),
  issue: z.string().trim().min(3).max(160),
  description: z.string().max(500).optional(),
  category: z.enum(['INSPECTION', 'REPAIR', 'MAINTENANCE', 'RECON', 'BODY', 'EV', 'TIRES', 'DETAILING']).default('REPAIR'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  estimatedDuration: z.coerce.number().int().min(15).max(480).default(60),
  autoSchedule: z.boolean().default(true),
});

export const patchTaskSchema = z.object({
  status: z.enum(TASK_STATUS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().max(500).optional(),
  reschedule: z.boolean().optional(),
  reassign: z.boolean().optional(),
});

export const addPartSchema = z.object({ partNumber: z.string().trim().min(3), qty: z.coerce.number().int().min(1).max(20).default(1) });

export const inspectionSchema = z.object({
  vehicleId: z.string().trim().min(2),
  issues: z
    .array(z.object({ area: z.string().trim().min(2).max(60), description: z.string().trim().min(2).max(120), severity: z.enum(['low', 'medium', 'high']).default('low') }))
    .min(1, 'Add at least one issue.'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  notes: z.string().max(500).optional(),
});

const withEnd = (t) => ({ ...t, scheduledEnd: t.scheduledTime ? new Date(new Date(t.scheduledTime).getTime() + (t.estimatedDuration || 60) * 60000) : null });
const suggestionsFor = (parts, model) =>
  compatibleParts(parts, model)
    .filter((p) => !p.compatibleModels.includes('*'))
    .slice(0, 6)
    .map((p) => ({ partNumber: p.partNumber, name: p.name, category: p.category }));

export async function listTasks(req, res) {
  const { status, vehicleId } = req.query;
  const filter = {};
  if (status === 'OPEN') filter.status = { $nin: ['COMPLETED', 'CANCELLED'] };
  else if (status) filter.status = status;
  if (vehicleId) filter.vehicleId = vehicleId;
  const items = await ServiceTask.find(filter).sort({ scheduledTime: 1, createdAt: -1 }).lean();
  const parts = await Part.find().lean();
  const vehicles = await Vehicle.find({ vehicleId: { $in: [...new Set(items.map((t) => t.vehicleId))] } }, { vehicleId: 1, model: 1 }).lean();
  const modelOf = Object.fromEntries(vehicles.map((v) => [v.vehicleId, v.model]));
  res.json({ items: items.map((t) => ({ ...withEnd(t), suggestedParts: suggestionsFor(parts, modelOf[t.vehicleId]) })) });
}

export async function getTask(req, res) {
  const task = await ServiceTask.findOne({ taskId: req.params.id }).lean();
  if (!task) throw ApiError.notFound(`Repair order ${req.params.id} not found.`);
  const resolutions = [];
  for (const line of task.requiredParts.filter((l) => l.status === 'SHORTAGE')) resolutions.push(await buildResolution(task, line.partNumber, line.qty));
  const [parts, vehicle] = await Promise.all([Part.find().lean(), Vehicle.findOne({ vehicleId: task.vehicleId }, { model: 1 }).lean()]);
  res.json({ task: { ...withEnd(task), suggestedParts: suggestionsFor(parts, vehicle?.model) }, resolutions });
}

export async function createTask(req, res) {
  const vehicle = await Vehicle.findOne({ vehicleId: req.body.vehicleId });
  if (!vehicle) throw ApiError.notFound(`Vehicle #${req.body.vehicleId} not found.`);
  const n = await nextSequence('task', 1000);
  const task = new ServiceTask({
    ...req.body,
    taskId: `RO-${n}`,
    vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    requiredSkill: SKILL_FOR_CATEGORY[req.body.category] || 'GENERAL',
    status: 'UNSCHEDULED',
    source: 'MANUAL',
    storeCode: vehicle.storeCode,
    history: [{ message: 'Repair order opened', actor: req.user.name }],
  });
  await task.save();
  let slot = null;
  if (req.body.autoSchedule) slot = await assignTask(task, { actor: actorOf(req) });
  await logActivity({ vehicleId: vehicle.vehicleId, type: 'SERVICE', message: `Repair order ${task.taskId} opened: ${task.issue}${slot ? ` (${slot.bayName}, ${slot.startLabel})` : ''}`, actor: actorOf(req), source: 'MANUAL' });
  await syncFromTask(task);
  emit('service:updated', { taskId: task.taskId });
  res.status(201).json({ task, slot });
}

export async function patchTask(req, res) {
  const task = await ServiceTask.findOne({ taskId: req.params.id });
  if (!task) throw ApiError.notFound(`Repair order ${req.params.id} not found.`);
  const actor = actorOf(req);
  const { status, priority, notes, reschedule, reassign } = req.body;
  const messages = [];

  if (priority) task.priority = priority;
  if (notes !== undefined) task.notes = notes;
  if (reassign) {
    const r = await reassignTechnician(task.taskId, actor);
    return res.json({ task: r.task, message: r.message });
  }
  if (reschedule) {
    const slot = await assignTask(task, { actor, reason: 'manual reschedule' });
    await syncFromTask(task);
    return res.json({ task, message: `Rescheduled to ${slot.startLabel} in ${slot.bayName} with ${slot.technicianName}.` });
  }

  if (status && status !== task.status) {
    if (status === 'IN_PROGRESS' && task.requiredParts.some((l) => l.status === 'SHORTAGE')) {
      throw ApiError.conflict('This job is waiting on parts. Resolve the shortage first.');
    }
    const from = task.status;
    task.status = status;
    if (status === 'IN_PROGRESS') {
      task.startedAt = new Date();
      if (!task.scheduledTime || task.scheduledTime > new Date()) task.scheduledTime = new Date();
      task.requiredParts.forEach((l) => {
        if (['TRANSFER_REQUESTED', 'IN_TRANSIT', 'ORDERED'].includes(l.status)) l.status = 'RECEIVED';
      });
      task.markModified('requiredParts');
    }
    if (status === 'COMPLETED') task.completedAt = new Date();
    task.history.push({ message: `Status ${from} → ${status}`, actor: actor.name });
    messages.push(`${task.taskId} is now ${status.toLowerCase().replace(/_/g, ' ')}`);

    const vehicle = await Vehicle.findOne({ vehicleId: task.vehicleId });
    if (vehicle) {
      if (status === 'IN_PROGRESS') vehicle.status = 'SERVICE';
      if (status === 'COMPLETED') {
        const others = await ServiceTask.countDocuments({ vehicleId: task.vehicleId, taskId: { $ne: task.taskId }, status: { $nin: ['COMPLETED', 'CANCELLED'] } });
        const cond = vehicle.toObject().condition || {};
        for (const [key, c] of Object.entries(cond)) {
          if (c?.status && c.status !== 'GOOD' && key !== 'fuel') setCondition(vehicle, key, { status: 'GOOD', notes: `Resolved in ${task.taskId}` });
        }
        if (!others) vehicle.status = vehicle.ownership === 'INVENTORY' ? (vehicle.reservedFor ? 'HOLD' : 'AVAILABLE') : 'SERVICE';
        const h = vehicle.serviceHistory.find((x) => x.refId === task.taskId);
        if (h) h.status = 'COMPLETED';
        else vehicle.serviceHistory.push({ refId: task.taskId, date: new Date(), summary: task.issue, status: 'COMPLETED' });
        if (task.inspectionId) await Inspection.updateOne({ inspectionId: task.inspectionId }, { $set: { status: 'CLOSED' } });
      }
      applyHealth(vehicle);
      await vehicle.save();
      emit('vehicle:updated', vehicle.toJSON());
    }
    await logActivity({ vehicleId: task.vehicleId, type: 'SERVICE', message: `${task.taskId} ${status === 'IN_PROGRESS' ? 'started' : status === 'QUALITY_CHECK' ? 'moved to quality check' : status === 'COMPLETED' ? 'completed' : `set to ${status.toLowerCase()}`}${task.technicianName ? ` (${task.technicianName})` : ''}`, actor, source: 'MANUAL' });
  }
  await task.save();
  await syncFromTask(task);
  emit('service:updated', { taskId: task.taskId });
  res.json({ task, message: messages.join('. ') || 'Saved.' });
}

export async function addPart(req, res) {
  const r = await addPartToTask(req.params.id, req.body, actorOf(req));
  res.status(201).json(r);
}

export async function board(_req, res) {
  res.json(await getBoard());
}

export async function recommendation(_req, res) {
  const rec = await computeRecommendation();
  res.json({ ...rec, ops: rec.ops.map(({ apply, ...op }) => ({ ...op, newStart: apply.scheduledTime, newStartLabel: formatLocalTime(apply.scheduledTime) })) });
}

export async function applyDispatch(req, res) {
  const r = await applyRecommendation(actorOf(req));
  res.json({ ...r, ops: r.ops.map(({ apply, ...op }) => op), applied: r.applied.map(({ apply, ...op }) => op) });
}

export async function technicians(_req, res) {
  res.json({ items: await Technician.find().sort({ techId: 1 }).lean() });
}

export async function bays(_req, res) {
  res.json({ items: await Bay.find().sort({ code: 1 }).lean() });
}

/* ---- inspections ---- */

export async function listInspections(req, res) {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const items = await Inspection.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items });
}

export async function postInspection(req, res) {
  const issues = req.body.issues.map((i) => ({ ...i, conditionKey: conditionKeyForArea(i.area) }));
  const r = await createInspection({ ...req.body, issues }, req.user);
  res.status(201).json(r);
}

export async function convertInspection(req, res) {
  const r = await convertToServiceTask(req.params.id, actorOf(req));
  res.status(r.alreadyConverted ? 200 : 201).json(r);
}

export async function patchInspection(req, res) {
  const status = z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'CLOSED']).parse(req.body.status);
  const ins = await Inspection.findOneAndUpdate({ inspectionId: req.params.id }, { $set: { status } }, { returnDocument: 'after' });
  if (!ins) throw ApiError.notFound('Inspection not found.');
  emit('inspection:updated', ins.toJSON());
  res.json({ inspection: ins });
}
