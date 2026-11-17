import {
  User,
  Dealership,
  Vehicle,
  Inspection,
  ServiceTask,
  Technician,
  Bay,
  Part,
  PartTransfer,
  Alert,
  Customer,
  Activity,
  Counter,
} from '../models/index.js';
import { STORES, MODELS, COLORS, PHOTO_ANGLES, TECHNICIANS, BAYS, PARTS, CUSTOMERS, USERS, DEMO_PASSWORD } from './catalog.js';
import { computeHealth } from '../services/healthService.js';
import { buildSteps, stageFromTask, taskEnd } from '../utils/serviceSteps.js';
import { addMinutes, roundDown, DAY, HOUR, MINUTE } from '../utils/time.js';
import { LOT_ROWS, LOT_POSITIONS } from '../utils/constants.js';

// Small deterministic PRNG so every seed produces the same lot.
function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

export async function seedDatabase({ log = () => {} } = {}) {
  const rand = mulberry32(2847);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (min, max) => Math.round(min + rand() * (max - min));
  const chance = (p) => rand() < p;

  const now = new Date();
  const T0 = roundDown(now, 15);
  const at = (min) => addMinutes(T0, min);
  const ago = (days = 0, hours = 0, minutes = 0) => new Date(now.getTime() - days * DAY - hours * HOUR - minutes * MINUTE);

  log('Clearing collections...');
  await Promise.all(
    [Dealership, Vehicle, Inspection, ServiceTask, Technician, Bay, Part, PartTransfer, Alert, Customer, Activity, Counter].map((M) =>
      M.deleteMany({}),
    ),
  );

  /* ---------------- Dealership & users ---------------- */
  const dealership = await Dealership.create({
    name: 'Tekion Demo Motors',
    location: { city: 'Bengaluru', state: 'Karnataka', address: 'ITPL Main Road, Whitefield, Bengaluru 560066' },
    stores: STORES,
  });

  // Upsert demo users (keeps their ids so open sessions survive a demo reset).
  for (const u of USERS) {
    let user = await User.findOne({ email: u.email }).select('+password');
    if (!user) user = new User({ ...u, password: DEMO_PASSWORD });
    user.set({ name: u.name, role: u.role, title: u.title, dealershipId: dealership._id, storeCode: 'S1' });
    if (!user.password || !(await user.comparePassword(DEMO_PASSWORD))) user.password = DEMO_PASSWORD;
    await user.save();
  }
  log(`Users: ${USERS.length}`);

  /* ---------------- Technicians, bays, parts ---------------- */
  const techs = await Technician.insertMany(
    TECHNICIANS.map((t) => ({ ...t, phone: `+91 9${between(100000000, 999999999)}`, storeCode: 'S1' })),
  );
  const tech = Object.fromEntries(techs.map((t) => [t.name.split(' ')[0], t]));
  await Bay.insertMany(BAYS.map((b) => ({ ...b, storeCode: 'S1' })));
  await Part.insertMany(
    PARTS.map(({ stock, ...part }) => ({
      ...part,
      inventoryByStore: ['S1', 'S2', 'S3'].map((code, i) => ({
        storeCode: code,
        quantity: stock[i],
        reserved: 0,
        reorderLevel: Math.max(1, Math.round(stock[i] / 4)),
        bin: `${code}-${['A', 'B', 'C', 'D'][i % 4]}${between(10, 48)}`,
      })),
    })),
  );
  log(`Technicians: ${techs.length}, bays: ${BAYS.length}, parts: ${PARTS.length}`);

  /* ---------------- Vehicles ---------------- */
  const modelByName = (name) => MODELS.find((m) => m.model === name);
  const vin = (wmi) => {
    let s = wmi;
    while (s.length < 17) s += VIN_CHARS[Math.floor(rand() * VIN_CHARS.length)];
    return s;
  };
  const photos = (n) =>
    Array.from({ length: n }, (_, i) => ({ url: null, label: PHOTO_ANGLES[i % PHOTO_ANGLES.length], kind: 'placeholder', createdAt: ago(between(1, 20)) }));
  const goodCondition = (fuelType) => ({
    exterior: { status: 'GOOD', notes: '' },
    interior: { status: 'GOOD', notes: '' },
    tires: { status: 'GOOD', notes: '' },
    fuel: fuelType === 'EV' ? { status: 'GOOD', notes: 'EV', level: between(55, 92) } : { status: 'GOOD', notes: '', level: between(25, 80) },
    battery: { status: 'GOOD', notes: fuelType === 'EV' ? '' : '12.6 V', level: fuelType === 'EV' ? between(55, 92) : 12.6 },
    mechanical: { status: 'GOOD', notes: '' },
  });

  const vehicles = [];
  const used = new Set();
  const occupied = new Set(['B12', 'A11', 'A12']); // kept free for the demo + front display moves

  const make = (spec) => {
    const m = modelByName(spec.model);
    const fuelType = spec.fuelType || m.fuelType;
    const condition = goodCondition(fuelType);
    for (const [key, val] of Object.entries(spec.condition || {})) condition[key] = { ...condition[key], ...val, updatedAt: ago(spec.issueDaysAgo ?? 1) };
    const isNew = (spec.year ?? 2024) >= 2024;
    const v = {
      vehicleId: spec.vehicleId,
      vin: vin(m.wmi),
      make: spec.make || m.make,
      model: spec.model,
      variant: spec.variant || m.variant,
      year: spec.year ?? 2024,
      type: spec.type || m.type,
      fuelType,
      transmission: spec.transmission || (rand() > 0.3 ? 'Automatic' : 'Manual'),
      color: spec.color || pick(COLORS),
      odometerKm: spec.odometerKm ?? (isNew ? between(8, 60) : between(9000, 46000)),
      listPriceINR: spec.listPriceINR ?? Math.round((m.price * (isNew ? 1 : 0.78 - (2024 - (spec.year ?? 2024)) * 0.06)) / 1000) * 1000,
      ownership: spec.ownership || 'INVENTORY',
      storeCode: 'S1',
      location: spec.zone === 'SERVICE'
        ? { zone: 'SERVICE', updatedAt: ago(0, 3), updatedBy: 'Service reception' }
        : { zone: spec.row === 'A' ? 'DISPLAY' : 'LOT', row: spec.row, position: spec.position, updatedAt: ago(spec.seenDays ?? 0, spec.seenHours ?? 8), updatedBy: 'Ravi Kumar' },
      lastSeenAt: ago(spec.seenDays ?? 0, spec.seenHours ?? 8),
      status: spec.status || 'AVAILABLE',
      condition,
      photos: photos(spec.photos ?? 14),
      stockedAt: spec.ownership === 'CUSTOMER' ? undefined : ago(spec.stockedDays ?? 10, 4),
      expectedDaysToSell: spec.expected ?? m.expected,
      listingCompleteness: spec.listing ?? 92,
      listing: {
        descriptionComplete: (spec.listing ?? 92) >= 75,
        featuresComplete: (spec.listing ?? 92) >= 65,
        viewsLast7d: spec.views ?? between(80, 170),
        leadsLast7d: spec.leads ?? between(2, 9),
      },
      inspectionHistory: [],
      serviceHistory: [],
    };
    if (spec.row) occupied.add(`${spec.row}${spec.position}`);
    used.add(spec.vehicleId);
    vehicles.push(v);
    return v;
  };

  // Hero and storyline vehicles
  make({ vehicleId: '2847', model: 'XUV700', year: 2024, color: 'Midnight Black', row: 'A', position: 4, status: 'HOLD', photos: 14, listing: 92, stockedDays: 18, seenHours: 20, views: 154, leads: 11 });
  make({ vehicleId: '1732', model: 'City', year: 2023, color: 'Moonlight Silver', row: 'F', position: 9, photos: 8, listing: 58, stockedDays: 47, expected: 32, views: 41, leads: 1, odometerKm: 18400 });
  make({ vehicleId: '2093', model: 'Slavia', year: 2023, color: 'Titan Grey', row: 'E', position: 11, photos: 10, listing: 72, stockedDays: 44, expected: 36, views: 63, leads: 2, odometerKm: 21150 });
  make({ vehicleId: '1921', model: 'Harrier', year: 2023, color: 'Pearl White', row: 'C', position: 5, status: 'INSPECTION_REQUIRED', photos: 13, listing: 88, stockedDays: 12, seenHours: 0, odometerKm: 14820,
    condition: { exterior: { status: 'FAIR', notes: 'Rear bumper: scuff marks' }, tires: { status: 'FAIR', notes: 'Front right tyre: sidewall wear' } }, issueDaysAgo: 0 });
  make({ vehicleId: '2391', model: 'Seltos', year: 2024, color: 'Fiery Red', row: 'A', position: 2, status: 'SERVICE', photos: 16, listing: 95, stockedDays: 9, seenHours: 2,
    condition: { mechanical: { status: 'POOR', notes: 'Brake warning light on after test drive' } } });
  make({ vehicleId: '2650', model: 'Punch EV', year: 2024, color: 'Deep Ocean Blue', row: 'D', position: 3, photos: 12, listing: 90, stockedDays: 21, seenHours: 30,
    condition: { battery: { status: 'FAIR', notes: 'State of charge 18%', level: 18 }, fuel: { status: 'FAIR', notes: 'EV — 18% charge', level: 18 } } });
  make({ vehicleId: '1655', model: 'Baleno', year: 2023, color: 'Polar White', row: 'F', position: 7, photos: 13, listing: 86, stockedDays: 26, seenDays: 9, odometerKm: 11200 });
  make({ vehicleId: '2102', model: 'Scorpio-N', year: 2022, color: 'Graphite Grey', row: 'E', position: 4, status: 'INSPECTION_REQUIRED', photos: 8, listing: 70, stockedDays: 15, odometerKm: 32600,
    condition: { exterior: { status: 'POOR', notes: 'Rear quarter panel dent; windshield chip' } } });
  make({ vehicleId: '1599', model: 'ZS EV', year: 2023, color: 'Pearl White', row: 'F', position: 2, photos: 7, listing: 64, stockedDays: 52, expected: 42, views: 38, leads: 1, odometerKm: 9800,
    condition: { battery: { status: 'POOR', notes: '12V auxiliary battery weak (11.6 V)', level: 11.6 } } });
  make({ vehicleId: '2188', model: 'i20', year: 2024, color: 'Polar White', zone: 'SERVICE', status: 'SERVICE', photos: 15, listing: 94, stockedDays: 6 });

  // Customer vehicles currently in the service area
  const customerVehicle = (vehicleId, model, year, color, extra = {}) =>
    make({ vehicleId, model, year, color, zone: 'SERVICE', status: 'SERVICE', ownership: 'CUSTOMER', photos: 4, listing: 0, ...extra });
  customerVehicle('1932', 'Verna', 2021, 'Titan Grey', { odometerKm: 38900 });
  customerVehicle('1544', 'Seltos', 2022, 'Graphite Grey', { odometerKm: 41200, condition: { mechanical: { status: 'FAIR', notes: 'Front brake discs scored' } } });
  customerVehicle('1777', 'Innova Hycross', 2023, 'Polar White', { odometerKm: 40150 });
  customerVehicle('1690', 'Swift', 2020, 'Fiery Red', { odometerKm: 52300, condition: { exterior: { status: 'POOR', notes: 'Rear bumper dent' } } });
  customerVehicle('2210', 'Nexon EV', 2023, 'Deep Ocean Blue', { odometerKm: 27600, condition: { battery: { status: 'FAIR', notes: 'Range drop reported by owner', level: 64 } } });
  customerVehicle('1803', 'i20', 2022, 'Moonlight Silver', { odometerKm: 30210, condition: { tires: { status: 'FAIR', notes: 'Uneven tread wear' } } });
  customerVehicle('1488', 'Creta', 2021, 'Polar White', { odometerKm: 46780, condition: { interior: { status: 'POOR', notes: 'AC not cooling' } } });
  customerVehicle('1610', 'Sonet', 2022, 'Forest Green', { odometerKm: 35540, condition: { mechanical: { status: 'FAIR', notes: 'Clutch judder in first gear' } } });

  // Generated inventory to fill the lot
  const FAIR_ISSUES = [
    ['exterior', 'Light scratch on rear door'],
    ['exterior', 'Minor scuff on front bumper'],
    ['tires', 'Front left tyre pressure low'],
    ['interior', 'Mild stain on rear seat'],
    ['exterior', 'Stone chip on bonnet'],
    ['battery', '12V battery at 12.1 V'],
    ['mechanical', 'Brake squeal at low speed'],
    ['exterior', 'Alloy wheel curb rash'],
  ];
  const POOR_ISSUES = [
    ['exterior', 'Cracked tail lamp'],
    ['mechanical', 'Coolant leak suspected'],
    ['tires', 'Rear right tyre puncture'],
  ];
  const freeSlots = [];
  for (const row of LOT_ROWS) for (let pos = 1; pos <= LOT_POSITIONS; pos += 1) if (!occupied.has(`${row}${pos}`)) freeSlots.push([row, pos]);
  // shuffle deterministically
  for (let i = freeSlots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [freeSlots[i], freeSlots[j]] = [freeSlots[j], freeSlots[i]];
  }

  const GENERATED = 46;
  const generated = [];
  for (let i = 0; i < GENERATED; i += 1) {
    let id;
    do id = String(between(1400, 2999));
    while (used.has(id));
    const m = pick(MODELS);
    const [row, position] = freeSlots[i];
    const year = chance(0.6) ? 2024 : chance(0.6) ? 2023 : pick([2021, 2022]);
    const r = rand();
    const spec = {
      vehicleId: id,
      model: m.model,
      year,
      row,
      position,
      photos: r < 0.8 ? between(12, 20) : r < 0.95 ? between(8, 11) : between(5, 7),
      listing: chance(0.75) ? between(85, 100) : chance(0.8) ? between(70, 84) : between(60, 69),
      stockedDays: chance(0.9) ? between(2, Math.max(4, m.expected - 4)) : between(m.expected + 2, m.expected + 12),
      seenHours: chance(0.88) ? between(1, 60) : undefined,
      seenDays: undefined,
    };
    if (spec.seenHours === undefined) spec.seenDays = between(4, 6);
    const c = rand();
    if (c < 0.05) {
      const [key, notes] = pick(POOR_ISSUES);
      spec.condition = { [key]: { status: 'POOR', notes } };
      spec.status = 'INSPECTION_REQUIRED';
    } else if (c < 0.22) {
      const [key, notes] = pick(FAIR_ISSUES);
      spec.condition = { [key]: { status: 'FAIR', notes } };
      if (chance(0.4)) spec.status = 'INSPECTION_REQUIRED';
    }
    generated.push(make(spec));
  }
  // A few sold-awaiting-delivery and holds
  generated.filter((v) => v.status === 'AVAILABLE').slice(0, 3).forEach((v) => { v.status = 'SOLD'; });
  generated.filter((v) => v.status === 'AVAILABLE').slice(5, 7).forEach((v) => { v.status = 'HOLD'; });

  for (const v of vehicles) {
    const { score, breakdown } = computeHealth(v, now);
    v.healthScore = score;
    v.healthBreakdown = breakdown;
  }

  /* ---------------- Customers ---------------- */
  const vehicleById = Object.fromEntries(vehicles.map((v) => [v.vehicleId, v]));
  const label = (v) => `${v.year} ${v.make} ${v.model}`;
  const customers = await Customer.insertMany(
    CUSTOMERS.map((c) => ({ ...c, vehicleLabel: label(vehicleById[c.vehicleId]), advisorName: 'Neha Iyer' })),
  );
  const customerByVehicle = Object.fromEntries(customers.map((c) => [c.vehicleId, c]));
  vehicleById['2847'].reservedFor = customerByVehicle['2847']._id;
  vehicleById['2188'].reservedFor = customerByVehicle['2188']._id;

  /* ---------------- Service tasks ---------------- */
  const recon = generated.filter((v) => v.status === 'AVAILABLE');
  const completedDefs = [
    ['Pre-sale detailing', 'DETAILING', 'DETAILING', 'Suresh', 'BAY-3', -390, 60],
    ['Pre-delivery inspection checklist', 'INSPECTION', 'INSPECTION', 'Meera', 'BAY-3', -320, 45],
    ['Engine oil & filter change', 'MAINTENANCE', 'GENERAL', 'Rahul', 'BAY-1', -300, 50],
    ['Tyre rotation', 'TIRES', 'TIRES', 'Karthik', 'BAY-3', -250, 40],
    ['Wheel alignment', 'TIRES', 'TIRES', 'Karthik', 'BAY-3', -200, 40],
    ['12V battery replacement', 'REPAIR', 'ELECTRICAL', 'Deepak', 'BAY-2', -230, 35],
  ];
  const tasks = [];
  let seq = 1000;
  const task = (def) => {
    seq += 1;
    const t = { taskId: `RO-${seq}`, storeCode: 'S1', history: [{ at: ago(0, 6), message: 'Repair order opened', actor: 'Neha Iyer' }], ...def };
    if (def.techKey) {
      t.technician = tech[def.techKey]._id;
      t.technicianName = tech[def.techKey].name;
      delete t.techKey;
    }
    const v = vehicleById[t.vehicleId];
    t.vehicleLabel = label(v);
    if (customerByVehicle[t.vehicleId]) t.customer = customerByVehicle[t.vehicleId]._id;
    tasks.push(t);
    return t;
  };

  completedDefs.forEach(([issue, category, skill, techKey, bay, start, dur], i) => {
    const v = recon[i + 4];
    task({ vehicleId: v.vehicleId, issue, category, requiredSkill: skill, techKey, bay, priority: 'LOW', status: 'COMPLETED', estimatedDuration: dur, scheduledTime: at(start), startedAt: at(start), completedAt: at(start + dur), source: 'MANUAL' });
    v.serviceHistory.push({ refId: `RO-${seq}`, date: at(start + dur), summary: issue, status: 'COMPLETED' });
  });

  task({ vehicleId: '1544', issue: 'Front brake disc & pad replacement', category: 'REPAIR', requiredSkill: 'BRAKES', techKey: 'Rahul', bay: 'BAY-1', priority: 'MEDIUM', status: 'IN_PROGRESS', estimatedDuration: 90, scheduledTime: at(-45), startedAt: at(-45), source: 'CUSTOMER',
    requiredParts: [{ partNumber: 'KI-SEL-BDF', name: 'Front brake disc (pair)', qty: 1, status: 'RESERVED', sourceStore: 'S1' }, { partNumber: 'HY-CRE-BPF', name: 'Front brake pad set', qty: 1, status: 'RESERVED', sourceStore: 'S1' }] });
  task({ vehicleId: '1777', issue: '40,000 km periodic service', category: 'MAINTENANCE', requiredSkill: 'GENERAL', techKey: 'Karthik', bay: 'BAY-2', priority: 'MEDIUM', status: 'IN_PROGRESS', estimatedDuration: 105, scheduledTime: at(-140), startedAt: at(-140), source: 'CUSTOMER',
    requiredParts: [{ partNumber: 'GEN-OIL-0W20', name: 'Engine oil 0W-20 hybrid (1 L)', qty: 4, status: 'RESERVED', sourceStore: 'S1' }, { partNumber: 'TY-INV-OILF', name: 'Oil filter — Innova Hycross', qty: 1, status: 'RESERVED', sourceStore: 'S1' }] });
  task({ vehicleId: '1803', issue: 'Tyre rotation & wheel balancing', category: 'TIRES', requiredSkill: 'TIRES', techKey: 'Meera', bay: 'BAY-3', priority: 'LOW', status: 'IN_PROGRESS', estimatedDuration: 40, scheduledTime: at(-15), startedAt: at(-15), source: 'CUSTOMER' });
  task({ vehicleId: '1690', issue: 'Rear bumper dent repair & repaint', category: 'BODY', requiredSkill: 'BODY', techKey: 'Imran', bay: 'BAY-5', priority: 'MEDIUM', status: 'IN_PROGRESS', estimatedDuration: 180, scheduledTime: at(-60), startedAt: at(-60), source: 'CUSTOMER',
    requiredParts: [{ partNumber: 'BDY-BMP-CLIP', name: 'Bumper retainer clip set', qty: 1, status: 'RESERVED', sourceStore: 'S1' }] });
  task({ vehicleId: '2188', issue: 'Pre-delivery inspection & detailing', category: 'RECON', requiredSkill: 'INSPECTION', techKey: 'Suresh', bay: null, priority: 'MEDIUM', status: 'QUALITY_CHECK', estimatedDuration: 90, scheduledTime: at(-120), startedAt: at(-120), source: 'MANUAL' });
  task({ vehicleId: '2210', issue: 'HV battery health check & software update', category: 'EV', requiredSkill: 'EV', techKey: 'Ananya', bay: 'BAY-4', priority: 'MEDIUM', status: 'SCHEDULED', estimatedDuration: 60, scheduledTime: at(30), source: 'CUSTOMER' });
  task({ vehicleId: '1932', issue: 'Periodic service + AC performance check', category: 'MAINTENANCE', requiredSkill: 'GENERAL', techKey: 'Vikram', bay: 'BAY-2', priority: 'MEDIUM', status: 'SCHEDULED', estimatedDuration: 45, scheduledTime: at(75), source: 'CUSTOMER',
    requiredParts: [{ partNumber: 'GEN-OIL-5W30', name: 'Engine oil 5W-30 synthetic (1 L)', qty: 4, status: 'RESERVED', sourceStore: 'S1' }, { partNumber: 'GEN-OFL-HY', name: 'Oil filter', qty: 1, status: 'RESERVED', sourceStore: 'S1' }] });
  task({ vehicleId: '1488', issue: 'AC compressor replacement', category: 'REPAIR', requiredSkill: 'AC', techKey: 'Deepak', bay: 'BAY-1', priority: 'HIGH', status: 'WAITING_PARTS', estimatedDuration: 120, scheduledTime: at(60), source: 'CUSTOMER',
    requiredParts: [{ partNumber: 'HY-CRE-ACC', name: 'AC compressor assembly', qty: 1, status: 'SHORTAGE' }] });
  task({ vehicleId: '1610', issue: 'Clutch judder diagnosis & suspension check', category: 'REPAIR', requiredSkill: 'GENERAL', techKey: 'Rahul', bay: 'BAY-1', priority: 'MEDIUM', status: 'SCHEDULED', estimatedDuration: 60, scheduledTime: at(210), source: 'CUSTOMER' });
  task({ vehicleId: '2391', issue: 'Brake warning light — diagnose & repair', description: 'Warning light came on during a customer test drive. Vehicle pulled from test-drive rotation.', category: 'REPAIR', requiredSkill: 'BRAKES', priority: 'URGENT', status: 'UNSCHEDULED', estimatedDuration: 60, source: 'INSPECTION', inspectionId: 'INS-1000' });
  task({ vehicleId: recon[0].vehicleId, issue: 'Front-line ready detailing', category: 'DETAILING', requiredSkill: 'DETAILING', priority: 'LOW', status: 'UNSCHEDULED', estimatedDuration: 45, source: 'MANUAL' });
  task({ vehicleId: '1599', issue: '12V auxiliary battery replacement', category: 'EV', requiredSkill: 'EV', techKey: 'Priya', bay: 'BAY-4', priority: 'MEDIUM', status: 'SCHEDULED', estimatedDuration: 45, scheduledTime: at(120), source: 'INSPECTION',
    requiredParts: [{ partNumber: 'BAT-AMR-45', name: '12V battery 45Ah', qty: 1, status: 'RESERVED', sourceStore: 'S1' }] });
  task({ vehicleId: recon[1].vehicleId, issue: 'Windshield chip repair', category: 'BODY', requiredSkill: 'BODY', techKey: 'Arjun', bay: 'BAY-5', priority: 'LOW', status: 'SCHEDULED', estimatedDuration: 60, scheduledTime: at(200), source: 'MANUAL' });
  task({ vehicleId: recon[2].vehicleId, issue: 'Wheel alignment after tyre replacement', category: 'TIRES', requiredSkill: 'TIRES', techKey: 'Karthik', bay: 'BAY-3', priority: 'LOW', status: 'SCHEDULED', estimatedDuration: 45, scheduledTime: at(150), source: 'MANUAL' });

  // Reserve stock for lines already marked RESERVED
  const reservations = {};
  for (const t of tasks) for (const l of t.requiredParts || []) if (l.status === 'RESERVED') reservations[l.partNumber] = (reservations[l.partNumber] || 0) + l.qty;
  for (const [partNumber, qty] of Object.entries(reservations)) {
    const doc = await Part.findOne({ partNumber });
    const inv = doc?.inventoryByStore.find((i) => i.storeCode === 'S1');
    if (inv) {
      inv.reserved = (inv.reserved || 0) + qty;
      inv.quantity = Math.max(inv.quantity, inv.reserved);
      doc.markModified('inventoryByStore');
      await doc.save();
    }
  }

  // Link customers to their active tasks + derive status
  for (const c of customers) {
    const t = tasks.find((x) => x.vehicleId === c.vehicleId && x.status !== 'COMPLETED');
    let stage = 'RECEIVED';
    if (c.vehicleId === '2847') stage = 'INSPECTED';
    else if (t) stage = stageFromTask(t);
    c.serviceTaskId = t?.taskId;
    c.serviceStatus = {
      stage,
      steps: buildSteps(stage),
      estimatedCompletion: t ? taskEnd(t) || at(240) : at(24 * 60),
      advisorNote: c.vehicleId === '2847' ? 'Pre-delivery inspection and detailing before handover.' : '',
      updatedAt: ago(0, 1),
    };
    c.notifications = [{ channel: 'SMS', message: `Hi ${c.name.split(' ')[0]}, we have received your ${c.vehicleLabel}. Track live status: lotflow.app/track/${c.trackingCode}`, at: ago(0, 4) }];
    await c.save();
  }

  await ServiceTask.insertMany(tasks);
  for (const t of tasks.filter((x) => x.status !== 'COMPLETED')) {
    vehicleById[t.vehicleId].serviceHistory.push({ refId: t.taskId, date: t.scheduledTime || now, summary: t.issue, status: t.status });
  }

  /* ---------------- Inspections ---------------- */
  const reporter = { name: 'Ravi Kumar', role: 'LOT_ASSOCIATE' };
  const inspections = [
    {
      inspectionId: 'INS-1000', vehicleId: '2391', vehicleLabel: label(vehicleById['2391']), reportedBy: { name: 'Neha Iyer', role: 'SERVICE_ADVISOR' },
      issues: [{ area: 'brakes', description: 'Brake warning light on after test drive', severity: 'high', conditionKey: 'mechanical' }],
      status: 'CONVERTED', priority: 'URGENT', source: 'MANUAL', serviceTaskId: 'RO-1016', createdAt: ago(0, 0, 40),
    },
    {
      inspectionId: 'INS-1001', vehicleId: '1921', vehicleLabel: label(vehicleById['1921']), reportedBy: reporter,
      issues: [
        { area: 'rear bumper', description: 'scuff marks', severity: 'low', conditionKey: 'exterior' },
        { area: 'front right tyre', description: 'sidewall wear', severity: 'medium', conditionKey: 'tires' },
      ],
      status: 'OPEN', priority: 'MEDIUM', source: 'VOICE', transcript: 'Vehicle 1921 is in row C position 5. Scuff marks on the rear bumper and the front right tyre sidewall looks worn. Needs inspection.',
      aiMeta: { provider: 'lotflow-nlu', confidence: 0.94, mode: 'demo' }, createdAt: ago(0, 0, 5),
    },
    {
      inspectionId: 'INS-1002', vehicleId: '2102', vehicleLabel: label(vehicleById['2102']), reportedBy: reporter,
      issues: [
        { area: 'rear quarter panel', description: 'dent', severity: 'medium', conditionKey: 'exterior' },
        { area: 'windshield', description: 'chip in driver line of sight', severity: 'high', conditionKey: 'exterior' },
      ],
      status: 'OPEN', priority: 'HIGH', source: 'MANUAL', createdAt: ago(1, 2),
    },
  ];
  await Inspection.insertMany(inspections);
  for (const i of inspections) vehicleById[i.vehicleId].inspectionHistory.push({ refId: i.inspectionId, date: i.createdAt, summary: i.issues.map((x) => `${x.area}: ${x.description}`).join('; '), status: i.status });

  await Vehicle.insertMany(vehicles);
  log(`Vehicles: ${vehicles.length} (${vehicles.filter((v) => v.ownership === 'INVENTORY').length} inventory)`);
  log(`Service tasks: ${tasks.length}, inspections: ${inspections.length}, customers: ${customers.length}`);

  /* ---------------- Part transfers (history) ---------------- */
  await PartTransfer.insertMany([
    { transferId: 'TR-501', partNumber: 'TY-BS-2356018', partName: 'Tyre 235/60 R18 (Bridgestone Alenza)', qty: 2, fromStore: 'S3', toStore: 'S1', distanceKm: 12, etaMinutes: 120, eta: ago(6), status: 'RECEIVED', requestedBy: 'Neha Iyer', createdAt: ago(6, 2) },
    { transferId: 'TR-502', partNumber: 'GEN-WPR-24', partName: 'Wiper blade set 24"/16"', qty: 4, fromStore: 'S1', toStore: 'S2', distanceKm: 9, etaMinutes: 105, eta: ago(3), status: 'RECEIVED', requestedBy: 'Neha Iyer', createdAt: ago(3, 2) },
    { transferId: 'TR-503', partNumber: 'BAT-AMR-65', partName: '12V battery 65Ah', qty: 1, fromStore: 'S3', toStore: 'S1', distanceKm: 12, etaMinutes: 120, eta: at(150), status: 'REQUESTED', requestedBy: 'Parts desk (stock replenishment)', createdAt: ago(0, 1) },
  ]);

  /* ---------------- Alerts ---------------- */
  const SA = ['MANAGER', 'SERVICE_ADVISOR'];
  await Alert.insertMany([
    {
      type: 'AGING', priority: 'HIGH', title: 'Vehicle #1732 is aging', vehicleId: '1732',
      description: '47 days in inventory against an expected 32 days for comparable sedans.',
      reason: 'Listing is 58% complete, it has 40% fewer photos than comparable sedans, and it is parked in back row F.',
      recommendedAction: 'Run the merchandising playbook: move it to the front display, reshoot photos and complete the listing.',
      expectedImpact: 'Typically sells 9–12 days faster. Price is not changed.',
      actionType: 'AGING_PLAYBOOK', actionLabel: 'Apply playbook', payload: { vehicleId: '1732' },
      details: { daysInInventory: 47, expected: 32, reasons: ['incomplete listing', 'poor photo coverage', 'low lot visibility'] },
      createdAt: ago(0, 2),
    },
    {
      type: 'PARTS_SHORTAGE', priority: 'HIGH', title: 'Parts shortage: AC compressor for #1488', vehicleId: '1488',
      description: 'RO-1014 (Hyundai Creta) is waiting on HY-CRE-ACC. Whitefield: 0, Koramangala: 3, Hebbal: 0.',
      reason: 'Local stock is out; the job is holding Bay 1 while it waits.',
      recommendedAction: 'Transfer 1 unit from Store B (Koramangala, 9 km). Estimated arrival in about 1 h 45 min.',
      expectedImpact: 'Customer gets the car back today instead of waiting 4 days for an OEM order.',
      actionType: 'RESOLVE_PARTS_SHORTAGE', actionLabel: 'Resolve shortage', payload: { taskId: 'RO-1014', partNumber: 'HY-CRE-ACC' },
      details: { stores: [{ code: 'S1', name: 'Whitefield', qty: 0 }, { code: 'S2', name: 'Koramangala', qty: 3 }, { code: 'S3', name: 'Hebbal', qty: 0 }] }, audience: SA, createdAt: ago(0, 1, 20),
    },
    {
      type: 'SCHEDULING', priority: 'MEDIUM', title: 'Technician unavailable for #1932', vehicleId: '1932',
      description: 'Vikram Singh is on leave today but is assigned to RO-1013 (Hyundai Verna periodic service).',
      reason: 'Assigned technician is marked off for the day.',
      recommendedAction: 'Reassign RO-1013 to the next available technician with matching skills.',
      expectedImpact: 'Avoids a 45-minute customer delay.',
      actionType: 'REASSIGN_TECHNICIAN', actionLabel: 'Reassign', payload: { taskId: 'RO-1013' }, audience: SA, createdAt: ago(0, 1, 5),
    },
    {
      type: 'URGENT_REPAIR', priority: 'CRITICAL', title: 'Brake warning on test-drive vehicle #2391', vehicleId: '2391',
      description: 'Reported after a customer test drive. The car has been pulled from test-drive rotation.',
      reason: 'Safety-related fault on a customer-facing vehicle.',
      recommendedAction: 'Schedule urgent brake diagnosis in the next free bay.',
      expectedImpact: 'Removes a safety risk and returns a test-drive car to rotation today.',
      actionType: 'SCHEDULE_URGENT', actionLabel: 'Schedule now', payload: { taskId: 'RO-1016' }, audience: SA, createdAt: ago(0, 0, 38),
    },
    {
      type: 'BATTERY', priority: 'MEDIUM', title: 'EV #2650 is at 18% charge', vehicleId: '2650',
      description: 'Tata Punch EV parked at D3 for 21 days. State of charge has dropped to 18%.',
      reason: 'Long dwell time without charging degrades the HV battery and fails test drives.',
      recommendedAction: 'Schedule a top-up charge to 80% in the EV bay.',
      expectedImpact: 'Protects battery health and keeps the car test-drive ready.',
      actionType: 'SCHEDULE_CHARGE', actionLabel: 'Schedule charge', payload: { vehicleId: '2650' }, audience: SA, createdAt: ago(0, 3),
    },
    {
      type: 'LOT_ACCURACY', priority: 'MEDIUM', title: 'Vehicle #1655 not scanned for 9 days', vehicleId: '1655',
      description: 'Last recorded at F7. Vehicles that go unverified pull lot accuracy down.',
      reason: 'No location confirmation since the last lot walk.',
      recommendedAction: 'Send a locate request to the lot associate on shift.',
      expectedImpact: 'Lot accuracy +1.8 points.',
      actionType: 'LOT_AUDIT', actionLabel: 'Send locate request', payload: { vehicleId: '1655' }, audience: ['MANAGER', 'LOT_ASSOCIATE'], createdAt: ago(0, 5),
    },
    {
      type: 'SERVICE_DELAY', priority: 'HIGH', title: 'RO-1008 is running 35 min over', vehicleId: '1777',
      description: 'Toyota Innova Hycross #1777, 40,000 km service. Customer Farhan Sheikh has not been updated.',
      reason: 'Job exceeded its estimated duration and the customer ETA is stale.',
      recommendedAction: 'Send a revised ETA to the customer.',
      expectedImpact: 'Prevents an unannounced delay, a common cause of low CSAT.',
      actionType: 'NOTIFY_CUSTOMER', actionLabel: 'Send update', payload: { taskId: 'RO-1008' }, audience: SA, createdAt: ago(0, 0, 25),
    },
    {
      type: 'INSPECTION', priority: 'HIGH', title: 'Vehicle #2391 requires inspection', vehicleId: '2391', status: 'RESOLVED',
      description: 'Brake warning reported after test drive.', recommendedAction: 'Create repair order', resolution: { by: 'Neha Iyer', at: ago(0, 0, 39), note: 'RO-1016 created' },
      createdAt: ago(0, 0, 40),
    },
    {
      type: 'LOT_ACCURACY', priority: 'LOW', title: 'Vehicle #2034 location mismatch', status: 'RESOLVED',
      description: 'Scanned at D9, recorded at D8.', resolution: { by: 'Ravi Kumar', at: ago(1, 3), note: 'Location corrected to D9' }, createdAt: ago(1, 5),
    },
  ]);

  /* ---------------- Activity ---------------- */
  const acts = [
    { vehicleId: '2847', type: 'STOCK', message: 'Stocked from Mahindra Chakan plant', actor: { name: 'Inventory desk', role: 'SYSTEM' }, source: 'SYSTEM', createdAt: ago(18, 4) },
    { vehicleId: '2847', type: 'CUSTOMER', message: 'Booking received from Rohan Mehta (₹50,000)', actor: { name: 'Sales desk', role: 'SYSTEM' }, source: 'SYSTEM', createdAt: ago(3, 2) },
    { vehicleId: '2847', type: 'STATUS', message: 'Status set to Hold — reserved for delivery', actor: { name: 'Ananya Krishnan', role: 'MANAGER' }, source: 'MANUAL', createdAt: ago(3, 1) },
    { vehicleId: '2847', type: 'LOCATION', message: 'Vehicle located at A4', actor: reporter, source: 'VOICE', createdAt: ago(0, 20) },
    { vehicleId: '1921', type: 'LOCATION', message: 'Vehicle located at C5', actor: reporter, source: 'VOICE', createdAt: ago(0, 0, 5) },
    { vehicleId: '1921', type: 'INSPECTION', message: 'Inspection INS-1001 created: rear bumper scuff, front right tyre wear', actor: reporter, source: 'VOICE', createdAt: ago(0, 0, 5) },
    { vehicleId: '2650', type: 'LOCATION', message: 'Location updated to D3', actor: reporter, source: 'VOICE', createdAt: ago(0, 0, 42) },
    { vehicleId: '2391', type: 'INSPECTION', message: 'Brake warning reported after test drive', actor: { name: 'Neha Iyer', role: 'SERVICE_ADVISOR' }, source: 'MANUAL', createdAt: ago(0, 0, 40) },
    { vehicleId: '2391', type: 'SERVICE', message: 'Repair order RO-1016 opened (urgent)', actor: { name: 'Neha Iyer', role: 'SERVICE_ADVISOR' }, source: 'MANUAL', createdAt: ago(0, 0, 39) },
    { vehicleId: '1732', type: 'ALERT', message: 'Aging risk flagged: 47 days vs 32 expected', actor: { name: 'LotFlow AI', role: 'SYSTEM' }, source: 'AI', createdAt: ago(0, 2) },
    { vehicleId: '1488', type: 'PART', message: 'AC compressor unavailable locally — job waiting on parts', actor: { name: 'LotFlow AI', role: 'SYSTEM' }, source: 'AI', createdAt: ago(0, 1, 20) },
    { vehicleId: '1655', type: 'LOCATION', message: 'Vehicle located at F7', actor: reporter, source: 'VOICE', createdAt: ago(9, 1) },
  ];
  // Historical lot moves for movement analytics
  const storyline = new Set(['2847', '1732', '1921', '2391', '2650', '1655', '2102', '1599']);
  const lotVehicles = vehicles.filter((v) => v.location.zone !== 'SERVICE' && !storyline.has(v.vehicleId) && v.stockedAt);
  for (let i = 0; i < 36; i += 1) {
    const v = pick(lotVehicles);
    const stockedDaysAgo = Math.max(2, Math.floor((now - v.stockedAt) / DAY));
    acts.push({ vehicleId: v.vehicleId, type: 'LOCATION', message: `Moved to ${v.location.row}${v.location.position}`, actor: reporter, source: chance(0.6) ? 'VOICE' : 'MANUAL', createdAt: ago(between(1, Math.min(29, stockedDaysAgo - 1)), between(0, 10)) });
  }
  await Activity.insertMany(acts);

  /* ---------------- Counters ---------------- */
  await Counter.insertMany([
    { _id: 'inspection', seq: 2 }, // next INS-1003
    { _id: 'task', seq: seq - 1000 }, // next RO-1021
    { _id: 'transfer', seq: 3 }, // next TR-504
  ]);

  log('Seed complete.');
  return { vehicles: vehicles.length, tasks: tasks.length, customers: customers.length };
}
