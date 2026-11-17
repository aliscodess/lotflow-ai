import mongoose from 'mongoose';
import { VEHICLE_STATUS, CONDITION_STATUS } from '../utils/constants.js';
import { daysBetween } from '../utils/time.js';

const conditionItem = {
  status: { type: String, enum: CONDITION_STATUS, default: 'GOOD' },
  notes: { type: String, default: '' },
  level: Number, // fuel % or battery % / voltage
  updatedAt: Date,
};

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, default: null },
    label: String,
    kind: { type: String, enum: ['placeholder', 'upload'], default: 'placeholder' },
    uploadedBy: String,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const historyRef = new mongoose.Schema(
  { refId: String, date: Date, summary: String, status: String },
  { _id: false },
);

const healthItem = { score: Number, max: Number, status: String, note: String };

const vehicleSchema = new mongoose.Schema(
  {
    vehicleId: { type: String, required: true, unique: true, index: true, trim: true },
    vin: { type: String, trim: true },
    make: { type: String, required: true },
    model: { type: String, required: true },
    variant: String,
    year: Number,
    type: { type: String, enum: ['SUV', 'SEDAN', 'HATCHBACK', 'MUV', 'PICKUP'], default: 'SUV' },
    fuelType: { type: String, enum: ['PETROL', 'DIESEL', 'EV', 'HYBRID', 'CNG'], default: 'PETROL' },
    transmission: { type: String, default: 'Automatic' },
    color: String,
    odometerKm: Number,
    listPriceINR: Number,
    ownership: { type: String, enum: ['INVENTORY', 'CUSTOMER'], default: 'INVENTORY' },
    storeCode: { type: String, default: 'S1', index: true },

    location: {
      zone: { type: String, enum: ['LOT', 'SERVICE', 'DISPLAY', 'TRANSIT'], default: 'LOT' },
      row: String,
      position: Number,
      updatedAt: Date,
      updatedBy: String,
    },
    lastSeenAt: Date,

    status: { type: String, enum: VEHICLE_STATUS, default: 'AVAILABLE', index: true },
    condition: {
      exterior: conditionItem,
      interior: conditionItem,
      tires: conditionItem,
      fuel: conditionItem,
      battery: conditionItem,
      mechanical: conditionItem,
    },
    photos: [photoSchema],
    inspectionHistory: [historyRef],
    serviceHistory: [historyRef],

    stockedAt: Date,
    daysInInventory: { type: Number, default: 0 },
    expectedDaysToSell: { type: Number, default: 30 },
    listingCompleteness: { type: Number, default: 90 },
    listing: {
      descriptionComplete: { type: Boolean, default: true },
      featuresComplete: { type: Boolean, default: true },
      viewsLast7d: { type: Number, default: 0 },
      leadsLast7d: { type: Number, default: 0 },
    },

    healthScore: { type: Number, default: 100 },
    healthBreakdown: {
      location: healthItem,
      condition: healthItem,
      photos: healthItem,
      listing: healthItem,
      service: healthItem,
    },
    reservedFor: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    flags: {
      auditRequested: { type: Boolean, default: false },
      merchandisingPlan: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

vehicleSchema.index({ 'location.row': 1, 'location.position': 1 });

vehicleSchema.virtual('locationLabel').get(function locationLabel() {
  if (this.location?.zone === 'SERVICE') return 'Service area';
  if (this.location?.zone === 'TRANSIT') return 'In transit';
  if (this.location?.row && this.location?.position) return `${this.location.row}${this.location.position}`;
  return 'Unassigned';
});

vehicleSchema.virtual('displayName').get(function displayName() {
  return `${this.year ?? ''} ${this.make} ${this.model}`.trim();
});

vehicleSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    if (ret.stockedAt && ret.ownership === 'INVENTORY') ret.daysInInventory = daysBetween(ret.stockedAt);
    ret.photoCount = ret.photos?.length ?? 0;
    delete ret.__v;
    delete ret.id;
    return ret;
  },
});

export const Vehicle = mongoose.model('Vehicle', vehicleSchema);
