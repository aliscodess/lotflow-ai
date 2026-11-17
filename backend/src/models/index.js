import mongoose from 'mongoose';

export { User } from './User.js';
export { Dealership } from './Dealership.js';
export { Vehicle } from './Vehicle.js';
export { Inspection } from './Inspection.js';
export { ServiceTask } from './ServiceTask.js';

const clean = {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
};

/* ---------------- Technician ---------------- */
const technicianSchema = new mongoose.Schema(
  {
    techId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    level: { type: String, enum: ['Senior', 'Mid', 'Junior'], default: 'Mid' },
    skills: [String],
    status: { type: String, enum: ['AVAILABLE', 'BUSY', 'OFF'], default: 'AVAILABLE' },
    statusNote: String,
    shiftStart: { type: String, default: '09:00' },
    shiftEnd: { type: String, default: '18:30' },
    storeCode: { type: String, default: 'S1' },
    phone: String,
    rating: Number,
  },
  { timestamps: true },
);
technicianSchema.set('toJSON', clean);
export const Technician = mongoose.model('Technician', technicianSchema);

/* ---------------- Bay ---------------- */
const baySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: String,
    type: { type: String, enum: ['GENERAL', 'QUICK', 'EV', 'BODY'], default: 'GENERAL' },
    capabilities: [String],
    storeCode: { type: String, default: 'S1' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
baySchema.set('toJSON', clean);
export const Bay = mongoose.model('Bay', baySchema);

/* ---------------- Part ---------------- */
const partSchema = new mongoose.Schema(
  {
    partNumber: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: String,
    brand: String,
    compatibleModels: [String],
    unitPriceINR: Number,
    leadTimeDays: { type: Number, default: 2 },
    inventoryByStore: [
      {
        storeCode: String,
        quantity: { type: Number, default: 0 },
        reserved: { type: Number, default: 0 },
        reorderLevel: { type: Number, default: 2 },
        bin: String,
        _id: false,
      },
    ],
  },
  { timestamps: true },
);
partSchema.set('toJSON', clean);
export const Part = mongoose.model('Part', partSchema);

/* ---------------- PartTransfer ---------------- */
const partTransferSchema = new mongoose.Schema(
  {
    transferId: { type: String, required: true, unique: true },
    partNumber: String,
    partName: String,
    qty: Number,
    fromStore: String,
    toStore: String,
    distanceKm: Number,
    etaMinutes: Number,
    eta: Date,
    serviceTaskId: String,
    vehicleId: String,
    status: { type: String, enum: ['REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'], default: 'REQUESTED' },
    requestedBy: String,
  },
  { timestamps: true },
);
partTransferSchema.set('toJSON', clean);
export const PartTransfer = mongoose.model('PartTransfer', partTransferSchema);

/* ---------------- Alert ---------------- */
const alertSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
    title: { type: String, required: true },
    description: String,
    vehicleId: String,
    reason: String,
    recommendedAction: String,
    expectedImpact: String,
    actionType: String, // maps to an executable action in actionService
    actionLabel: String,
    payload: mongoose.Schema.Types.Mixed,
    details: mongoose.Schema.Types.Mixed,
    audience: { type: [String], default: ['MANAGER'] },
    status: { type: String, enum: ['OPEN', 'RESOLVED', 'DISMISSED'], default: 'OPEN', index: true },
    resolution: { by: String, at: Date, note: String },
    storeCode: { type: String, default: 'S1' },
  },
  { timestamps: true },
);
alertSchema.set('toJSON', clean);
export const Alert = mongoose.model('Alert', alertSchema);

/* ---------------- Customer ---------------- */
const customerSchema = new mongoose.Schema(
  {
    customerCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    phone: String,
    email: String,
    vehicleId: { type: String, index: true },
    vehicleLabel: String,
    relationship: { type: String, enum: ['SERVICE', 'PRE_DELIVERY'], default: 'SERVICE' },
    trackingCode: { type: String, unique: true },
    advisorName: String,
    serviceTaskId: String,
    serviceStatus: {
      stage: { type: String, default: 'RECEIVED' },
      steps: [{ key: String, label: String, status: String, at: Date, _id: false }],
      estimatedCompletion: Date,
      advisorNote: String,
      updatedAt: Date,
    },
    notifications: [{ channel: String, message: String, at: Date, _id: false }],
  },
  { timestamps: true },
);
customerSchema.set('toJSON', clean);
export const Customer = mongoose.model('Customer', customerSchema);

/* ---------------- Activity ---------------- */
const activitySchema = new mongoose.Schema(
  {
    vehicleId: { type: String, index: true },
    type: { type: String, default: 'INFO' },
    message: { type: String, required: true },
    actor: { name: String, role: String },
    source: { type: String, enum: ['VOICE', 'SYSTEM', 'AI', 'MANUAL'], default: 'SYSTEM' },
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);
activitySchema.set('toJSON', clean);
export const Activity = mongoose.model('Activity', activitySchema);

/* ---------------- Counter (human-friendly IDs) ---------------- */
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.model('Counter', counterSchema);

export async function nextSequence(name, start = 1000) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true },
  ).lean();
  return start + doc.seq;
}
