import { Vehicle, Inspection, ServiceTask, Alert, Activity, Dealership, PartTransfer } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { daysBetween, startOfLocalDay, DAY, MINUTE } from '../utils/time.js';
import { healthBand, applyHealth, isCriticalVehicle as isCritical } from './healthService.js';
import { explainAging, storeInsight } from './ai/aiService.js';
import { computeRecommendation, assignTask } from './dispatchService.js';
import { logActivity, AI_ACTOR } from './activityService.js';
import { emit } from './socketService.js';
import { nextSequence } from '../models/index.js';
import { LOT_POSITIONS } from '../utils/constants.js';

const SEGMENT = { SUV: 'SUVs', SEDAN: 'sedans', HATCHBACK: 'hatchbacks', MUV: 'MUVs', PICKUP: 'pickups' };
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

async function inventory() {
  const list = await Vehicle.find({ ownership: 'INVENTORY' }).lean();
  return list.map((v) => ({ ...v, daysInInventory: v.stockedAt ? daysBetween(v.stockedAt) : v.daysInInventory }));
}

export function lotAccuracyOf(vehicles) {
  const onLot = vehicles.filter((v) => v.status !== 'SOLD' && v.location?.zone !== 'SERVICE');
  if (!onLot.length) return 100;
  const verified = onLot.filter((v) => v.location?.row && v.location?.position && v.lastSeenAt && Date.now() - new Date(v.lastSeenAt).getTime() <= 4 * DAY);
  return Math.round((verified.length / onLot.length) * 1000) / 10;
}

export async function dashboard() {
  const now = new Date();
  const dayStart = startOfLocalDay(now);
  const [inv, inspectionsToday, tasks, alerts, activity] = await Promise.all([
    inventory(),
    Inspection.countDocuments({ createdAt: { $gte: dayStart } }),
    ServiceTask.find({ $or: [{ status: { $nin: ['COMPLETED', 'CANCELLED'] } }, { completedAt: { $gte: dayStart } }] }).lean(),
    Alert.find({ status: 'OPEN' }).sort({ createdAt: -1 }).lean(),
    Activity.find().sort({ createdAt: -1 }).limit(14).lean(),
  ]);
  const active = inv.filter((v) => v.status !== 'SOLD');
  const bands = { healthy: 0, attention: 0, critical: 0 };
  for (const v of active) {
    if (isCritical(v)) bands.critical += 1;
    else bands[healthBand(v.healthScore)] += 1;
  }
  const open = tasks.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status));
  const late = open.filter((t) => {
    if (t.status === 'WAITING_PARTS') return true;
    if (!t.scheduledTime) return false;
    const end = new Date(t.scheduledTime).getTime() + (t.estimatedDuration || 60) * MINUTE;
    if (t.status === 'IN_PROGRESS') return end < now.getTime();
    if (t.status === 'SCHEDULED') return new Date(t.scheduledTime).getTime() < now.getTime() - 15 * MINUTE;
    return false;
  });
  const statusCounts = active.reduce((m, v) => ({ ...m, [v.status]: (m[v.status] || 0) + 1 }), {});
  const buckets = [
    { label: '0–15 d', min: 0, max: 15 },
    { label: '16–30 d', min: 16, max: 30 },
    { label: '31–45 d', min: 31, max: 45 },
    { label: '46+ d', min: 46, max: 9999 },
  ].map((b) => ({ label: b.label, count: active.filter((v) => v.daysInInventory >= b.min && v.daysInInventory <= b.max).length }));

  const sortedAlerts = alerts.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || new Date(b.createdAt) - new Date(a.createdAt));
  return {
    generatedAt: now,
    kpis: {
      totalVehicles: active.length,
      healthy: bands.healthy,
      attention: bands.attention,
      critical: bands.critical,
      inspectionsToday,
      openInspections: await Inspection.countDocuments({ status: 'OPEN' }),
      serviceJobs: open.length,
      completedToday: tasks.filter((t) => t.status === 'COMPLETED').length,
      avgDaysInInventory: Math.round(avg(active.map((v) => v.daysInInventory)) * 10) / 10,
      lotAccuracy: lotAccuracyOf(inv),
      serviceDelayRate: open.length ? Math.round((late.length / open.length) * 100) : 0,
      serviceDelays: late.length,
      agingVehicles: active.filter((v) => v.daysInInventory > v.expectedDaysToSell).length,
      openAlerts: alerts.length,
      actionable: alerts.filter((a) => a.actionType).length,
    },
    statusCounts,
    agingBuckets: buckets,
    alerts: sortedAlerts.slice(0, 8),
    activity,
  };
}

/* ---------------- Days-to-sell explainer ---------------- */

function agingFacts(v, comps, freeFrontSlot) {
  const segment = SEGMENT[v.type] || 'vehicles';
  const photos = v.photos?.length || 0;
  const avgPhotos = avg(comps.map((c) => c.photos?.length || 0));
  const avgViews = avg(comps.map((c) => c.listing?.viewsLast7d || 0));
  const reasons = [];
  const photoGap = avgPhotos ? (avgPhotos - photos) / avgPhotos : 0;
  if (photoGap >= 0.2) {
    reasons.push({ key: 'photos', title: `${Math.round(photoGap * 100)}% fewer photos than comparable ${segment}`, detail: `${photos} photos vs ${Math.round(avgPhotos)} on average. Buyers skip listings with thin photo sets.`, weight: photoGap * 12 });
  }
  if ((v.listingCompleteness ?? 100) < 80) {
    const missing = [!v.listing?.descriptionComplete && 'description', !v.listing?.featuresComplete && 'feature list'].filter(Boolean);
    reasons.push({ key: 'listing', title: missing.includes('description') ? 'Incomplete listing description' : `Listing only ${v.listingCompleteness}% complete`, detail: `Listing is ${v.listingCompleteness}% complete${missing.length ? `; missing ${missing.join(' and ')}` : ''}.`, weight: (100 - v.listingCompleteness) / 10 });
  }
  const row = v.location?.row;
  if (row && ['E', 'F'].includes(row)) {
    reasons.push({ key: 'visibility', title: 'Low lot visibility', detail: `Parked at ${row}${v.location.position}, in the back rows where walk-in customers rarely go.`, weight: 3.5 });
  } else if (v.location?.position >= 10 && row !== 'A') {
    reasons.push({ key: 'visibility', title: 'Low lot visibility', detail: `Parked at the far end of row ${row}.`, weight: 2 });
  }
  const viewGap = avgViews ? (avgViews - (v.listing?.viewsLast7d || 0)) / avgViews : 0;
  if (viewGap >= 0.25) {
    reasons.push({ key: 'demand', title: `${Math.round(viewGap * 100)}% fewer online views than similar vehicles`, detail: `${v.listing?.viewsLast7d || 0} views in 7 days vs ${Math.round(avgViews)} for comparable ${segment}.`, weight: viewGap * 4 });
  }
  reasons.push({ key: 'market', title: 'Similar vehicles are selling faster', detail: `Comparable ${segment} sell in about ${v.expectedDaysToSell} days; this one is at ${v.daysInInventory}.`, weight: 1.5 });
  const issues = Object.entries(v.condition || {}).filter(([, c]) => c?.status && c.status !== 'GOOD');
  if (issues.length) reasons.push({ key: 'condition', title: 'Unresolved condition issue', detail: issues.map(([, c]) => c.notes).filter(Boolean).join('; '), weight: 3 });
  reasons.sort((a, b) => b.weight - a.weight);

  const recs = [];
  const has = (k) => reasons.some((r) => r.key === k);
  if (has('photos')) recs.push({ key: 'photos', title: 'Add exterior photos', detail: `Reshoot ${Math.max(6, Math.round(avgPhotos) + 2 - photos)} angles to reach a full set of ${Math.max(15, Math.round(avgPhotos) + 2)}.` });
  if (has('listing')) recs.push({ key: 'listing', title: 'Complete listing', detail: 'Add the description, feature list and service history highlights.' });
  if (has('visibility')) recs.push({ key: 'visibility', title: 'Move vehicle to front display', detail: freeFrontSlot ? `${freeFrontSlot} on the front display row is free.` : 'Swap with a fast-moving vehicle on row A.' });
  if (has('condition') || v.status === 'INSPECTION_REQUIRED') recs.push({ key: 'inspection', title: 'Schedule inspection', detail: 'Clear open condition issues so it is front-line ready.' });
  else recs.push({ key: 'inspection', title: 'Schedule inspection', detail: 'Run a quick front-line readiness check before re-featuring it.' });
  if (has('demand')) recs.push({ key: 'demand', title: 'Refresh and re-feature the listing', detail: 'Feature it in the weekly WhatsApp broadcast to recent enquiries.' });

  const ratio = v.daysInInventory / Math.max(1, v.expectedDaysToSell);
  return {
    vehicleId: v.vehicleId,
    label: `${v.year} ${v.make} ${v.model}`,
    variant: v.variant,
    segment,
    location: v.location?.row ? `${v.location.row}${v.location.position}` : 'Service area',
    daysInInventory: v.daysInInventory,
    expectedDaysToSell: v.expectedDaysToSell,
    overBy: v.daysInInventory - v.expectedDaysToSell,
    risk: ratio >= 1.35 ? 'HIGH' : ratio >= 1.1 ? 'MEDIUM' : 'LOW',
    photos,
    listingCompleteness: v.listingCompleteness,
    views: v.listing?.viewsLast7d || 0,
    reasons: reasons.map(({ weight, ...r }) => r),
    recommendations: recs.slice(0, 5),
    pricingNote: 'Recommendations focus on merchandising and visibility. Pricing is left to the manager.',
    playbookApplied: Boolean(v.flags?.merchandisingPlan),
  };
}

async function freeFrontSlot(vehicles) {
  const taken = new Set(vehicles.filter((v) => v.location?.row === 'A').map((v) => v.location.position));
  for (let p = LOT_POSITIONS; p >= 1; p -= 1) if (!taken.has(p)) return `A${p}`;
  return null;
}

export async function aging() {
  const inv = await inventory();
  const all = await Vehicle.find({ 'location.row': 'A' }).lean();
  const front = await freeFrontSlot(all);
  const active = inv.filter((v) => v.status !== 'SOLD');
  const candidates = active.filter((v) => v.daysInInventory >= v.expectedDaysToSell * 0.9).sort((a, b) => b.daysInInventory / b.expectedDaysToSell - a.daysInInventory / a.expectedDaysToSell);
  const items = candidates.map((v) => agingFacts(v, active.filter((c) => c.type === v.type && c.vehicleId !== v.vehicleId), front));
  return {
    items,
    summary: {
      aging: items.filter((i) => i.overBy > 0).length,
      highRisk: items.filter((i) => i.risk === 'HIGH').length,
      avgOverBy: Math.round(avg(items.filter((i) => i.overBy > 0).map((i) => i.overBy))),
      avgDaysInInventory: Math.round(avg(active.map((v) => v.daysInInventory))),
    },
  };
}

export async function explainVehicleAging(vehicleId) {
  const inv = await inventory();
  const v = inv.find((x) => x.vehicleId === vehicleId);
  if (!v) throw ApiError.notFound(`Vehicle #${vehicleId} not found in inventory.`);
  const all = await Vehicle.find({ 'location.row': 'A' }).lean();
  const facts = agingFacts(v, inv.filter((c) => c.type === v.type && c.vehicleId !== v.vehicleId && c.status !== 'SOLD'), await freeFrontSlot(all));
  const { summary, engine } = await explainAging({
    vehicleId: facts.vehicleId,
    vehicle: facts.label,
    segment: facts.segment,
    daysInInventory: facts.daysInInventory,
    expectedDaysToSell: facts.expectedDaysToSell,
    reasons: facts.reasons.map((r) => ({ title: r.title, detail: r.detail })),
    recommendations: facts.recommendations.map((r) => ({ title: r.title })),
  });
  return { ...facts, summary, engine };
}

/** Merchandising playbook for an aging vehicle. Never touches price. */
export async function applyAgingPlaybook(vehicleId, actor) {
  const vehicle = await Vehicle.findOne({ vehicleId });
  if (!vehicle) throw ApiError.notFound(`Vehicle #${vehicleId} not found.`);
  const done = [];
  const frontVehicles = await Vehicle.find({ 'location.row': 'A' }).lean();
  const slot = vehicle.location?.row === 'A' ? null : await freeFrontSlot(frontVehicles);
  if (slot) {
    const from = vehicle.locationLabel;
    vehicle.location = { zone: 'DISPLAY', row: 'A', position: Number(slot.slice(1)), updatedAt: new Date(), updatedBy: actor?.name || 'LotFlow AI' };
    vehicle.lastSeenAt = new Date();
    done.push(`Moved to front display ${slot}`);
    await logActivity({ vehicleId, type: 'LOCATION', message: `Moved ${from} → ${slot} (front display) for visibility`, actor: actor || AI_ACTOR, source: 'AI' });
  }
  vehicle.flags.merchandisingPlan = true;
  applyHealth(vehicle);
  await vehicle.save();

  const n = await nextSequence('task', 1000);
  const task = new ServiceTask({
    taskId: `RO-${n}`,
    vehicleId,
    vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
    issue: 'Merchandising: 15-angle photo shoot, detailing and listing completion',
    category: 'DETAILING',
    requiredSkill: 'DETAILING',
    priority: 'MEDIUM',
    status: 'UNSCHEDULED',
    estimatedDuration: 45,
    source: 'AI',
    history: [{ message: 'Created by the days-to-sell playbook', actor: actor?.name || 'LotFlow AI' }],
  });
  await task.save();
  let slotInfo = null;
  try {
    slotInfo = await assignTask(task, { actor, reason: 'aging playbook' });
    done.push(`Photo shoot and detailing booked in ${slotInfo.bayName} at ${slotInfo.startLabel} (${slotInfo.technicianName})`);
  } catch {
    done.push('Photo shoot and detailing added to the unscheduled queue');
  }
  done.push('Listing completion task assigned to the sales desk');
  await logActivity({ vehicleId, type: 'LISTING', message: 'Merchandising playbook started: photos, detailing and listing completion. Price unchanged.', actor: actor || AI_ACTOR, source: 'AI' });

  await Alert.updateMany(
    { status: 'OPEN', type: 'AGING', vehicleId },
    { $set: { status: 'RESOLVED', resolution: { by: actor?.name || 'LotFlow AI', at: new Date(), note: done.join('; ') } } },
  );
  emit('vehicle:updated', vehicle.toJSON());
  emit('service:updated', { taskId: task.taskId });
  emit('alert:updated', { vehicleId });
  return { message: `${done.join('. ')}. Price unchanged.`, steps: done, taskId: task.taskId };
}

/* ---------------- Cross-store benchmarking ---------------- */

export async function stores() {
  const d = await Dealership.findOne().lean();
  const inv = await inventory();
  const rows = (d?.stores || []).map((s) => ({
    code: s.code,
    name: s.name,
    label: s.label,
    city: s.city,
    distanceKm: s.distanceKm,
    isPrimary: s.isPrimary,
    ...s.metrics,
    ...(s.isPrimary ? { lotAccuracy: Math.round(lotAccuracyOf(inv)) } : {}),
    trend: s.trend,
  }));
  const { insight, engine } = await storeInsight(
    rows.map(({ trend, city, distanceKm, isPrimary, ...m }) => m),
  );
  const months = rows[0]?.trend?.map((t) => t.month) || [];
  const trend = months.map((month, i) => Object.fromEntries([['month', month], ...rows.map((r) => [r.label, r.trend?.[i]?.avgDays])]));
  return { stores: rows.map(({ trend: _t, ...r }) => r), trend, insight, engine };
}

/* ---------------- Sustainability ---------------- */

export async function sustainability() {
  const since = new Date(Date.now() - 30 * DAY);
  const [moves, transfers, pending, rec, d, inv] = await Promise.all([
    Activity.countDocuments({ type: 'LOCATION', createdAt: { $gte: since } }),
    PartTransfer.find({ createdAt: { $gte: since } }).lean(),
    PartTransfer.find({ status: 'REQUESTED' }).lean(),
    computeRecommendation().catch(() => null),
    Dealership.findOne().lean(),
    inventory(),
  ]);
  const primary = d?.stores?.find((s) => s.isPrimary);
  const groups = Object.values(
    pending.reduce((m, t) => {
      (m[t.fromStore] ||= { fromStore: t.fromStore, transfers: [], distanceKm: t.distanceKm }).transfers.push(t);
      return m;
    }, {}),
  );
  const storeName = (code) => d?.stores?.find((s) => s.code === code)?.name || code;
  const groupable = groups.filter((g) => g.transfers.length >= 2);
  const groupSavingKm = groupable.reduce((s, g) => s + (g.transfers.length - 1) * g.distanceKm * 2, 0);
  const transferKm = transfers.reduce((s, t) => s + (t.distanceKm || 0) * 2, 0);
  const evs = inv.filter((v) => v.fuelType === 'EV' && v.status !== 'SOLD');
  const lowCharge = evs.filter((v) => (v.condition?.battery?.level ?? 100) < 25);

  const avoidableKm = 312;
  const fuelCostPerKm = 59;
  const breakdown = [
    { key: 'movement', label: 'Vehicle movement efficiency', score: 79 },
    { key: 'bays', label: 'Service bay utilisation', score: rec && rec.ops.length ? 78 : 86 },
    { key: 'ev', label: 'EV readiness and loaners', score: lowCharge.length ? 74 : 85 },
    { key: 'logistics', label: 'Parts logistics', score: groupable.length ? 72 : 84 },
    { key: 'energy', label: 'Energy and paperless operations', score: 88 },
  ];
  const score = Math.round(avg(breakdown.map((b) => b.score)) + 1);

  const recommendations = [
    {
      key: 'movement',
      title: 'Reduce unnecessary vehicle movement',
      detail: `${moves} lot moves were logged in the last 30 days. Voice-confirmed locations remove search walks and repeat re-parking.`,
      impact: '≈140 km and ₹8,300 a month',
    },
    {
      key: 'group',
      title: 'Group vehicle and parts transfers',
      detail: groupable.length
        ? groupable.map((g) => `${g.transfers.length} pending transfers from ${storeName(g.fromStore)} (${g.transfers.map((t) => t.transferId).join(', ')}) can share one trip`).join('. ')
        : `${pending.length} transfer${pending.length === 1 ? '' : 's'} pending. Route non-urgent parts through the 11:00 and 15:30 parts runs instead of dedicated trips.`,
      impact: groupable.length ? `Saves ${groupSavingKm} km today` : '≈60 km a month',
      actionable: groupable.length > 0,
    },
    {
      key: 'ev',
      title: 'Prefer EV loaner vehicles',
      detail: `Assign the EV loaners first for customer trips under 40 km. ${lowCharge.length ? `${lowCharge.length} EV${lowCharge.length > 1 ? 's are' : ' is'} below 25% charge on the lot.` : 'All EVs on the lot are above 25% charge.'}`,
      impact: '₹6,200 a month in fuel',
    },
    {
      key: 'idle',
      title: 'Reduce service bay idle time',
      detail: rec && rec.ops.length ? `Applying today's AI schedule removes ${rec.savedMinutes} idle bay-minutes (${rec.idleBefore} → ${rec.idleAfter}).` : 'Today\'s bay schedule has no avoidable idle gaps.',
      impact: 'Lights, compressors and lifts run only when needed',
    },
  ];

  return {
    score,
    metrics: {
      avoidableMovementKm: avoidableKm,
      fuelSavingsINR: avoidableKm * fuelCostPerKm,
      idleReductionPct: 18,
      evUtilizationPct: 64,
      co2AvoidedKg: Math.round(avoidableKm * 0.17),
      transferKm30d: transferKm,
      lotMoves30d: moves,
    },
    breakdown,
    trend: (primary?.trend || []).map((t) => ({ month: t.month, score: t.greenScore })),
    recommendations,
    transferGroups: groups.map((g) => ({ fromStore: g.fromStore, storeName: storeName(g.fromStore), count: g.transfers.length, distanceKm: g.distanceKm, transfers: g.transfers.map((t) => ({ transferId: t.transferId, partName: t.partName, eta: t.eta, serviceTaskId: t.serviceTaskId })) })),
  };
}
