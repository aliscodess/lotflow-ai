import mongoose from 'mongoose';
import { Customer, Dealership } from '../models/index.js';
import { buildSteps, stageFromTask, taskEnd } from '../utils/serviceSteps.js';
import { SERVICE_STEPS } from '../utils/constants.js';
import { formatLocalTime } from '../utils/time.js';
import { ApiError } from '../utils/ApiError.js';
import { emit } from './socketService.js';

const stageLabel = (key) => SERVICE_STEPS.find((s) => s.key === key)?.label || key;

export async function findCustomer(idOrCode) {
  const or = [{ customerCode: idOrCode }, { trackingCode: String(idOrCode).toUpperCase() }, { vehicleId: idOrCode }];
  if (mongoose.isValidObjectId(idOrCode)) or.push({ _id: idOrCode });
  const c = await Customer.findOne({ $or: or });
  if (!c) throw ApiError.notFound('Customer not found.');
  return c;
}

function messageFor(customer, stage, eta) {
  const first = customer.name.split(' ')[0];
  const etaText = eta ? ` Estimated completion: ${formatLocalTime(eta)}.` : '';
  return `Hi ${first}, update on your ${customer.vehicleLabel}: ${stageLabel(stage)}.${etaText} Track live: lotflow.app/track/${customer.trackingCode} — Tekion Demo Motors`;
}

/** Keeps the customer-facing status in sync whenever a linked service task changes. */
export async function syncFromTask(task, { note } = {}) {
  const customer = await Customer.findOne({ $or: [{ serviceTaskId: task.taskId }, { vehicleId: task.vehicleId }] });
  if (!customer) return null;
  const stage = stageFromTask(task);
  const end = taskEnd(task);
  const eta = task.status === 'COMPLETED' ? task.completedAt || new Date() : end || customer.serviceStatus?.estimatedCompletion;
  const changed = customer.serviceStatus?.stage !== stage;
  const etaChanged = String(customer.serviceStatus?.estimatedCompletion || '') !== String(eta || '');
  if (!changed && !etaChanged && !note) return customer;

  customer.serviceTaskId = task.taskId;
  customer.serviceStatus = {
    stage,
    steps: buildSteps(stage, customer.serviceStatus?.steps),
    estimatedCompletion: eta,
    advisorNote: note ?? customer.serviceStatus?.advisorNote,
    updatedAt: new Date(),
  };
  if (changed || etaChanged) customer.notifications.push({ channel: 'SMS', message: messageFor(customer, stage, eta), at: new Date() });
  await customer.save();
  emit('customer:updated', publicView(customer));
  return customer;
}

export async function updateStatus(idOrCode, { stage, estimatedCompletion, note, notify = true }, actorName) {
  const customer = await findCustomer(idOrCode);
  const nextStage = stage || customer.serviceStatus.stage;
  if (!SERVICE_STEPS.some((s) => s.key === nextStage)) throw ApiError.badRequest('Unknown service stage.');
  const eta = estimatedCompletion ? new Date(estimatedCompletion) : customer.serviceStatus.estimatedCompletion;
  customer.serviceStatus = {
    stage: nextStage,
    steps: buildSteps(nextStage, customer.serviceStatus.steps),
    estimatedCompletion: eta,
    advisorNote: note ?? customer.serviceStatus.advisorNote,
    updatedAt: new Date(),
  };
  if (notify) customer.notifications.push({ channel: 'WHATSAPP', message: messageFor(customer, nextStage, eta), at: new Date() });
  if (actorName) customer.advisorName = actorName;
  await customer.save();
  emit('customer:updated', publicView(customer));
  return customer;
}

export async function sendUpdate(idOrCode, { channel = 'SMS', message } = {}) {
  const customer = await findCustomer(idOrCode);
  const text = message || messageFor(customer, customer.serviceStatus.stage, customer.serviceStatus.estimatedCompletion);
  customer.notifications.push({ channel, message: text, at: new Date() });
  await customer.save();
  emit('customer:updated', publicView(customer));
  return { customer, message: text };
}

let storeName = null;
export function publicView(c) {
  return {
    trackingCode: c.trackingCode,
    customerCode: c.customerCode,
    firstName: c.name.split(' ')[0],
    vehicleId: c.vehicleId,
    vehicleLabel: c.vehicleLabel,
    relationship: c.relationship,
    stage: c.serviceStatus?.stage,
    stageLabel: stageLabel(c.serviceStatus?.stage),
    steps: c.serviceStatus?.steps || [],
    estimatedCompletion: c.serviceStatus?.estimatedCompletion,
    advisorNote: c.serviceStatus?.advisorNote,
    advisorName: c.advisorName,
    updatedAt: c.serviceStatus?.updatedAt,
    dealership: storeName || 'Tekion Demo Motors · Whitefield',
  };
}

export async function primeStoreName() {
  const d = await Dealership.findOne().lean();
  const s = d?.stores?.find((x) => x.isPrimary);
  if (d && s) storeName = `${d.name}, ${s.name}`;
}
