import { daysBetween } from '../utils/time.js';

const CONDITION_SCORE = { GOOD: 6, FAIR: 3, POOR: 0 };
const SCORED_KEYS = ['exterior', 'interior', 'tires', 'battery', 'mechanical'];
const LABELS = { exterior: 'Exterior', interior: 'Interior', tires: 'Tyres', battery: 'Battery', mechanical: 'Mechanical', fuel: 'Fuel' };

const status = (score, max, okRatio = 0.85, warnRatio = 0.5) =>
  score >= max * okRatio ? 'ok' : score >= max * warnRatio ? 'warn' : 'bad';

/**
 * Computes a 0–100 vehicle health score from location freshness, condition,
 * photo coverage, listing completeness and open service work.
 * Works on plain objects or Mongoose documents.
 */
export function computeHealth(vehicle, now = new Date()) {
  const v = vehicle.toObject ? vehicle.toObject() : vehicle;
  const isInventory = v.ownership !== 'CUSTOMER';

  // Location (20)
  let location;
  const zone = v.location?.zone || 'LOT';
  const seenDays = v.lastSeenAt ? daysBetween(v.lastSeenAt, now) : 99;
  const seenHours = v.lastSeenAt ? (now - new Date(v.lastSeenAt)) / 3600000 : 9999;
  if (zone === 'SERVICE') location = { score: 20, max: 20, note: 'In service area' };
  else if (!v.location?.row || !v.location?.position) location = { score: 4, max: 20, note: 'No lot position recorded' };
  else if (seenHours <= 72) location = { score: 20, max: 20, note: `Verified at ${v.location.row}${v.location.position}` };
  else if (seenDays <= 7) location = { score: 13, max: 20, note: `Last scanned ${seenDays} days ago` };
  else location = { score: 5, max: 20, note: `Not scanned for ${seenDays} days` };
  location.status = status(location.score, 20);

  // Condition (30)
  let condScore = 0;
  const problems = [];
  for (const key of SCORED_KEYS) {
    const c = v.condition?.[key] || { status: 'GOOD' };
    condScore += CONDITION_SCORE[c.status] ?? 6;
    if (c.status && c.status !== 'GOOD') problems.push(`${LABELS[key]}: ${c.notes || c.status.toLowerCase()}`);
  }
  const condition = {
    score: condScore,
    max: 30,
    status: condScore >= 28 ? 'ok' : condScore >= 18 ? 'warn' : 'bad',
    note: problems.length ? problems.slice(0, 2).join('; ') : 'No open condition issues',
  };

  // Photos (15) and listing (15) — only meaningful for inventory
  let photos;
  let listing;
  if (isInventory) {
    const count = v.photos?.length ?? 0;
    const pScore = Math.round(Math.min(Math.max((count - 4) / 10, 0), 1) * 15);
    photos = { score: pScore, max: 15, status: count >= 12 ? 'ok' : count >= 8 ? 'warn' : 'bad', note: `${count} photos` };
    const lc = v.listingCompleteness ?? 0;
    const lScore = Math.round(Math.min(Math.max((lc - 40) / 55, 0), 1) * 15);
    listing = { score: lScore, max: 15, status: lc >= 85 ? 'ok' : lc >= 65 ? 'warn' : 'bad', note: `Listing ${lc}% complete` };
  } else {
    photos = { score: 15, max: 15, status: 'ok', note: 'Customer vehicle' };
    listing = { score: 15, max: 15, status: 'ok', note: 'Not listed' };
  }

  // Service (20)
  let service;
  const anyPoor = SCORED_KEYS.some((k) => v.condition?.[k]?.status === 'POOR');
  const anyFair = SCORED_KEYS.some((k) => v.condition?.[k]?.status === 'FAIR');
  if (v.status === 'INSPECTION_REQUIRED') service = { score: anyPoor ? 4 : 8, max: 20, note: 'Inspection pending' };
  else if (v.status === 'SERVICE') service = { score: anyPoor ? 6 : 12, max: 20, note: 'Service in progress' };
  else if (anyPoor) service = { score: 6, max: 20, note: 'Unresolved condition issue' };
  else if (anyFair) service = { score: 16, max: 20, note: 'Minor issue not yet scheduled' };
  else service = { score: 20, max: 20, note: 'No open service work' };
  service.status = status(service.score, 20, 0.9, 0.45);

  const breakdown = { location, condition, photos, listing, service };
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((s, b) => s + b.score, 0)));
  return { score, breakdown };
}

export function applyHealth(vehicleDoc) {
  const { score, breakdown } = computeHealth(vehicleDoc);
  vehicleDoc.healthScore = score;
  vehicleDoc.healthBreakdown = breakdown;
  return vehicleDoc;
}

export const healthBand = (score) => (score >= 85 ? 'healthy' : score >= 60 ? 'attention' : 'critical');

/** Critical = low score or any part of the vehicle in POOR condition. */
export const isCriticalVehicle = (v) => v.healthScore < 60 || Object.values(v.condition || {}).some((c) => c?.status === 'POOR');

/** Safely patches one condition entry on a Vehicle document. */
export function setCondition(vehicle, key, patch) {
  const current = (vehicle.toObject ? vehicle.toObject() : vehicle).condition?.[key] || {};
  const next = { ...current, ...patch, updatedAt: new Date() };
  if (vehicle.set) vehicle.set(`condition.${key}`, next);
  else vehicle.condition = { ...vehicle.condition, [key]: next };
  return next;
}

const STATUS_RANK = { GOOD: 0, FAIR: 1, POOR: 2 };
export const worseStatus = (a = 'GOOD', b = 'GOOD') => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a);
