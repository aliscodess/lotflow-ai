import { SERVICE_STEPS } from './constants.js';

/** Builds the customer-facing step list for a given current stage. */
export function buildSteps(stage, previous = []) {
  const idx = Math.max(0, SERVICE_STEPS.findIndex((s) => s.key === stage));
  const prevAt = Object.fromEntries((previous || []).map((s) => [s.key, s.at]));
  const now = new Date();
  return SERVICE_STEPS.map((s, i) => {
    let status = 'pending';
    if (i < idx || (stage === 'READY' && i === idx)) status = 'done';
    else if (i === idx) status = 'current';
    return { key: s.key, label: s.label, status, at: status === 'pending' ? null : prevAt[s.key] || now };
  });
}

/** Derives the customer stage from a service task's state. */
export function stageFromTask(task) {
  if (!task) return 'RECEIVED';
  const lines = task.requiredParts || [];
  const short = lines.some((l) => ['SHORTAGE'].includes(l.status));
  // An inspection job with no parts identified yet is still at the inspection step.
  if (task.category === 'INSPECTION' && !lines.length && ['UNSCHEDULED', 'SCHEDULED', 'IN_PROGRESS'].includes(task.status)) return 'INSPECTED';
  switch (task.status) {
    case 'COMPLETED':
      return 'READY';
    case 'QUALITY_CHECK':
      return 'QUALITY_CHECK';
    case 'IN_PROGRESS':
      return 'IN_REPAIR';
    case 'WAITING_PARTS':
      return short ? 'PARTS_AVAILABLE' : 'REPAIR_SCHEDULED';
    case 'SCHEDULED':
      return short ? 'PARTS_AVAILABLE' : 'REPAIR_SCHEDULED';
    case 'UNSCHEDULED':
      return lines.length ? (short ? 'PARTS_AVAILABLE' : 'REPAIR_SCHEDULED') : 'INSPECTED';
    default:
      return 'RECEIVED';
  }
}

export function taskEnd(task) {
  if (!task?.scheduledTime) return null;
  return new Date(new Date(task.scheduledTime).getTime() + (task.estimatedDuration || 60) * 60000);
}
