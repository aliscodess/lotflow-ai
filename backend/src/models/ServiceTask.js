import mongoose from 'mongoose';
import { PRIORITIES, TASK_STATUS, PART_LINE_STATUS } from '../utils/constants.js';

const partLineSchema = new mongoose.Schema(
  {
    partNumber: { type: String, required: true },
    name: String,
    qty: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: PART_LINE_STATUS, default: 'AVAILABLE' },
    sourceStore: String,
    eta: Date,
    transferId: String,
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  { at: { type: Date, default: Date.now }, message: String, actor: String },
  { _id: false },
);

const serviceTaskSchema = new mongoose.Schema(
  {
    taskId: { type: String, required: true, unique: true },
    vehicleId: { type: String, required: true, index: true },
    vehicleLabel: String,
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    issue: { type: String, required: true },
    description: String,
    category: {
      type: String,
      enum: ['INSPECTION', 'REPAIR', 'MAINTENANCE', 'RECON', 'BODY', 'EV', 'TIRES', 'DETAILING'],
      default: 'REPAIR',
    },
    requiredSkill: { type: String, default: 'GENERAL' },
    priority: { type: String, enum: PRIORITIES, default: 'MEDIUM' },
    status: { type: String, enum: TASK_STATUS, default: 'UNSCHEDULED', index: true },
    technician: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
    technicianName: String,
    bay: String, // BAY-1..BAY-5
    requiredParts: [partLineSchema],
    estimatedDuration: { type: Number, default: 60 }, // minutes
    scheduledTime: Date,
    startedAt: Date,
    completedAt: Date,
    inspectionId: String,
    source: { type: String, enum: ['VOICE', 'INSPECTION', 'CUSTOMER', 'MANUAL', 'AI'], default: 'MANUAL' },
    storeCode: { type: String, default: 'S1' },
    notes: String,
    history: [historySchema],
  },
  { timestamps: true },
);

serviceTaskSchema.virtual('scheduledEnd').get(function scheduledEnd() {
  if (!this.scheduledTime) return null;
  return new Date(this.scheduledTime.getTime() + (this.estimatedDuration || 60) * 60000);
});

serviceTaskSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.id;
    return ret;
  },
});

export const ServiceTask = mongoose.model('ServiceTask', serviceTaskSchema);
