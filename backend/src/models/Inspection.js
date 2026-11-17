import mongoose from 'mongoose';
import { PRIORITIES } from '../utils/constants.js';

const issueSchema = new mongoose.Schema(
  {
    area: { type: String, required: true },
    description: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    conditionKey: { type: String, default: 'exterior' },
  },
  { _id: false },
);

const inspectionSchema = new mongoose.Schema(
  {
    inspectionId: { type: String, required: true, unique: true },
    vehicleId: { type: String, required: true, index: true },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
    vehicleLabel: String,
    reportedBy: { userId: mongoose.Schema.Types.ObjectId, name: String, role: String },
    issues: [issueSchema],
    photos: [{ url: String, label: String, _id: false }],
    status: {
      type: String,
      enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'CONVERTED', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },
    priority: { type: String, enum: PRIORITIES, default: 'MEDIUM' },
    source: { type: String, enum: ['VOICE', 'MANUAL', 'SYSTEM'], default: 'MANUAL' },
    transcript: String,
    aiMeta: { provider: String, confidence: Number, mode: String },
    serviceTaskId: String,
    notes: String,
  },
  { timestamps: true },
);

inspectionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Inspection = mongoose.model('Inspection', inspectionSchema);
