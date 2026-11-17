/**
 * AI Action Center: every open, actionable alert maps to an executable action.
 * "Apply" runs the real workflow (dispatch, parts, inspections, customers) and resolves the alert.
 */
import mongoose from 'mongoose';
import { Alert, Vehicle, ServiceTask, nextSequence } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { startOfLocalDay, formatLocalTime, addMinutes } from '../utils/time.js';
import { emit, notify } from './socketService.js';
import { logActivity, AI_ACTOR } from './activityService.js';
import { convertToServiceTask } from './inspectionService.js';
import { resolveShortage } from './partsService.js';
import { reassignTechnician, assignTask, applyRecommendation, toEntry } from './dispatchService.js';
import { applyAgingPlaybook } from './analyticsService.js';
import { syncFromTask, sendUpdate } from './customerService.js';
import { applyHealth } from './healthService.js';

const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export async function listActions(role) {
  const filter = { actionType: { $exists: true, $ne: null } };
  if (role && role !== 'MANAGER') filter.audience = role;
  const [open, applied] = await Promise.all([
    Alert.find({ ...filter, status: 'OPEN' }).lean(),
    Alert.find({ ...filter, status: 'RESOLVED', 'resolution.at': { $gte: startOfLocalDay() } }).sort({ 'resolution.at': -1 }).lean(),
  ]);
  open.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || new Date(b.createdAt) - new Date(a.createdAt));
  return { open, applied, counts: { open: open.length, appliedToday: applied.length } };
}

async function scheduleCharge(vehicleId, actor) {
  const vehicle = await Vehicle.findOne({ vehicleId });
  if (!vehicle) throw ApiError.notFound(`Vehicle #${vehicleId} not found.`);
  const n = await nextSequence('task', 1000);
  const task = new ServiceTask({
    taskId: `RO-${n}`,
    vehicleId,
    vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    issue: 'Top-up charge to 80% + 12V battery check',
    category: 'EV',
    requiredSkill: 'EV',
    priority: 'MEDIUM',
    status: 'UNSCHEDULED',
    estimatedDuration: 60,
    source: 'AI',
    history: [{ message: 'Created from a low state-of-charge alert', actor: actor?.name || 'LotFlow AI' }],
  });
  await task.save();
  const slot = await assignTask(task, { actor, reason: 'battery health' });
  await logActivity({ vehicleId, type: 'SERVICE', message: `Charging session booked: ${slot.bayName} at ${slot.startLabel}`, actor: actor || AI_ACTOR, source: 'AI' });
  return `Charging booked in ${slot.bayName} at ${slot.startLabel} with ${slot.technicianName} (${task.taskId}).`;
}

async function lotAudit(vehicleId, actor) {
  const vehicle = await Vehicle.findOne({ vehicleId });
  if (!vehicle) throw ApiError.notFound(`Vehicle #${vehicleId} not found.`);
  vehicle.flags.auditRequested = true;
  applyHealth(vehicle);
  await vehicle.save();
  const where = vehicle.location?.row ? `${vehicle.location.row}${vehicle.location.position}` : 'unknown';
  notify({
    title: 'Locate request',
    message: `Please confirm #${vehicleId} (${vehicle.year} ${vehicle.make} ${vehicle.model}). Last recorded at ${where}.`,
    priority: 'MEDIUM',
    kind: 'task',
    vehicleId,
    link: '/voice',
    roles: ['LOT_ASSOCIATE'],
  });
  await logActivity({ vehicleId, type: 'LOCATION', message: `Locate request sent to lot associates (last recorded ${where})`, actor: actor || AI_ACTOR, source: 'AI' });
  emit('vehicle:updated', vehicle.toJSON());
  return `Locate request sent to the lot associate on shift for #${vehicleId} (last recorded at ${where}).`;
}

async function notifyCustomerDelay(taskId, actor) {
  const task = await ServiceTask.findOne({ taskId });
  if (!task) throw ApiError.notFound(`Repair order ${taskId} not found.`);
  const entry = toEntry(task.toObject());
  const eta = addMinutes(new Date(entry.end), 15);
  await syncFromTask(task, { note: 'Your service is taking a little longer than planned. We have updated the time below.' });
  const { message } = await sendUpdate(task.vehicleId, {
    channel: 'WHATSAPP',
    message: `Hi, your ${task.vehicleLabel} service is taking a little longer than planned. New estimated completion: ${formatLocalTime(eta)}. Sorry for the wait. — Tekion Demo Motors`,
  });
  await logActivity({ vehicleId: task.vehicleId, type: 'CUSTOMER', message: `Revised ETA ${formatLocalTime(eta)} sent to customer via WhatsApp`, actor: actor || AI_ACTOR, source: 'AI' });
  return `Customer notified on WhatsApp: "${message.slice(0, 90)}…"`;
}

/** Executes the action behind an alert and resolves it. */
export async function applyAction(alertId, actor) {
  if (!mongoose.isValidObjectId(alertId)) throw ApiError.badRequest('Invalid action id.');
  const alert = await Alert.findById(alertId);
  if (!alert) throw ApiError.notFound('Action not found.');
  if (alert.status !== 'OPEN') return { alert, message: alert.resolution?.note || 'Already handled.', alreadyApplied: true };
  const p = alert.payload || {};
  let message;

  switch (alert.actionType) {
    case 'ASSIGN_INSPECTION': {
      const r = await convertToServiceTask(p.inspectionId, actor);
      message = r.message;
      break;
    }
    case 'RESOLVE_PARTS_SHORTAGE': {
      const r = await resolveShortage({ taskId: p.taskId, partNumber: p.partNumber }, actor);
      message = r.message;
      break;
    }
    case 'REASSIGN_TECHNICIAN': {
      const r = await reassignTechnician(p.taskId, actor);
      message = r.message;
      break;
    }
    case 'SCHEDULE_URGENT': {
      const task = await ServiceTask.findOne({ taskId: p.taskId });
      if (!task) throw ApiError.notFound(`Repair order ${p.taskId} not found.`);
      const slot = await assignTask(task, { actor, reason: 'urgent — prioritised' });
      await syncFromTask(task);
      await logActivity({ vehicleId: task.vehicleId, type: 'SCHEDULE', message: `Urgent job scheduled: ${slot.bayName} · ${slot.technicianName} at ${slot.startLabel}`, actor: actor || AI_ACTOR, source: 'AI' });
      message = `${task.taskId} scheduled in ${slot.bayName} with ${slot.technicianName} at ${slot.startLabel}.`;
      break;
    }
    case 'AGING_PLAYBOOK': {
      const r = await applyAgingPlaybook(p.vehicleId || alert.vehicleId, actor);
      message = r.message;
      break;
    }
    case 'SCHEDULE_CHARGE':
      message = await scheduleCharge(p.vehicleId || alert.vehicleId, actor);
      break;
    case 'LOT_AUDIT':
      message = await lotAudit(p.vehicleId || alert.vehicleId, actor);
      break;
    case 'NOTIFY_CUSTOMER':
      message = await notifyCustomerDelay(p.taskId, actor);
      break;
    case 'APPLY_DISPATCH': {
      const r = await applyRecommendation(actor);
      message = `${r.appliedCount} schedule changes applied. Idle time ${r.idleBefore} → ${r.idleAfter} min.`;
      break;
    }
    default:
      throw ApiError.badRequest('This alert has no automatic action.');
  }

  const fresh = await Alert.findById(alertId);
  if (fresh.status === 'OPEN') {
    fresh.status = 'RESOLVED';
    fresh.resolution = { by: actor?.name || 'LotFlow AI', at: new Date(), note: message };
    await fresh.save();
  } else if (!fresh.resolution?.note) {
    fresh.resolution = { ...fresh.resolution, note: message };
    await fresh.save();
  }
  emit('alert:updated', { _id: alertId, status: 'RESOLVED' });
  emit('dashboard:refresh', {});
  return { alert: fresh, message };
}
