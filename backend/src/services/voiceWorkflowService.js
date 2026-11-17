/**
 * Voice Lot Assistant workflow:
 *   transcript -> AI extraction -> validated preview -> (confirm) -> vehicle + inspection + alert + notifications
 */
import { Vehicle } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { computeHealth, applyHealth, setCondition, worseStatus } from './healthService.js';
import { extractObservation } from './ai/aiService.js';
import { conditionKeyForArea } from './ai/parsers.js';
import { emit } from './socketService.js';
import { logActivity } from './activityService.js';
import { openInspection, convertToServiceTask, issueSummary } from './inspectionService.js';

const SEV_TO_STATUS = { low: 'FAIR', medium: 'FAIR', high: 'POOR' };
const ACTION_STATUS = { inspection_required: 'INSPECTION_REQUIRED', service_required: 'INSPECTION_REQUIRED', hold: 'HOLD', mark_available: 'AVAILABLE', mark_sold: 'SOLD' };
export const ACTION_LABELS = {
  inspection_required: 'Inspection required',
  service_required: 'Send to service',
  location_update: 'Location update only',
  mark_available: 'Mark front-line ready',
  hold: 'Put on hold',
  mark_sold: 'Mark as sold',
  none: 'No action',
};
const STATUS_LABELS = { AVAILABLE: 'Available', INSPECTION_REQUIRED: 'Inspection required', SERVICE: 'In service', SOLD: 'Sold', HOLD: 'On hold' };
const CONDITION_LABELS = { exterior: 'Exterior', interior: 'Interior', tires: 'Tyres', fuel: 'Fuel', battery: 'Battery', mechanical: 'Mechanical' };
const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);

const locLabel = (v) => {
  if (v.location?.zone === 'SERVICE') return 'Service area';
  if (v.location?.row && v.location?.position) return `${v.location.row}${v.location.position}`;
  return 'Unassigned';
};

let knownCache = { at: 0, ids: [] };
async function knownVehicleIds() {
  if (Date.now() - knownCache.at > 60000) {
    knownCache = { at: Date.now(), ids: (await Vehicle.find({}, { vehicleId: 1 }).lean()).map((v) => v.vehicleId) };
  }
  return knownCache.ids;
}

function vehicleSummary(v) {
  return {
    _id: v._id,
    vehicleId: v.vehicleId,
    label: `${v.year} ${v.make} ${v.model}`,
    variant: v.variant,
    type: v.type,
    color: v.color,
    status: v.status,
    location: locLabel(v),
    healthScore: v.healthScore,
    ownership: v.ownership,
  };
}

function simulate(vehicle, data) {
  const v = JSON.parse(JSON.stringify(vehicle));
  if (data.location) {
    v.location = { zone: data.location.row === 'A' ? 'DISPLAY' : 'LOT', row: data.location.row, position: data.location.position };
    v.lastSeenAt = new Date().toISOString();
  }
  for (const issue of data.issues || []) {
    const key = issue.conditionKey || conditionKeyForArea(issue.area);
    const cur = v.condition?.[key] || { status: 'GOOD' };
    v.condition[key] = { ...cur, status: worseStatus(cur.status, SEV_TO_STATUS[issue.severity] || 'FAIR'), notes: `${cap(issue.area)}: ${issue.description}` };
  }
  if (ACTION_STATUS[data.action]) v.status = ACTION_STATUS[data.action];
  return v;
}

/** Validated "I understood" preview. Nothing is saved. */
export async function previewObservation(data) {
  const errors = [];
  const warnings = [];
  if (!data?.vehicleId) {
    errors.push({ code: 'NO_VEHICLE', message: 'No vehicle number was heard. Say the stock number, for example "Vehicle 2847".' });
    return { ok: false, errors, warnings, vehicle: null, changes: [], effects: [] };
  }
  const vehicle = await Vehicle.findOne({ vehicleId: data.vehicleId }).lean();
  if (!vehicle) {
    errors.push({ code: 'INVALID_VEHICLE', message: `Vehicle #${data.vehicleId} is not in this store's records. Check the stock number and try again.` });
    return { ok: false, errors, warnings, vehicle: null, changes: [], effects: [] };
  }

  const changes = [];
  if (data.location) {
    const to = `${data.location.row}${data.location.position}`;
    const from = locLabel(vehicle);
    const occupant = await Vehicle.findOne({ 'location.row': data.location.row, 'location.position': data.location.position, vehicleId: { $ne: vehicle.vehicleId } }).lean();
    if (occupant) warnings.push(`${to} is currently recorded for #${occupant.vehicleId}. That vehicle will be flagged for a location check.`);
    changes.push({ field: 'location', label: 'Location', from, to, changed: from !== to });
  }
  for (const issue of data.issues || []) {
    const key = issue.conditionKey || conditionKeyForArea(issue.area);
    const cur = vehicle.condition?.[key]?.status || 'GOOD';
    changes.push({ field: `condition.${key}`, label: cap(issue.area), group: CONDITION_LABELS[key], from: cur, to: worseStatus(cur, SEV_TO_STATUS[issue.severity] || 'FAIR'), note: issue.description, severity: issue.severity });
  }
  if (ACTION_STATUS[data.action] && ACTION_STATUS[data.action] !== vehicle.status) {
    changes.push({ field: 'status', label: 'Status', from: STATUS_LABELS[vehicle.status], to: STATUS_LABELS[ACTION_STATUS[data.action]], changed: true });
  }
  if (data.action === 'mark_available' && Object.values(vehicle.condition || {}).some((c) => c?.status === 'POOR')) {
    warnings.push('This vehicle still has an open condition issue. Marking it available will not clear that issue.');
  }
  if (vehicle.status === 'SOLD' && data.action !== 'mark_sold') warnings.push(`#${vehicle.vehicleId} is marked sold and awaiting delivery.`);
  if (vehicle.ownership === 'CUSTOMER' && data.location) warnings.push(`#${vehicle.vehicleId} is a customer vehicle in for service.`);

  const effects = ['Update the vehicle record'];
  if (data.issues?.length) effects.push(`Record ${data.issues.length} condition issue${data.issues.length > 1 ? 's' : ''}`);
  if (['inspection_required', 'service_required'].includes(data.action)) {
    effects.push('Create an inspection task');
    effects.push('Notify the service team and manager');
  }
  if (data.action === 'service_required') effects.push('Open a repair order and assign a bay');

  const health = computeHealth(simulate(vehicle, data));
  return {
    ok: true,
    errors,
    warnings,
    vehicle: vehicleSummary(vehicle),
    changes,
    effects,
    actionLabel: ACTION_LABELS[data.action],
    health: { from: vehicle.healthScore, to: health.score },
  };
}

/** Step 1 — transcript to structured observation + preview. */
export async function processTranscript(transcript) {
  const knownIds = await knownVehicleIds();
  const extraction = await extractObservation(transcript, { knownVehicleIds: knownIds });
  const preview = extraction.data ? await previewObservation(extraction.data) : { ok: false, errors: [], warnings: [] };
  const errors = [...(extraction.errors || []).map((m) => ({ code: 'EXTRACTION', message: m })), ...(preview.errors || [])];
  const hasNoVehicle = errors.some((x) => x.code === 'NO_VEHICLE');
  const filtered = errors.filter((e) => !(e.code === 'EXTRACTION' && hasNoVehicle && /vehicle number/.test(e.message)));
  const uniq = filtered.filter((e, i) => filtered.findIndex((x) => x.message === e.message) === i);
  return {
    transcript,
    parsed: extraction.data,
    highlights: extraction.highlights,
    ai: extraction.meta,
    preview: { ...preview, errors: uniq, warnings: [...(extraction.warnings || []), ...(preview.warnings || [])] },
  };
}

/** Step 2 — the associate confirmed (possibly after editing). Apply everything. */
export async function applyObservation(data, user, { transcript, photos = [], aiMeta } = {}) {
  const preview = await previewObservation(data);
  if (!preview.ok) throw ApiError.badRequest(preview.errors[0]?.message || 'Observation is incomplete.', preview.errors);

  const actor = { name: user.name, role: user.role };
  const vehicle = await Vehicle.findOne({ vehicleId: data.vehicleId });
  const now = new Date();
  const vehicleDetails = [];

  if (data.location) {
    const to = `${data.location.row}${data.location.position}`;
    const from = vehicle.locationLabel;
    const occupant = await Vehicle.findOne({ 'location.row': data.location.row, 'location.position': data.location.position, vehicleId: { $ne: vehicle.vehicleId } });
    if (occupant) {
      occupant.location = { zone: 'LOT', row: null, position: null, updatedAt: now, updatedBy: actor.name };
      occupant.flags.auditRequested = true;
      applyHealth(occupant);
      await occupant.save();
      await logActivity({ vehicleId: occupant.vehicleId, type: 'LOCATION', message: `Slot ${to} reassigned to #${vehicle.vehicleId}; location needs verification`, actor, source: 'VOICE' });
      emit('vehicle:updated', occupant.toJSON());
    }
    vehicle.location = { zone: data.location.row === 'A' ? 'DISPLAY' : 'LOT', row: data.location.row, position: data.location.position, updatedAt: now, updatedBy: actor.name };
    vehicle.flags.auditRequested = false;
    await logActivity({ vehicleId: vehicle.vehicleId, type: 'LOCATION', message: from === to ? `Location confirmed at ${to}` : `Vehicle located at ${to}${from !== 'Unassigned' ? ` (was ${from})` : ''}`, actor, source: 'VOICE' });
    vehicleDetails.push(from === to ? `Location confirmed at ${to}` : `Location ${from} → ${to}`);
  }
  vehicle.lastSeenAt = now;

  for (const issue of data.issues || []) {
    const key = issue.conditionKey || conditionKeyForArea(issue.area);
    const cur = vehicle.toObject().condition?.[key] || {};
    const note = `${cap(issue.area)}: ${issue.description}`;
    const notes = cur.status && cur.status !== 'GOOD' && cur.notes && !cur.notes.includes(note) ? `${cur.notes}; ${note}` : note;
    setCondition(vehicle, key, { status: worseStatus(cur.status, SEV_TO_STATUS[issue.severity] || 'FAIR'), notes });
    await logActivity({ vehicleId: vehicle.vehicleId, type: 'CONDITION', message: `${cap(issue.area)} ${issue.description} reported`, actor, source: 'VOICE', meta: { severity: issue.severity } });
  }
  if (data.issues?.length) vehicleDetails.push(`${data.issues.length} condition issue${data.issues.length > 1 ? 's' : ''} recorded`);

  if (data.fuelLevel != null && vehicle.fuelType !== 'EV') setCondition(vehicle, 'fuel', { level: data.fuelLevel, status: data.fuelLevel < 15 ? 'FAIR' : 'GOOD', notes: `${data.fuelLevel}% fuel` });
  if (data.batteryLevel != null && vehicle.fuelType === 'EV') {
    setCondition(vehicle, 'battery', { level: data.batteryLevel, status: data.batteryLevel < 25 ? 'FAIR' : 'GOOD', notes: `State of charge ${data.batteryLevel}%` });
  }

  if (photos.length) {
    photos.forEach((p) => vehicle.photos.push({ url: p.url, label: p.label || 'Lot walk photo', kind: 'upload', uploadedBy: actor.name }));
    await logActivity({ vehicleId: vehicle.vehicleId, type: 'PHOTO', message: `${photos.length} photo${photos.length > 1 ? 's' : ''} attached from lot walk`, actor, source: 'VOICE' });
    vehicleDetails.push(`${photos.length} photo${photos.length > 1 ? 's' : ''} attached`);
  }

  const steps = [];
  let inspection = null;
  let alert = null;
  let task = null;
  const needsInspection = ['inspection_required', 'service_required'].includes(data.action);

  if (needsInspection) {
    const r = await openInspection(vehicle, {
      issues: (data.issues || []).map((i) => ({ ...i, conditionKey: i.conditionKey || conditionKeyForArea(i.area) })),
      priority: String(data.priority || 'medium').toUpperCase(),
      source: 'VOICE',
      transcript,
      aiMeta,
      photos,
      actor,
      userId: user.id,
    });
    inspection = r.inspection;
    alert = r.alert;
    vehicleDetails.push('Status → Inspection required');
  } else if (ACTION_STATUS[data.action] && ACTION_STATUS[data.action] !== vehicle.status) {
    const from = vehicle.status;
    vehicle.status = ACTION_STATUS[data.action];
    await logActivity({ vehicleId: vehicle.vehicleId, type: 'STATUS', message: `Status changed ${STATUS_LABELS[from]} → ${STATUS_LABELS[vehicle.status]}`, actor, source: 'VOICE' });
    vehicleDetails.push(`Status → ${STATUS_LABELS[vehicle.status]}`);
  }

  applyHealth(vehicle);
  await vehicle.save();
  steps.push({ key: 'vehicle', label: 'Vehicle updated', detail: vehicleDetails.join(' · ') || 'Last-seen time refreshed' });

  if (inspection) {
    steps.push({ key: 'inspection', label: 'Inspection task created', detail: `${inspection.inspectionId} · ${inspection.priority.toLowerCase()} priority · ${issueSummary(inspection.issues)}` });
    steps.push({ key: 'notify', label: 'Service team notified', detail: alert?.recommendedAction ? `Suggested: ${alert.recommendedAction}` : 'Alert sent to the manager and service advisors' });
  }
  if (data.action === 'service_required' && inspection) {
    const r = await convertToServiceTask(inspection.inspectionId, actor, { auto: true });
    task = r.task;
    steps.push({ key: 'service', label: 'Repair order created', detail: r.message });
  }

  emit('vehicle:updated', vehicle.toJSON());
  return { vehicle: vehicle.toJSON(), inspection, alert, task, steps };
}

export const DEMO_SCRIPTS = [
  {
    id: 'hero',
    label: 'Damage + inspection',
    text: 'Vehicle 2847 is in row B position 12. There is a scratch on the front bumper and the left rear tire looks low. Send it for inspection.',
  },
  { id: 'move', label: 'Location check', text: 'Stock 1655 is parked at F7, looks good, front line ready.' },
  { id: 'ev', label: 'EV charge', text: 'Car 2650 at D3, charge is 18 percent, needs a top up.' },
  { id: 'service', label: 'Send to service', text: 'There is a dent on the driver side door of vehicle 2093 and the AC is not cooling. Send it to service.' },
];
