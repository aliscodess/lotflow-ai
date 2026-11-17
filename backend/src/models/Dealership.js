import mongoose from 'mongoose';

const trendSchema = new mongoose.Schema(
  { month: String, avgDays: Number, lotAccuracy: Number, serviceDelay: Number, greenScore: Number },
  { _id: false },
);

const storeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    label: String, // "Store A"
    city: String,
    address: String,
    distanceKm: { type: Number, default: 0 },
    isPrimary: { type: Boolean, default: false },
    metrics: {
      lotAccuracy: Number,
      avgDaysToSell: Number,
      serviceDelayRate: Number,
      inspectionCompletion: Number,
      photoCompleteness: Number,
      listingCompleteness: Number,
      csat: Number,
      monthlyUnits: Number,
      inventory: Number,
    },
    trend: [trendSchema],
  },
  { _id: false },
);

const dealershipSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    location: { city: String, state: String, address: String },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    stores: [storeSchema],
  },
  { timestamps: true },
);

export const Dealership = mongoose.model('Dealership', dealershipSchema);
