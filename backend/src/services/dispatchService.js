/**
 * Autonomous appointment & dispatch orchestrator.
 * Rule-based list scheduler over service bays and technicians:
 *  - unavailable technician  -> find an available technician with the same skill
 *  - required part missing   -> place the job after the part can arrive (nearest store)
 *  - bay occupied / overrun  -> find the next suitable bay or shift the job
 *  - urgent issue            -> schedule first, in the earliest qualified slot
 *  - idle gaps               -> pull later jobs forward when it saves 30+ minutes
 */
import { Bay, Technician, ServiceTask, Alert, Part } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { MINUTE, DAY, roundUp, formatLocalTime, startOfLocalDay } from '../utils/time.js';
import { emit, notify } from './socketService.js';
import { logActivity, AI_ACTOR } from './activityService.js';
import { syncFromTask } from './customerService.js';
import { bestTransferOption, requestTransferForLine } from './partsService.js';

const STEP = 15; // minutes
const HORIZON = 14 * 60; // minutes ahead we are willing to schedule
const OCCUPYING = ['SCHEDULED', 'WAITING_PARTS', 'IN_PROGRESS'];
const MOVABLE = ['SCHEDULED', 'WAITING_PARTS', 'UNSCHEDULED'];
const RANK = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const LEVEL = { Senior: 0, Mid: 1, Junior: 2 };

export async function loadState() {
  const [bays, techs, tasks] = await Promise.all([
    Bay.find({ active: true }).sort({ code: 1 }).lean(),
    Technician.find().sort({ techId: 1 }).lean(),
    ServiceTask.find({ status: { $in: [...OCCUPYING, 'UNSCHEDULED', 'QUALITY_CHECK'] } }).lean(),
  ]);
  return { bays, techs, tasks };
}

/** Converts a task to a time interval. Overrunning jobs are projected to finish 15 min from now. */
export function toEntry(t, now = Date.now()) {
  const start = new Date(t.scheduledTime).getTime();
  let end = start + (t.estimatedDuration || 60) * MINUTE;
  let overrun = 0;
  if (t.status === 'IN_PROGRESS' && end < now + 5 * MINUTE) {
    overrun = Math.max(0, Math.round((now - end) / MINUTE));
    end = roundUp(new Date(now + 15 * MINUTE), STEP).getTime();
  }
  return { taskId: t.taskId, bay: t.bay, techId: t.technician ? String(t.technician) : null, start, end, status: t.status, priority: t.priority, overrun };
}

function conflicts(entries, { bay, techId, start, end, ignore }) {
  return entries.some(
    (e) => e.taskId !== ignore && ((bay && e.bay === bay) || (techId && e.techId === techId)) && e.start < end && start < e.end,
  );
}

function loadMap(entries) {
  const load = new Map();
  for (const e of entries) if (e.techId) load.set(e.techId, (load.get(e.techId) || 0) + (e.end - e.start) / MINUTE);
  return load;
}

function qualifiedTechs(techs, skill, load, preferTechId) {
  let list = techs.filter((t) => t.status !== 'OFF' && t.skills?.includes(skill));
  if (!list.length) list = techs.filter((t) => t.status !== 'OFF' && t.skills?.includes('GENERAL'));
  return list.sort(
    (a, b) =>
      (String(a._id) === preferTechId ? -1 : String(b._id) === preferTechId ? 1 : 0) ||
      (load.get(String(a._id)) || 0) - (load.get(String(b._id)) || 0) ||
      LEVEL[a.level] - LEVEL[b.level],
  );
}

function compatibleBays(bays, skill, preferBay) {
  let list = bays.filter((b) => b.capabilities?.includes(skill));
  if (!list.length) list = bays.filter((b) => b.capabilities?.includes('GENERAL'));
  return list.sort(
    (a, b) => (a.code === preferBay ? -1 : b.code === preferBay ? 1 : 0) || a.capabilities.length - b.capabilities.length || a.code.localeCompare(b.code),
  );
}

/** Earliest (bay, technician, start) where both are free for the whole duration. */
export function findSlot(entries, { skill = 'GENERAL', duration = 60, earliest, preferBay, preferTechId, bays, techs, ignore, now = Date.now() }) {
  const load = loadMap(entries);
  const bayList = compatibleBays(bays, skill, preferBay);
  const techList = qualifiedTechs(techs, skill, load, preferTechId);
  if (!bayList.length || !techList.length) return null;
  let t = roundUp(new Date(Math.max(earliest || 0, now)), STEP).getTime();
  const limit = Math.max(now + HORIZON * MINUTE, t + HORIZON * MINUTE);
  for (; t <= limit; t += STEP * MINUTE) {
    const end = t + duration * MINUTE;
    for (const bay of bayList) {
      if (conflicts(entries, { bay: bay.code, start: t, end, ignore })) continue;
      const tech = techList.find((tc) => !conflicts(entries, { techId: String(tc._id), start: t, end, ignore }));
      if (tech) return { bay: bay.code, bayName: bay.name, bayType: bay.type, tech, start: t, end };
    }
  }
  return null;
}

const blockedByParts = (task) => (task.requiredParts || []).some((l) => l.status === 'SHORTAGE');

function slotSummary(slot) {
  return {
    bay: slot.bay,
    bayName: slot.bayName,
    technicianId: String(slot.tech._id),
    technicianName: slot.tech.name,
    start: new Date(slot.start),
    end: new Date(slot.end),
    startLabel: formatLocalTime(slot.start),
    endLabel: formatLocalTime(slot.end),
  };
}

/** Preview the slot a new job would get, without saving anything. */
export async function previewSlot({ skill = 'GENERAL', duration = 60, earliest, preferBay, ignoreTaskId } = {}) {
  const now = Date.now();
  const { bays, techs, tasks } = await loadState();
  const entries = tasks.filter((t) => OCCUPYING.includes(t.status) && t.bay && t.scheduledTime && t.taskId !== ignoreTaskId).map((t) => toEntry(t, now));
  const slot = findSlot(entries, { skill, duration, earliest: earliest ? new Date(earliest).getTime() : now, preferBay, bays, techs, now, ignore: ignoreTaskId });
  return slot ? slotSummary(slot) : null;
}

/** Assigns bay + technician + start time to a task document and saves it. */
export async function assignTask(task, { earliest, preferBay, keepTech = false, actor, reason } = {}) {
  const now = Date.now();
  const { bays, techs, tasks } = await loadState();
  const entries = tasks.filter((t) => OCCUPYING.includes(t.status) && t.bay && t.scheduledTime && t.taskId !== task.taskId).map((t) => toEntry(t, now));
  const offTech = techs.find((t) => String(t._id) === String(task.technician) && t.status === 'OFF');
  const slot = findSlot(entries, {
    skill: task.requiredSkill || 'GENERAL',
    duration: task.estimatedDuration || 60,
    earliest: earliest ? new Date(earliest).getTime() : now,
    preferBay: preferBay ?? task.bay,
    preferTechId: keepTech && !offTech && task.technician ? String(task.technician) : null,
    bays,
    techs,
    now,
    ignore: task.taskId,
  });
  if (!slot) throw ApiError.conflict('No qualified bay and technician are free in the next 14 hours for this job.');

  const previous = { bay: task.bay, scheduledTime: task.scheduledTime, technicianName: task.technicianName };
  task.bay = slot.bay;
  task.technician = slot.tech._id;
  task.technicianName = slot.tech.name;
  task.scheduledTime = new Date(slot.start);
  if (['UNSCHEDULED', 'WAITING_PARTS', 'SCHEDULED'].includes(task.status)) task.status = blockedByParts(task) ? 'WAITING_PARTS' : 'SCHEDULED';
  const summary = slotSummary(slot);
  task.history.push({ message: `Scheduled in ${summary.bayName} with ${summary.technicianName} at ${summary.startLabel}${reason ? ` — ${reason}` : ''}`, actor: actor?.name || 'LotFlow AI' });
  await task.save();
  emit('service:updated', { taskId: task.taskId });
  return { ...summary, previous };
}

export async function reassignTechnician(taskId, actor) {
  const task = await ServiceTask.findOne({ taskId });
  if (!task) throw ApiError.notFound(`Repair order ${taskId} not found.`);
  const now = Date.now();
  const { techs, tasks } = await loadState();
  const entries = tasks.filter((t) => OCCUPYING.includes(t.status) && t.bay && t.scheduledTime && t.taskId !== taskId).map((t) => toEntry(t, now));
  const from = task.technicianName || 'Unassigned';
  if (task.scheduledTime && task.bay) {
    const start = new Date(task.scheduledTime).getTime();
    const end = start + (task.estimatedDuration || 60) * MINUTE;
    const candidate = qualifiedTechs(techs, task.requiredSkill || 'GENERAL', loadMap(entries)).find(
      (tc) => String(tc._id) !== String(task.technician) && !conflicts(entries, { techId: String(tc._id), start, end }),
    );
    if (candidate) {
      task.technician = candidate._id;
      task.technicianName = candidate.name;
      task.history.push({ message: `Technician changed ${from} → ${candidate.name}`, actor: actor?.name || 'LotFlow AI' });
      await task.save();
      await logActivity({ vehicleId: task.vehicleId, type: 'SCHEDULE', message: `${task.taskId} reassigned from ${from} to ${candidate.name}`, actor: actor || AI_ACTOR, source: 'AI' });
      emit('service:updated', { taskId });
      return { task, from, to: candidate.name, message: `${task.taskId} reassigned to ${candidate.name} at ${formatLocalTime(start)}` };
    }
  }
  const slot = await assignTask(task, { actor, reason: `${from} unavailable` });
  await syncFromTask(task);
  await logActivity({ vehicleId: task.vehicleId, type: 'SCHEDULE', message: `${task.taskId} moved to ${slot.bayName} with ${slot.technicianName} at ${slot.startLabel}`, actor: actor || AI_ACTOR, source: 'AI' });
  return { task, from, to: slot.technicianName, message: `${task.taskId} rescheduled to ${slot.startLabel} with ${slot.technicianName}` };
}

/** Earliest moment all required parts can be on hand (null if ready now). */
async function partsReadyAt(task, now) {
  let readyAt = null;
  let reason = null;
  let shortageLine = null;
  for (const line of task.requiredParts || []) {
    let eta = null;
    if (['TRANSFER_REQUESTED', 'IN_TRANSIT', 'ORDERED'].includes(line.status)) eta = line.eta ? new Date(line.eta).getTime() : now + 120 * MINUTE;
    if (line.status === 'SHORTAGE') {
      const opt = await bestTransferOption(line.partNumber, line.qty, task.storeCode || 'S1');
      if (opt) eta = opt.eta.getTime();
      else {
        const part = await Part.findOne({ partNumber: line.partNumber }).lean();
        eta = now + (part?.leadTimeDays || 3) * DAY;
      }
      shortageLine = { ...line, option: opt };
    }
    if (eta && (!readyAt || eta > readyAt)) {
      readyAt = eta;
      reason = `${line.name || line.partNumber} arrives ${formatLocalTime(eta)}`;
    }
  }
  return { readyAt, reason, shortageLine };
}

export function idleMinutes(entries, bays, now = Date.now()) {
  let idle = 0;
  const horizonEnd = now + HORIZON * MINUTE;
  for (const bay of bays) {
    const list = entries.filter((e) => e.bay === bay.code && e.end > now && e.start < horizonEnd).sort((a, b) => a.start - b.start);
    let cursor = now;
    for (const e of list) {
      const s = Math.max(e.start, now);
      if (s > cursor) idle += s - cursor;
      cursor = Math.max(cursor, e.end);
    }
  }
  return Math.round(idle / MINUTE);
}

/** Builds an optimised schedule and the list of changes needed to get there. */
export async function computeRecommendation() {
  const now = Date.now();
  const { bays, techs, tasks } = await loadState();
  const techById = new Map(techs.map((t) => [String(t._id), t]));
  const bayName = (code) => bays.find((b) => b.code === code)?.name || 'Unassigned';

  const fixed = tasks.filter((t) => t.status === 'IN_PROGRESS' && t.bay && t.scheduledTime).map((t) => toEntry(t, now));
  const movable = tasks.filter((t) => MOVABLE.includes(t.status));
  const originalEntries = [...fixed, ...movable.filter((t) => t.bay && t.scheduledTime && t.status !== 'UNSCHEDULED').map((t) => toEntry(t, now))];
  const idleBefore = idleMinutes(originalEntries, bays, now);

  const readiness = new Map();
  for (const t of movable) readiness.set(t.taskId, await partsReadyAt(t, now));

  const queue = [...movable].sort((a, b) => {
    const ua = a.priority === 'URGENT' ? 0 : 1;
    const ub = b.priority === 'URGENT' ? 0 : 1;
    const ta = a.scheduledTime && a.status !== 'UNSCHEDULED' ? new Date(a.scheduledTime).getTime() : Infinity;
    const tb = b.scheduledTime && b.status !== 'UNSCHEDULED' ? new Date(b.scheduledTime).getTime() : Infinity;
    return ua - ub || ta - tb || RANK[b.priority] - RANK[a.priority];
  });

  const placed = [...fixed];
  const plan = [];
  for (const t of queue) {
    const ready = readiness.get(t.taskId);
    const earliest = Math.max(now, ready.readyAt || 0);
    const tech = t.technician ? techById.get(String(t.technician)) : null;
    const techOff = tech?.status === 'OFF';
    const hadSlot = t.bay && t.scheduledTime && t.status !== 'UNSCHEDULED';
    const duration = t.estimatedDuration || 60;

    const best = findSlot(placed, {
      skill: t.requiredSkill || 'GENERAL',
      duration,
      earliest,
      preferBay: t.bay,
      preferTechId: tech && !techOff ? String(tech._id) : null,
      bays,
      techs,
      now,
      ignore: t.taskId,
    });

    let choice = best;
    if (hadSlot) {
      const start = new Date(t.scheduledTime).getTime();
      const end = start + duration * MINUTE;
      const origFeasible =
        start >= earliest - MINUTE &&
        !techOff &&
        !conflicts(placed, { bay: t.bay, start, end, ignore: t.taskId }) &&
        (!tech || !conflicts(placed, { techId: String(tech._id), start, end, ignore: t.taskId }));
      if (origFeasible && (!best || start - best.start < 30 * MINUTE)) {
        choice = { bay: t.bay, bayName: bayName(t.bay), tech, start, end, kept: true };
      }
    }
    if (!choice) continue;
    placed.push({ taskId: t.taskId, bay: choice.bay, techId: String(choice.tech._id), start: choice.start, end: choice.end, status: t.status, priority: t.priority });
    plan.push({ task: t, choice, ready, techOff });
  }

  const ops = [];
  for (const { task: t, choice, ready, techOff } of plan) {
    if (choice.kept) continue;
    const origStart = t.scheduledTime && t.status !== 'UNSCHEDULED' ? new Date(t.scheduledTime).getTime() : null;
    const timeChanged = origStart === null || Math.abs(choice.start - origStart) >= 15 * MINUTE;
    const bayChanged = (t.bay || null) !== choice.bay && origStart !== null;
    const techChanged = String(t.technician || '') !== String(choice.tech._id);
    if (origStart !== null && !timeChanged && !bayChanged && !techChanged) continue;

    const vid = t.vehicleId;
    const op = {
      taskId: t.taskId,
      vehicleId: vid,
      vehicleLabel: t.vehicleLabel,
      issue: t.issue,
      priority: t.priority,
      changes: {},
      apply: { bay: choice.bay, technicianId: String(choice.tech._id), technicianName: choice.tech.name, scheduledTime: new Date(choice.start) },
      transfer: ready.shortageLine?.option ? { partNumber: ready.shortageLine.partNumber, fromStore: ready.shortageLine.option.fromStore } : null,
    };
    if (origStart !== null && timeChanged) op.changes.time = { from: formatLocalTime(origStart), to: formatLocalTime(choice.start) };
    if (bayChanged) op.changes.bay = { from: bayName(t.bay), to: choice.bayName };
    if (techChanged) op.changes.technician = { from: t.technicianName || 'Unassigned', to: choice.tech.name };

    if (origStart === null) {
      op.kind = t.priority === 'URGENT' || t.priority === 'HIGH' ? 'PRIORITIZE' : 'SCHEDULE';
      op.title = `Schedule #${vid} in ${choice.bayName} at ${formatLocalTime(choice.start)}`;
      op.reason = t.priority === 'URGENT' ? 'Urgent issue — placed in the first free qualified bay' : 'Unscheduled job fits an open slot';
      op.changes.time = { from: 'Unscheduled', to: formatLocalTime(choice.start) };
    } else if (bayChanged) {
      op.kind = 'MOVE_BAY';
      op.title = `Move Vehicle #${vid} from ${bayName(t.bay)} → ${choice.bayName}`;
    } else if (timeChanged) {
      op.kind = 'RESCHEDULE';
      op.title = `Move Vehicle #${vid} from ${formatLocalTime(origStart)} → ${formatLocalTime(choice.start)}`;
    } else {
      op.kind = 'REASSIGN_TECH';
      op.title = `Reassign #${vid} from ${t.technicianName || 'Unassigned'} → ${choice.tech.name}`;
    }
    if (!op.reason) {
      if (ready.readyAt && origStart !== null && choice.start > origStart) op.reason = `Waiting on parts: ${ready.reason}`;
      else if (techOff) op.reason = `${t.technicianName} is unavailable today`;
      else if (origStart !== null && choice.start > origStart) op.reason = `${bayName(t.bay)} is running late — shifted to avoid overlap`;
      else if (origStart !== null && choice.start < origStart) op.reason = `Fills idle time in ${choice.bayName}; customer gets the car ${Math.round((origStart - choice.start) / MINUTE)} min sooner`;
      else op.reason = 'Balances technician workload';
    }
    if (techOff && !op.changes.technician) op.changes.technician = { from: t.technicianName, to: choice.tech.name };
    ops.push(op);
  }

  const kindOrder = { PRIORITIZE: 0, REASSIGN_TECH: 1, RESCHEDULE: 2, MOVE_BAY: 3, SCHEDULE: 4 };
  ops.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || RANK[b.priority] - RANK[a.priority]);

  const idleAfter = idleMinutes(placed, bays, now);
  return {
    generatedAt: new Date(now),
    ops,
    idleBefore,
    idleAfter: ops.length ? Math.min(idleAfter, idleBefore) : idleBefore,
    savedMinutes: ops.length ? Math.max(0, idleBefore - idleAfter) : 0,
    summary: ops.length
      ? `${ops.length} change${ops.length > 1 ? 's' : ''} recommended. Expected idle time ${idleBefore} min → ${Math.min(idleAfter, idleBefore)} min.`
      : 'The schedule is already optimal. No changes recommended.',
  };
}

export async function applyRecommendation(actor) {
  const rec = await computeRecommendation();
  const applied = [];
  for (const op of rec.ops) {
    const task = await ServiceTask.findOne({ taskId: op.taskId });
    if (!task || !MOVABLE.includes(task.status)) continue;
    if (op.transfer) {
      const line = task.requiredParts.find((l) => l.partNumber === op.transfer.partNumber && l.status === 'SHORTAGE');
      if (line) await requestTransferForLine(task, line, { strategy: 'TRANSFER', actor });
    }
    task.bay = op.apply.bay;
    task.technician = op.apply.technicianId;
    task.technicianName = op.apply.technicianName;
    task.scheduledTime = op.apply.scheduledTime;
    if (['UNSCHEDULED', 'WAITING_PARTS', 'SCHEDULED'].includes(task.status)) task.status = blockedByParts(task) ? 'WAITING_PARTS' : 'SCHEDULED';
    task.history.push({ message: `${op.title} (${op.reason})`, actor: actor?.name || 'LotFlow AI' });
    await task.save();
    await syncFromTask(task);
    await logActivity({ vehicleId: task.vehicleId, type: 'SCHEDULE', message: `${op.title} — ${op.reason}`, actor: actor || AI_ACTOR, source: 'AI' });
    applied.push(op);
  }

  const taskIds = applied.map((o) => o.taskId);
  if (taskIds.length) {
    await Alert.updateMany(
      { status: 'OPEN', type: { $in: ['SCHEDULING', 'URGENT_REPAIR', 'PARTS_SHORTAGE'] }, 'payload.taskId': { $in: taskIds } },
      { $set: { status: 'RESOLVED', resolution: { by: actor?.name || 'LotFlow AI', at: new Date(), note: 'Resolved by applying the AI schedule' } } },
    );
  }
  emit('service:updated', { applied: taskIds });
  emit('alert:updated', { bulk: true });
  notify({
    title: 'Schedule optimised',
    message: `${applied.length} change${applied.length === 1 ? '' : 's'} applied. Idle time ${rec.idleBefore} → ${rec.idleAfter} min.`,
    kind: 'success',
    roles: ['MANAGER', 'SERVICE_ADVISOR'],
  });
  return { ...rec, applied, appliedCount: applied.length };
}

/** Everything the Service page needs in one call. */
export async function getBoard() {
  const now = Date.now();
  const { bays, techs, tasks } = await loadState();
  const dayStart = startOfLocalDay(new Date(now));
  const completedToday = await ServiceTask.find({ status: 'COMPLETED', completedAt: { $gte: dayStart } }).lean();
  const occupying = tasks.filter((t) => OCCUPYING.includes(t.status) && t.bay && t.scheduledTime);
  const entries = occupying.map((t) => ({ ...toEntry(t, now), task: t }));

  const bayCards = bays.map((b) => {
    const mine = entries.filter((e) => e.bay === b.code).sort((x, y) => x.start - y.start);
    const current = mine.find((e) => e.status === 'IN_PROGRESS') || mine.find((e) => e.start <= now && e.end > now);
    const next = mine.find((e) => e.start > now && e !== current);
    const busy = mine.reduce((s, e) => s + Math.max(0, Math.min(e.end, now + 8 * 60 * MINUTE) - Math.max(e.start, now)), 0);
    let status = 'AVAILABLE';
    if (current) status = current.status === 'IN_PROGRESS' ? 'OCCUPIED' : current.status === 'WAITING_PARTS' ? 'BLOCKED' : 'RESERVED';
    else if (next && next.start - now <= 30 * MINUTE) status = 'RESERVED';
    const view = (e) =>
      !e ? null : {
        taskId: e.task.taskId,
        vehicleId: e.task.vehicleId,
        vehicleLabel: e.task.vehicleLabel,
        issue: e.task.issue,
        status: e.task.status,
        priority: e.task.priority,
        technicianName: e.task.technicianName,
        start: new Date(e.start),
        end: new Date(e.end),
        overrun: e.overrun,
        progress: e.status === 'IN_PROGRESS' ? Math.min(99, Math.round(((now - e.start) / (e.end - e.start)) * 100)) : 0,
      };
    return { code: b.code, name: b.name, type: b.type, capabilities: b.capabilities, status, current: view(current), next: view(next), utilization: Math.round((busy / (8 * 60 * MINUTE)) * 100) };
  });

  const technicians = techs.map((t) => {
    const mine = entries.filter((e) => e.techId === String(t._id));
    const current = mine.find((e) => e.status === 'IN_PROGRESS' || (e.start <= now && e.end > now));
    const assigned = mine.reduce((s, e) => s + Math.max(0, e.end - Math.max(e.start, now)), 0) / MINUTE;
    const done = completedToday.filter((c) => String(c.technician) === String(t._id)).reduce((s, c) => s + (c.estimatedDuration || 0), 0);
    return {
      _id: t._id,
      techId: t.techId,
      name: t.name,
      level: t.level,
      skills: t.skills,
      status: t.status === 'OFF' ? 'OFF' : current ? 'BUSY' : 'AVAILABLE',
      statusNote: t.statusNote,
      currentTask: current ? { taskId: current.task.taskId, vehicleId: current.task.vehicleId, bay: current.task.bay } : null,
      assignedMinutes: Math.round(assigned),
      completedMinutes: done,
      capacityMinutes: 540,
      jobs: mine.length,
    };
  });

  const windowStart = roundUp(new Date(now - 2 * 60 * MINUTE), 30).getTime();
  const windowEnd = windowStart + 10 * 60 * MINUTE;
  const timeline = entries
    .filter((e) => e.end > windowStart && e.start < windowEnd)
    .map((e) => ({
      taskId: e.task.taskId,
      vehicleId: e.task.vehicleId,
      bay: e.bay,
      issue: e.task.issue,
      status: e.task.status,
      priority: e.task.priority,
      technicianName: e.task.technicianName,
      start: new Date(e.start),
      end: new Date(e.end),
      overrun: e.overrun,
    }));
  const completedTimeline = completedToday
    .filter((c) => c.bay && c.scheduledTime)
    .map((c) => ({ taskId: c.taskId, vehicleId: c.vehicleId, bay: c.bay, issue: c.issue, status: 'COMPLETED', priority: c.priority, technicianName: c.technicianName, start: c.scheduledTime, end: c.completedAt || new Date(new Date(c.scheduledTime).getTime() + c.estimatedDuration * MINUTE) }))
    .filter((c) => new Date(c.end).getTime() > windowStart);

  return {
    now: new Date(now),
    window: { start: new Date(windowStart), end: new Date(windowEnd) },
    bays: bayCards,
    technicians,
    timeline: [...completedTimeline, ...timeline],
    unscheduled: tasks.filter((t) => t.status === 'UNSCHEDULED'),
    waitingParts: tasks.filter((t) => t.status === 'WAITING_PARTS'),
    qualityCheck: tasks.filter((t) => t.status === 'QUALITY_CHECK'),
    stats: {
      inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
      scheduled: tasks.filter((t) => t.status === 'SCHEDULED').length,
      waitingParts: tasks.filter((t) => t.status === 'WAITING_PARTS').length,
      unscheduled: tasks.filter((t) => t.status === 'UNSCHEDULED').length,
      completedToday: completedToday.length,
      overrunning: entries.filter((e) => e.overrun > 0).length,
      techniciansAvailable: technicians.filter((t) => t.status === 'AVAILABLE').length,
      techniciansOff: technicians.filter((t) => t.status === 'OFF').length,
    },
  };
}
