import { z } from 'zod';
import mongoose from 'mongoose';
import { Vehicle, Inspection, ServiceTask, Activity, Customer } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { applyHealth, setCondition, isCriticalVehicle as isCritical } from '../services/healthService.js';
import { logActivity } from '../services/activityService.js';
import { emit } from '../services/socketService.js';
import { saveImage } from '../services/storageService.js';
import { explainVehicleAging } from '../services/analyticsService.js';
import { LOT_ROWS, LOT_POSITIONS, VEHICLE_STATUS, CONDITION_KEYS } from '../utils/constants.js';
import { daysBetween } from '../utils/time.js';
import { actorOf } from '../middleware/auth.js';

const STATUS_LABELS = { AVAILABLE: 'Available', INSPECTION_REQUIRED: 'Inspection required', SERVICE: 'In service', SOLD: 'Sold', HOLD: 'On hold' };


export const patchSchema = z.object({
  status: z.enum(VEHICLE_STATUS).optional(),
  location: z
    .object({
      row: z.string().trim().toUpperCase().regex(/^[A-F]$/, 'Row must be A–F'),
      position: z.coerce.number().int().min(1).max(LOT_POSITIONS),
    })
    .optional(),
  condition: z
    .record(z.enum(CONDITION_KEYS), z.object({ status: z.enum(['GOOD', 'FAIR', 'POOR']).optional(), notes: z.string().max(200).optional(), level: z.number().optional() }))
    .optional(),
  listingCompleteness: z.coerce.number().int().min(0).max(100).optional(),
});

async function findVehicle(id) {
  const or = [{ vehicleId: String(id).replace(/^#/, '') }];
  if (mongoose.isValidObjectId(id)) or.push({ _id: id });
  const v = await Vehicle.findOne({ $or: or });
  if (!v) throw ApiError.notFound(`Vehicle #${id} not found. Check the stock number.`);
  return v;
}

const lotSummary = (v) => ({
  _id: v._id,
  vehicleId: v.vehicleId,
  make: v.make,
  model: v.model,
  variant: v.variant,
  year: v.year,
  type: v.type,
  fuelType: v.fuelType,
  color: v.color,
  status: v.status,
  ownership: v.ownership,
  healthScore: v.healthScore,
  critical: isCritical(v),
  location: v.location,
  lastSeenAt: v.lastSeenAt,
  daysInInventory: v.stockedAt ? daysBetween(v.stockedAt) : null,
  expectedDaysToSell: v.expectedDaysToSell,
  auditRequested: v.flags?.auditRequested,
  issues: Object.entries(v.condition || {})
    .filter(([, c]) => c?.status && c.status !== 'GOOD')
    .map(([key, c]) => ({ key, status: c.status, notes: c.notes })),
});

export async function listVehicles(req, res) {
  const { status, q, ownership = 'INVENTORY', sort = '-updatedAt', health } = req.query;
  const filter = {};
  if (ownership !== 'ALL') filter.ownership = ownership;
  if (status && status !== 'ALL') filter.status = status;
  let list = await Vehicle.find(filter).lean();
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((v) => [v.vehicleId, v.make, v.model, v.variant, v.vin, v.color].some((f) => String(f || '').toLowerCase().includes(needle)));
  }
  if (health === 'critical') list = list.filter(isCritical);
  const items = list.map((v) => ({ ...lotSummary(v), listPriceINR: v.listPriceINR, photoCount: v.photos?.length || 0, listingCompleteness: v.listingCompleteness, odometerKm: v.odometerKm }));
  const key = String(sort).replace(/^-/, '');
  const dir = String(sort).startsWith('-') ? -1 : 1;
  items.sort((a, b) => {
    const av = key === 'updatedAt' ? new Date(list.find((x) => x.vehicleId === a.vehicleId)?.updatedAt) : a[key];
    const bv = key === 'updatedAt' ? new Date(list.find((x) => x.vehicleId === b.vehicleId)?.updatedAt) : b[key];
    return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
  });
  res.json({ items, total: items.length });
}

export async function lotMap(_req, res) {
  const vehicles = await Vehicle.find({ status: { $ne: 'SOLD' } }).lean();
  const sold = await Vehicle.find({ status: 'SOLD' }).lean();
  const all = [...vehicles, ...sold];
  const bySlot = new Map();
  for (const v of all) if (v.location?.row && v.location?.position && v.location.zone !== 'SERVICE') bySlot.set(`${v.location.row}${v.location.position}`, v);
  const rows = LOT_ROWS.map((row) => ({
    row,
    label: row === 'A' ? 'Front display' : row === 'F' ? 'Back row' : `Row ${row}`,
    slots: Array.from({ length: LOT_POSITIONS }, (_, i) => {
      const code = `${row}${i + 1}`;
      const v = bySlot.get(code);
      return { code, row, position: i + 1, vehicle: v ? lotSummary(v) : null };
    }),
  }));
  const serviceArea = all.filter((v) => v.location?.zone === 'SERVICE').map(lotSummary);
  const unplaced = all.filter((v) => v.location?.zone !== 'SERVICE' && (!v.location?.row || !v.location?.position)).map(lotSummary);
  const onLot = all.filter((v) => v.ownership === 'INVENTORY' && v.status !== 'SOLD');
  res.json({
    rows,
    serviceArea,
    unplaced,
    counts: {
      total: onLot.length,
      AVAILABLE: onLot.filter((v) => v.status === 'AVAILABLE').length,
      INSPECTION_REQUIRED: onLot.filter((v) => v.status === 'INSPECTION_REQUIRED').length,
      SERVICE: all.filter((v) => v.status === 'SERVICE').length,
      HOLD: onLot.filter((v) => v.status === 'HOLD').length,
      SOLD: sold.length,
      CRITICAL: onLot.filter(isCritical).length,
      emptySlots: rows.reduce((s, r) => s + r.slots.filter((x) => !x.vehicle).length, 0),
    },
  });
}

export async function getVehicle(req, res) {
  const v = await findVehicle(req.params.id);
  const [inspections, tasks, activity, customer] = await Promise.all([
    Inspection.find({ vehicleId: v.vehicleId }).sort({ createdAt: -1 }).lean(),
    ServiceTask.find({ vehicleId: v.vehicleId }).sort({ createdAt: -1 }).lean(),
    Activity.find({ vehicleId: v.vehicleId }).sort({ createdAt: -1 }).limit(40).lean(),
    Customer.findOne({ vehicleId: v.vehicleId }).lean(),
  ]);
  let aging = null;
  const json = v.toJSON();
  if (v.ownership === 'INVENTORY' && json.daysInInventory >= v.expectedDaysToSell * 0.9) {
    aging = await explainVehicleAging(v.vehicleId).catch(() => null);
  }
  res.json({
    vehicle: json,
    inspections,
    tasks,
    activity,
    customer: customer ? { name: customer.name, phone: customer.phone, relationship: customer.relationship, trackingCode: customer.trackingCode, customerCode: customer.customerCode, stage: customer.serviceStatus?.stage } : null,
    aging,
  });
}

export async function patchVehicle(req, res) {
  const v = await findVehicle(req.params.id);
  const actor = actorOf(req);
  const { status, location, condition, listingCompleteness } = req.body;
  if (location) {
    const from = v.locationLabel;
    v.location = { zone: location.row === 'A' ? 'DISPLAY' : 'LOT', row: location.row, position: location.position, updatedAt: new Date(), updatedBy: actor.name };
    v.lastSeenAt = new Date();
    v.flags.auditRequested = false;
    await logActivity({ vehicleId: v.vehicleId, type: 'LOCATION', message: `Location updated ${from} → ${location.row}${location.position}`, actor, source: 'MANUAL' });
  }
  if (status && status !== v.status) {
    const from = v.status;
    v.status = status;
    await logActivity({ vehicleId: v.vehicleId, type: 'STATUS', message: `Status changed ${STATUS_LABELS[from]} → ${STATUS_LABELS[status]}`, actor, source: 'MANUAL' });
  }
  if (condition) {
    for (const [key, patch] of Object.entries(condition)) setCondition(v, key, patch);
    await logActivity({ vehicleId: v.vehicleId, type: 'CONDITION', message: `Condition updated: ${Object.keys(condition).join(', ')}`, actor, source: 'MANUAL' });
  }
  if (listingCompleteness !== undefined) v.listingCompleteness = listingCompleteness;
  applyHealth(v);
  await v.save();
  emit('vehicle:updated', v.toJSON());
  res.json({ vehicle: v.toJSON() });
}

export async function uploadVehiclePhotos(req, res) {
  const v = await findVehicle(req.params.id);
  if (!req.files?.length) throw ApiError.badRequest('Attach at least one photo.');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const saved = [];
  for (const file of req.files) {
    const { url } = await saveImage(file, { baseUrl, folder: `lotflow/${v.vehicleId}` });
    v.photos.push({ url, label: req.body.label || 'Uploaded photo', kind: 'upload', uploadedBy: req.user.name });
    saved.push(url);
  }
  applyHealth(v);
  await v.save();
  await logActivity({ vehicleId: v.vehicleId, type: 'PHOTO', message: `${saved.length} photo${saved.length > 1 ? 's' : ''} added`, actor: actorOf(req), source: 'MANUAL' });
  emit('vehicle:updated', v.toJSON());
  res.status(201).json({ urls: saved, vehicle: v.toJSON() });
}

export async function vehicleActivity(req, res) {
  const v = await findVehicle(req.params.id);
  const items = await Activity.find({ vehicleId: v.vehicleId }).sort({ createdAt: -1 }).limit(60).lean();
  res.json({ items });
}
