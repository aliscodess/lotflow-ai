import { Vehicle, Inspection, ServiceTask, Alert, Customer, nextSequence } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { applyHealth, setCondition, worseStatus } from './healthService.js';
import { emit, notify } from './socketService.js';
import { logActivity, AI_ACTOR } from './activityService.js';
import { assignTask, previewSlot } from './dispatchService.js';
import { syncFromTask } from './customerService.js';

const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
export const issueSummary = (issues = []) => issues.map((i) => `${cap(i.area)}: ${i.description}`).join('. ');
const inspectionDuration = (issues = []) => Math.min(90, 30 + 15 * Math.ceil(issues.length / 2));
const ALERT_PRIORITY = { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'HIGH', URGENT: 'CRITICAL' };

/**
 * Opens an inspection for a vehicle document (caller saves the vehicle),
 * then raises an actionable alert for the service team.
 */
export async function openInspection(vehicle, { issues, priority = 'MEDIUM', source = 'MANUAL', transcript, aiMeta, photos = [], actor, userId, notes }) {
  const n = await nextSequence('inspection', 1000);
  const inspectionId = `INS-${n}`;
  const label = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const inspection = await Inspection.create({
    inspectionId,
    vehicleId: vehicle.vehicleId,
    vehicle: vehicle._id,
    vehicleLabel: label,
    reportedBy: { userId, name: actor?.name, role: actor?.role },
    issues,
    photos: photos.map((p) => ({ url: p.url, label: p.label })),
    status: 'OPEN',
    priority,
    source,
    transcript,
    aiMeta,
    notes,
  });
  vehicle.status = 'INSPECTION_REQUIRED';
  vehicle.inspectionHistory.push({ refId: inspectionId, date: new Date(), summary: issueSummary(issues), status: 'OPEN' });

  const slot = await previewSlot({ skill: 'INSPECTION', duration: inspectionDuration(issues) });
  const alert = await Alert.create({
    type: 'INSPECTION',
    priority: ALERT_PRIORITY[priority] || 'HIGH',
    title: `Vehicle #${vehicle.vehicleId} requires inspection`,
    vehicleId: vehicle.vehicleId,
    description: `${issueSummary(issues)}. Reported by ${actor?.name || 'the lot team'}${source === 'VOICE' ? ' during the lot walk' : ''}.`,
    reason: source === 'VOICE' ? 'Damage reported during lot walk.' : 'Inspection requested.',
    recommendedAction: slot ? `Assign inspection to ${slot.bayName} at ${slot.startLabel} (${slot.technicianName}).` : 'Assign inspection to the next free bay.',
    expectedImpact: 'Vehicle back to sale-ready status the same day.',
    actionType: 'ASSIGN_INSPECTION',
    actionLabel: 'Take action',
    payload: { inspectionId, vehicleId: vehicle.vehicleId },
    details: { issues },
    audience: ['MANAGER', 'SERVICE_ADVISOR'],
  });
  emit('inspection:new', inspection.toJSON());
  emit('alert:new', alert.toJSON());
  notify({
    title: 'New inspection required',
    message: `Vehicle #${vehicle.vehicleId}: ${issues.map((i) => `${i.area} ${i.description}`).join(', ')}`,
    priority: alert.priority,
    kind: 'alert',
    vehicleId: vehicle.vehicleId,
    link: `/vehicles/${vehicle.vehicleId}`,
    roles: ['MANAGER', 'SERVICE_ADVISOR'],
  });
  await logActivity({ vehicleId: vehicle.vehicleId, type: 'INSPECTION', message: `Inspection task created (${inspectionId}, ${priority.toLowerCase()} priority)`, actor, source: source === 'VOICE' ? 'VOICE' : 'MANUAL' });
  return { inspection, alert, slot };
}

/** Manual inspection request from the UI. */
export async function createInspection({ vehicleId, issues, priority = 'MEDIUM', notes }, user) {
  const vehicle = await Vehicle.findOne({ vehicleId });
  if (!vehicle) throw ApiError.notFound(`Vehicle #${vehicleId} not found.`);
  const actor = { name: user.name, role: user.role };
  for (const i of issues) {
    const cur = vehicle.toObject().condition?.[i.conditionKey] || {};
    setCondition(vehicle, i.conditionKey, { status: worseStatus(cur.status, i.severity === 'high' ? 'POOR' : 'FAIR'), notes: `${cap(i.area)}: ${i.description}` });
  }
  const result = await openInspection(vehicle, { issues, priority, source: 'MANUAL', actor, userId: user.id, notes });
  applyHealth(vehicle);
  await vehicle.save();
  emit('vehicle:updated', vehicle.toJSON());
  return result;
}

/** Inspection → repair order, with bay and technician assigned by the dispatcher. */
export async function convertToServiceTask(inspectionId, actor, { auto = false } = {}) {
  const inspection = await Inspection.findOne({ inspectionId });
  if (!inspection) throw ApiError.notFound(`Inspection ${inspectionId} not found.`);
  if (inspection.status === 'CONVERTED' && inspection.serviceTaskId) {
    const existing = await ServiceTask.findOne({ taskId: inspection.serviceTaskId });
    return { task: existing, inspection, alreadyConverted: true, message: `${inspectionId} is already on ${inspection.serviceTaskId}.` };
  }
  const vehicle = await Vehicle.findOne({ vehicleId: inspection.vehicleId });
  if (!vehicle) throw ApiError.notFound(`Vehicle #${inspection.vehicleId} not found.`);
  const customer = await Customer.findOne({ vehicleId: vehicle.vehicleId });

  const n = await nextSequence('task', 1000);
  const task = new ServiceTask({
    taskId: `RO-${n}`,
    vehicleId: vehicle.vehicleId,
    vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    customer: customer?._id,
    issue: `Inspection: ${inspection.issues.map((i) => `${i.area} ${i.description}`).join('; ')}`,
    description: inspection.transcript || inspection.notes || '',
    category: 'INSPECTION',
    requiredSkill: 'INSPECTION',
    priority: inspection.priority,
    status: 'UNSCHEDULED',
    estimatedDuration: inspectionDuration(inspection.issues),
    inspectionId,
    source: 'INSPECTION',
    storeCode: vehicle.storeCode,
    history: [{ message: `Repair order opened from ${inspectionId}`, actor: actor?.name || 'LotFlow AI' }],
  });
  await task.save();
  const slot = await assignTask(task, { actor, reason: auto ? 'auto-dispatched from voice report' : undefined });

  inspection.status = 'CONVERTED';
  inspection.serviceTaskId = task.taskId;
  await inspection.save();

  vehicle.status = 'SERVICE';
  const hist = vehicle.inspectionHistory.find((h) => h.refId === inspectionId);
  if (hist) hist.status = 'CONVERTED';
  vehicle.serviceHistory.push({ refId: task.taskId, date: task.scheduledTime, summary: task.issue, status: task.status });
  applyHealth(vehicle);
  await vehicle.save();

  if (customer) {
    customer.serviceTaskId = task.taskId;
    await customer.save();
  }

  await Alert.updateMany(
    { status: 'OPEN', type: 'INSPECTION', 'payload.inspectionId': inspectionId },
    { $set: { status: 'RESOLVED', resolution: { by: actor?.name || 'LotFlow AI', at: new Date(), note: `${task.taskId} · ${slot.bayName} · ${slot.technicianName} at ${slot.startLabel}` } } },
  );

  await logActivity({ vehicleId: vehicle.vehicleId, type: 'SERVICE', message: `Repair order ${task.taskId} created from ${inspectionId}`, actor: actor || AI_ACTOR, source: auto ? 'AI' : 'MANUAL' });
  await logActivity({ vehicleId: vehicle.vehicleId, type: 'SCHEDULE', message: `Service bay assigned: ${slot.bayName} · ${slot.technicianName} at ${slot.startLabel}`, actor: AI_ACTOR, source: 'AI' });
  await syncFromTask(task);

  emit('vehicle:updated', vehicle.toJSON());
  emit('service:updated', { taskId: task.taskId });
  emit('alert:updated', { inspectionId });
  notify({
    title: 'Bay and technician assigned',
    message: `#${vehicle.vehicleId} → ${slot.bayName} with ${slot.technicianName} at ${slot.startLabel}`,
    kind: 'success',
    vehicleId: vehicle.vehicleId,
    link: '/service',
    roles: ['MANAGER', 'SERVICE_ADVISOR'],
  });
  return { task, inspection, slot, message: `${task.taskId} created. ${slot.bayName} with ${slot.technicianName} at ${slot.startLabel}.` };
}
