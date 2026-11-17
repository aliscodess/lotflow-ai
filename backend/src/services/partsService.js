/**
 * Service parts shortage resolver.
 * Checks stock across the group's stores, recommends the fastest way to get a part
 * (express inter-store transfer vs. the scheduled parts run vs. OEM order), and applies it.
 */
import { Part, PartTransfer, Dealership, ServiceTask, Alert, nextSequence } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { MINUTE, DAY, formatLocalTime, startOfLocalDay } from '../utils/time.js';
import { emit, notify } from './socketService.js';
import { logActivity, AI_ACTOR } from './activityService.js';
import { syncFromTask } from './customerService.js';
import { assignTask, previewSlot } from './dispatchService.js';

let storeCache = null;
export async function getStores() {
  if (!storeCache) {
    const d = await Dealership.findOne().lean();
    storeCache = d?.stores || [];
  }
  return storeCache;
}
export function clearStoreCache() {
  storeCache = null;
}

/** Express transfer: 60 min handling + ~5 min per km in Bengaluru traffic. 12 km ≈ 2 h. */
export const expressEtaMinutes = (km) => Math.round(60 + km * 5);

/** The group's scheduled inter-store parts runs leave at 11:00 and 15:30 local time. */
export function nextPartsRun(now = Date.now()) {
  const runs = [
    [11, 0],
    [15, 30],
  ];
  const dayStart = startOfLocalDay(new Date(now)).getTime();
  for (let d = 0; d < 4; d += 1) {
    for (const [h, m] of runs) {
      const t = dayStart + d * DAY + (h * 60 + m) * MINUTE;
      if (t >= now + 30 * MINUTE) return new Date(t);
    }
  }
  return new Date(now + DAY);
}

const LABOUR_MINUTES = { Brakes: 45, AC: 90, Tyres: 20, Electrical: 20, EV: 40, Body: 60, Lubricants: 0, Filters: 10, Wipers: 5, Engine: 30, Transmission: 120 };

async function adjustStock(partNumber, storeCode, { reserved = 0, quantity = 0 }) {
  const p = await Part.findOne({ partNumber });
  if (!p) return;
  let inv = p.inventoryByStore.find((i) => i.storeCode === storeCode);
  if (!inv) {
    p.inventoryByStore.push({ storeCode, quantity: 0, reserved: 0 });
    inv = p.inventoryByStore[p.inventoryByStore.length - 1];
  }
  inv.quantity = Math.max(0, (inv.quantity || 0) + quantity);
  inv.reserved = Math.max(0, (inv.reserved || 0) + reserved);
  p.markModified('inventoryByStore');
  await p.save();
}

export async function availability(partNumber, qty = 1, localStore = 'S1') {
  const part = await Part.findOne({ partNumber }).lean();
  if (!part) throw ApiError.notFound(`Part ${partNumber} not found.`);
  const stores = await getStores();
  const rows = stores.map((s) => {
    const inv = part.inventoryByStore.find((i) => i.storeCode === s.code) || { quantity: 0, reserved: 0 };
    return {
      code: s.code,
      name: s.name,
      label: s.label,
      distanceKm: s.code === localStore ? 0 : s.distanceKm,
      quantity: inv.quantity,
      reserved: inv.reserved || 0,
      available: Math.max(0, inv.quantity - (inv.reserved || 0)),
      isLocal: s.code === localStore,
      bin: inv.bin,
    };
  });
  const local = rows.find((r) => r.isLocal);
  return {
    part: { partNumber: part.partNumber, name: part.name, category: part.category, brand: part.brand, unitPriceINR: part.unitPriceINR, leadTimeDays: part.leadTimeDays },
    stores: rows,
    localAvailable: local?.available || 0,
    enoughLocal: (local?.available || 0) >= qty,
  };
}

export async function bestTransferOption(partNumber, qty = 1, localStore = 'S1') {
  const a = await availability(partNumber, qty, localStore);
  const s = a.stores.filter((x) => !x.isLocal && x.available >= qty).sort((x, y) => x.distanceKm - y.distanceKm)[0];
  if (!s) return null;
  const etaMinutes = expressEtaMinutes(s.distanceKm);
  return { fromStore: s.code, storeName: s.name, storeLabel: s.label, distanceKm: s.distanceKm, available: s.available, etaMinutes, eta: new Date(Date.now() + etaMinutes * MINUTE) };
}

const hrs = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);

/** Options for getting a missing part, with the recommended one flagged. */
export async function buildResolution(task, partNumber, qty = 1) {
  const a = await availability(partNumber, qty, task?.storeCode || 'S1');
  const now = Date.now();
  const baseStart = task?.scheduledTime && new Date(task.scheduledTime).getTime() > now ? new Date(task.scheduledTime).getTime() : now;
  const skill = task?.requiredSkill || 'GENERAL';
  const duration = task?.estimatedDuration || 60;
  const options = [];

  if (a.enoughLocal) {
    return { ...a, qty, status: 'LOCAL', options: [], recommended: null, summary: `${a.part.name} is in stock at this store. Reserve it for the job.` };
  }

  const best = await bestTransferOption(partNumber, qty, task?.storeCode || 'S1');
  if (best) {
    const slot = await previewSlot({ skill, duration, earliest: best.eta, preferBay: task?.bay, ignoreTaskId: task?.taskId });
    options.push({
      type: 'TRANSFER',
      title: `Transfer ${qty} unit${qty > 1 ? 's' : ''} from ${best.storeLabel} (${best.storeName})`,
      fromStore: best.fromStore,
      storeName: best.storeName,
      storeLabel: best.storeLabel,
      distanceKm: best.distanceKm,
      etaMinutes: best.etaMinutes,
      eta: best.eta,
      etaLabel: formatLocalTime(best.eta),
      delayMinutes: Math.max(0, Math.round((best.eta.getTime() - baseStart) / MINUTE)),
      delayLabel: hrs(Math.max(0, Math.round((best.eta.getTime() - baseStart) / MINUTE))),
      costINR: Math.round(250 + best.distanceKm * 18),
      co2Kg: Number((best.distanceKm * 2 * 0.14).toFixed(1)),
      newStart: slot?.start,
      newStartLabel: slot?.startLabel,
      newEndLabel: slot?.endLabel,
      bayName: slot?.bayName,
      technicianName: slot?.technicianName,
    });
    const run = nextPartsRun(now);
    const arrival = new Date(run.getTime() + (20 + best.distanceKm * 3) * MINUTE);
    const slot2 = await previewSlot({ skill, duration, earliest: arrival, preferBay: task?.bay, ignoreTaskId: task?.taskId });
    if (slot2) {
      options.push({
        type: 'RESCHEDULE',
        title: `Reschedule job to ${slot2.startLabel}`,
        via: `Add the part to the ${formatLocalTime(run)} parts run from ${best.storeName}: no extra trip`,
        fromStore: best.fromStore,
        storeName: best.storeName,
        storeLabel: best.storeLabel,
        distanceKm: best.distanceKm,
        eta: arrival,
        etaLabel: formatLocalTime(arrival),
        delayMinutes: Math.max(0, Math.round((slot2.start.getTime() - baseStart) / MINUTE)),
        delayLabel: hrs(Math.max(0, Math.round((slot2.start.getTime() - baseStart) / MINUTE))),
        costINR: 0,
        co2Kg: 0,
        newStart: slot2.start,
        newStartLabel: slot2.startLabel,
        newEndLabel: slot2.endLabel,
        bayName: slot2.bayName,
        technicianName: slot2.technicianName,
      });
    }
    const [t, r] = options;
    const runIsAsFast = r && t.newStart && r.newStart && r.newStart.getTime() <= t.newStart.getTime();
    options.forEach((o) => { o.recommended = runIsAsFast ? o.type === 'RESCHEDULE' : o.type === 'TRANSFER'; });
  } else {
    const eta = new Date(now + (a.part.leadTimeDays || 3) * DAY);
    const slot = await previewSlot({ skill, duration, earliest: eta, preferBay: task?.bay, ignoreTaskId: task?.taskId });
    options.push({
      type: 'BACKORDER',
      recommended: true,
      title: `Order from OEM warehouse (${a.part.leadTimeDays || 3} days)`,
      eta,
      etaLabel: eta.toDateString(),
      delayMinutes: Math.round((eta.getTime() - baseStart) / MINUTE),
      delayLabel: `${a.part.leadTimeDays || 3} days`,
      costINR: 0,
      co2Kg: 0,
      newStart: slot?.start,
      newStartLabel: slot?.startLabel,
    });
  }

  const rec = options.find((o) => o.recommended);
  const summary =
    rec?.type === 'TRANSFER'
      ? `Best option: ${rec.title}. ${rec.distanceKm} km away, estimated delay ${rec.delayLabel}.`
      : rec?.type === 'RESCHEDULE'
        ? `Best option: ${rec.title}. ${rec.via}.`
        : 'No store in the group has this part. Order it from the OEM.';
  return { ...a, qty, status: best ? 'TRANSFER' : 'BACKORDER', options, recommended: rec?.type || null, summary };
}

async function createTransfer({ part, qty, fromStore, toStore, eta, etaMinutes, distanceKm, task, via, actor }) {
  const n = await nextSequence('transfer', 500);
  const transfer = await PartTransfer.create({
    transferId: `TR-${n}`,
    partNumber: part.partNumber,
    partName: part.name,
    qty,
    fromStore,
    toStore,
    distanceKm,
    etaMinutes,
    eta,
    serviceTaskId: task?.taskId,
    vehicleId: task?.vehicleId,
    status: 'REQUESTED',
    requestedBy: via === 'PARTS_RUN' ? `${actor?.name || 'LotFlow AI'} (scheduled parts run)` : actor?.name || 'LotFlow AI',
  });
  await adjustStock(part.partNumber, fromStore, { reserved: qty });
  emit('parts:updated', { transferId: transfer.transferId });
  return transfer;
}

/** Requests the part for a SHORTAGE line (used by the resolver and the dispatcher). */
export async function requestTransferForLine(task, line, { strategy = 'TRANSFER', actor } = {}) {
  const res = await buildResolution(task, line.partNumber, line.qty);
  const option = res.options.find((o) => o.type === strategy) || res.options.find((o) => o.recommended);
  if (!option) throw ApiError.conflict('No way to source this part was found.');
  let transfer = null;
  if (option.type === 'BACKORDER') {
    line.status = 'ORDERED';
    line.eta = option.eta;
  } else {
    transfer = await createTransfer({
      part: res.part,
      qty: line.qty,
      fromStore: option.fromStore,
      toStore: task.storeCode || 'S1',
      eta: option.eta,
      etaMinutes: Math.round((new Date(option.eta).getTime() - Date.now()) / MINUTE),
      distanceKm: option.distanceKm,
      task,
      via: option.type === 'RESCHEDULE' ? 'PARTS_RUN' : 'EXPRESS',
      actor,
    });
    line.status = 'TRANSFER_REQUESTED';
    line.eta = option.eta;
    line.sourceStore = option.fromStore;
    line.transferId = transfer.transferId;
  }
  task.markModified('requiredParts');
  await Alert.updateMany(
    { status: 'OPEN', type: 'PARTS_SHORTAGE', 'payload.taskId': task.taskId, 'payload.partNumber': line.partNumber },
    { $set: { status: 'RESOLVED', resolution: { by: actor?.name || 'LotFlow AI', at: new Date(), note: option.title } } },
  );
  await logActivity({
    vehicleId: task.vehicleId,
    type: 'PART',
    message:
      option.type === 'BACKORDER'
        ? `${res.part.name} ordered from OEM (ETA ${option.etaLabel})`
        : `Part transfer requested: ${res.part.name} ×${line.qty} from ${option.storeName} (ETA ${option.etaLabel})`,
    actor: actor || AI_ACTOR,
    source: 'AI',
    meta: { transferId: transfer?.transferId },
  });
  return { option, transfer, resolution: res };
}

/** Adds a required part to a job, reserving local stock or flagging a shortage. */
export async function addPartToTask(taskId, { partNumber, qty = 1 }, actor) {
  const task = await ServiceTask.findOne({ taskId });
  if (!task) throw ApiError.notFound(`Repair order ${taskId} not found.`);
  if (['COMPLETED', 'CANCELLED'].includes(task.status)) throw ApiError.conflict('This repair order is already closed.');
  const part = await Part.findOne({ partNumber }).lean();
  if (!part) throw ApiError.notFound(`Part ${partNumber} not found.`);

  const existing = task.requiredParts.find((l) => l.partNumber === partNumber);
  if (existing) {
    const resolution = existing.status === 'SHORTAGE' ? await buildResolution(task, partNumber, existing.qty) : null;
    return { task, resolution, reserved: existing.status !== 'SHORTAGE', duplicate: true };
  }

  const a = await availability(partNumber, qty, task.storeCode || 'S1');
  task.estimatedDuration = (task.estimatedDuration || 45) + (LABOUR_MINUTES[part.category] ?? 15);
  let resolution = null;
  let alert = null;

  if (a.enoughLocal) {
    await adjustStock(partNumber, task.storeCode || 'S1', { reserved: qty });
    task.requiredParts.push({ partNumber, name: part.name, qty, status: 'RESERVED', sourceStore: task.storeCode || 'S1' });
    task.history.push({ message: `${part.name} ×${qty} reserved from local stock`, actor: actor?.name });
    await task.save();
    await logActivity({ vehicleId: task.vehicleId, type: 'PART', message: `${part.name} ×${qty} reserved for ${task.taskId}`, actor, source: 'MANUAL' });
  } else {
    task.requiredParts.push({ partNumber, name: part.name, qty, status: 'SHORTAGE' });
    if (['SCHEDULED', 'UNSCHEDULED'].includes(task.status)) task.status = 'WAITING_PARTS';
    task.history.push({ message: `${part.name} ×${qty} required — not in local stock`, actor: actor?.name });
    await task.save();
    resolution = await buildResolution(task, partNumber, qty);
    const rec = resolution.options.find((o) => o.recommended);
    const storeLine = resolution.stores.map((s) => `${s.name}: ${s.available}`).join(', ');
    alert = await Alert.findOne({ status: 'OPEN', type: 'PARTS_SHORTAGE', 'payload.taskId': taskId, 'payload.partNumber': partNumber });
    if (!alert) {
      alert = await Alert.create({
        type: 'PARTS_SHORTAGE',
        priority: task.priority === 'URGENT' ? 'CRITICAL' : 'HIGH',
        title: `Parts shortage detected: ${part.name.toLowerCase()} for #${task.vehicleId}`,
        vehicleId: task.vehicleId,
        description: `${task.taskId} needs ${part.name} (${partNumber}). ${storeLine}.`,
        reason: 'Local store is out of stock.',
        recommendedAction: rec ? `${rec.title}${rec.distanceKm ? ` — ${rec.distanceKm} km, ETA ${rec.etaLabel}` : ''}` : 'Order from OEM',
        expectedImpact: rec?.type === 'TRANSFER' ? `Job can start at ${rec.newStartLabel} instead of waiting ${part.leadTimeDays} days for an OEM order.` : 'Avoids an unplanned delay.',
        actionType: 'RESOLVE_PARTS_SHORTAGE',
        actionLabel: 'Resolve shortage',
        payload: { taskId, partNumber },
        details: { stores: resolution.stores.map((s) => ({ code: s.code, name: s.name, qty: s.available })) },
        audience: ['MANAGER', 'SERVICE_ADVISOR'],
      });
      emit('alert:new', alert.toJSON());
    }
    await logActivity({ vehicleId: task.vehicleId, type: 'PART', message: `Parts shortage: ${part.name} unavailable locally. ${resolution.summary}`, actor: AI_ACTOR, source: 'AI' });
    notify({ title: 'Parts shortage detected', message: `#${task.vehicleId} needs ${part.name.toLowerCase()}. ${rec ? rec.title : 'Order from OEM'}.`, priority: 'HIGH', kind: 'warning', vehicleId: task.vehicleId, link: '/service', roles: ['MANAGER', 'SERVICE_ADVISOR'] });
  }

  await syncFromTask(task);
  emit('service:updated', { taskId });
  return { task, resolution, alert, reserved: a.enoughLocal };
}

/** Applies the chosen resolution: requests the part and reschedules the job around its arrival. */
export async function resolveShortage({ taskId, partNumber, strategy }, actor) {
  const task = await ServiceTask.findOne({ taskId });
  if (!task) throw ApiError.notFound(`Repair order ${taskId} not found.`);
  const line = task.requiredParts.find((l) => l.partNumber === partNumber);
  if (!line) throw ApiError.notFound(`${partNumber} is not on ${taskId}.`);
  if (line.status !== 'SHORTAGE') {
    return { task, alreadyResolved: true, message: `${line.name} is already ${line.status.toLowerCase().replace(/_/g, ' ')}.` };
  }

  const chosen = strategy || (await buildResolution(task, partNumber, line.qty)).recommended || 'TRANSFER';
  const { option, transfer } = await requestTransferForLine(task, line, { strategy: chosen, actor });
  const slot = await assignTask(task, {
    earliest: option.eta,
    preferBay: task.bay,
    keepTech: true,
    actor,
    reason: option.type === 'TRANSFER' ? `after ${line.name} arrives from ${option.storeName}` : option.type === 'RESCHEDULE' ? 'aligned with the scheduled parts run' : 'after OEM delivery',
  });
  await logActivity({
    vehicleId: task.vehicleId,
    type: 'SCHEDULE',
    message: `Repair scheduled: ${slot.bayName} · ${slot.technicianName} at ${slot.startLabel} (est. completion ${slot.endLabel})`,
    actor: actor || AI_ACTOR,
    source: 'AI',
  });
  await syncFromTask(task);
  emit('service:updated', { taskId });
  emit('alert:updated', { taskId });
  notify({
    title: option.type === 'TRANSFER' ? 'Part transfer requested' : 'Job rescheduled',
    message: `#${task.vehicleId}: ${option.title}. ${slot.bayName} with ${slot.technicianName} at ${slot.startLabel}.`,
    kind: 'success',
    vehicleId: task.vehicleId,
    roles: ['MANAGER', 'SERVICE_ADVISOR'],
  });
  return {
    task,
    transfer,
    option,
    slot,
    message: `${option.title}. ${slot.bayName} with ${slot.technicianName} at ${slot.startLabel}; estimated completion ${slot.endLabel}.`,
  };
}

export async function receiveTransfer(transferId, actor) {
  const transfer = await PartTransfer.findOne({ transferId });
  if (!transfer) throw ApiError.notFound(`Transfer ${transferId} not found.`);
  if (transfer.status === 'RECEIVED') return { transfer };
  transfer.status = 'RECEIVED';
  await transfer.save();
  await adjustStock(transfer.partNumber, transfer.fromStore, { quantity: -transfer.qty, reserved: -transfer.qty });
  await adjustStock(transfer.partNumber, transfer.toStore, { quantity: transfer.qty, reserved: transfer.serviceTaskId ? transfer.qty : 0 });
  if (transfer.serviceTaskId) {
    const task = await ServiceTask.findOne({ taskId: transfer.serviceTaskId });
    const line = task?.requiredParts.find((l) => l.transferId === transferId);
    if (task && line) {
      line.status = 'RECEIVED';
      task.markModified('requiredParts');
      task.history.push({ message: `${line.name} received from ${transfer.fromStore}`, actor: actor?.name });
      await task.save();
      await syncFromTask(task);
    }
  }
  await logActivity({ vehicleId: transfer.vehicleId, type: 'PART', message: `${transfer.partName} ×${transfer.qty} received (${transfer.transferId})`, actor, source: 'MANUAL' });
  emit('parts:updated', { transferId });
  emit('service:updated', { taskId: transfer.serviceTaskId });
  return { transfer };
}

export function compatibleParts(parts, model) {
  return parts.filter((p) => p.compatibleModels?.includes('*') || p.compatibleModels?.some((m) => m.toLowerCase() === String(model).toLowerCase()));
}
