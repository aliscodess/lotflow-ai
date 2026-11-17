export type Role = 'MANAGER' | 'LOT_ASSOCIATE' | 'SERVICE_ADVISOR';
export type VehicleStatus = 'AVAILABLE' | 'INSPECTION_REQUIRED' | 'SERVICE' | 'SOLD' | 'HOLD';
export type ConditionStatus = 'GOOD' | 'FAIR' | 'POOR';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';
export type TaskStatus = 'UNSCHEDULED' | 'SCHEDULED' | 'WAITING_PARTS' | 'IN_PROGRESS' | 'QUALITY_CHECK' | 'COMPLETED' | 'CANCELLED';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: Role;
  title?: string;
  storeCode?: string;
}

export interface ConditionItem {
  status: ConditionStatus;
  notes?: string;
  level?: number;
  updatedAt?: string;
}

export interface HealthItem {
  score: number;
  max: number;
  status: 'ok' | 'warn' | 'bad';
  note: string;
}

export interface VehicleLocation {
  zone: 'LOT' | 'SERVICE' | 'DISPLAY' | 'TRANSIT';
  row?: string | null;
  position?: number | null;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Photo {
  _id?: string;
  url: string | null;
  label: string;
  kind: 'placeholder' | 'upload';
  createdAt?: string;
}

export interface Vehicle {
  _id: string;
  vehicleId: string;
  vin: string;
  make: string;
  model: string;
  variant?: string;
  year: number;
  type: string;
  fuelType: string;
  transmission?: string;
  color: string;
  odometerKm?: number;
  listPriceINR?: number;
  ownership: 'INVENTORY' | 'CUSTOMER';
  location: VehicleLocation;
  locationLabel: string;
  displayName: string;
  lastSeenAt?: string;
  status: VehicleStatus;
  condition: Record<string, ConditionItem>;
  photos: Photo[];
  photoCount: number;
  inspectionHistory: { refId: string; date: string; summary: string; status: string }[];
  serviceHistory: { refId: string; date: string; summary: string; status: string }[];
  daysInInventory: number;
  expectedDaysToSell: number;
  listingCompleteness: number;
  listing?: { descriptionComplete: boolean; featuresComplete: boolean; viewsLast7d: number; leadsLast7d: number };
  healthScore: number;
  healthBreakdown: Record<'location' | 'condition' | 'photos' | 'listing' | 'service', HealthItem>;
  flags?: { auditRequested?: boolean; merchandisingPlan?: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface LotVehicle {
  _id: string;
  vehicleId: string;
  make: string;
  model: string;
  variant?: string;
  year: number;
  type: string;
  fuelType: string;
  color: string;
  status: VehicleStatus;
  ownership: 'INVENTORY' | 'CUSTOMER';
  healthScore: number;
  critical: boolean;
  location: VehicleLocation;
  lastSeenAt?: string;
  daysInInventory: number | null;
  expectedDaysToSell: number;
  auditRequested?: boolean;
  issues: { key: string; status: ConditionStatus; notes?: string }[];
  listPriceINR?: number;
  photoCount?: number;
  listingCompleteness?: number;
  odometerKm?: number;
}

export interface LotSlot {
  code: string;
  row: string;
  position: number;
  vehicle: LotVehicle | null;
}

export interface LotMapData {
  rows: { row: string; label: string; slots: LotSlot[] }[];
  serviceArea: LotVehicle[];
  unplaced: LotVehicle[];
  counts: Record<string, number>;
}

export interface Issue {
  area: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  conditionKey?: string;
}

export interface Inspection {
  _id: string;
  inspectionId: string;
  vehicleId: string;
  vehicleLabel: string;
  reportedBy: { name: string; role: string };
  issues: Issue[];
  photos: { url: string; label?: string }[];
  status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'CONVERTED' | 'CLOSED';
  priority: Priority;
  source: 'VOICE' | 'MANUAL' | 'SYSTEM';
  transcript?: string;
  serviceTaskId?: string;
  createdAt: string;
}

export interface PartLine {
  partNumber: string;
  name: string;
  qty: number;
  status: 'AVAILABLE' | 'RESERVED' | 'SHORTAGE' | 'TRANSFER_REQUESTED' | 'IN_TRANSIT' | 'ORDERED' | 'RECEIVED';
  sourceStore?: string;
  eta?: string;
  transferId?: string;
}

export interface ServiceTask {
  _id: string;
  taskId: string;
  vehicleId: string;
  vehicleLabel: string;
  issue: string;
  description?: string;
  category: string;
  requiredSkill: string;
  priority: Priority;
  status: TaskStatus;
  technician?: string;
  technicianName?: string;
  bay?: string | null;
  requiredParts: PartLine[];
  estimatedDuration: number;
  scheduledTime?: string;
  scheduledEnd?: string | null;
  startedAt?: string;
  completedAt?: string;
  inspectionId?: string;
  source: string;
  notes?: string;
  history: { at: string; message: string; actor?: string }[];
  suggestedParts?: { partNumber: string; name: string; category: string }[];
  createdAt: string;
}

export interface StoreAvailability {
  code: string;
  name: string;
  label: string;
  distanceKm: number;
  quantity: number;
  reserved: number;
  available: number;
  isLocal: boolean;
}

export interface ResolutionOption {
  type: 'TRANSFER' | 'RESCHEDULE' | 'BACKORDER';
  recommended: boolean;
  title: string;
  via?: string;
  storeName?: string;
  storeLabel?: string;
  distanceKm?: number;
  eta?: string;
  etaLabel?: string;
  delayMinutes?: number;
  delayLabel?: string;
  costINR?: number;
  co2Kg?: number;
  newStartLabel?: string;
  newEndLabel?: string;
  bayName?: string;
  technicianName?: string;
}

export interface Resolution {
  part: { partNumber: string; name: string; category: string; brand?: string; unitPriceINR?: number; leadTimeDays?: number };
  qty: number;
  stores: StoreAvailability[];
  localAvailable: number;
  status: 'LOCAL' | 'TRANSFER' | 'BACKORDER';
  options: ResolutionOption[];
  recommended: string | null;
  summary: string;
}

export interface Alert {
  _id: string;
  type: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description?: string;
  vehicleId?: string;
  reason?: string;
  recommendedAction?: string;
  expectedImpact?: string;
  actionType?: string;
  actionLabel?: string;
  payload?: Record<string, string>;
  details?: { reasons?: string[]; daysInInventory?: number; expected?: number; stores?: { code: string; name?: string; qty: number }[]; issues?: Issue[] };
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  resolution?: { by: string; at: string; note: string };
  createdAt: string;
}

export interface Activity {
  _id: string;
  vehicleId?: string;
  type: string;
  message: string;
  actor?: { name: string; role: string };
  source: 'VOICE' | 'SYSTEM' | 'AI' | 'MANUAL';
  createdAt: string;
}

export interface ServiceStep {
  key: string;
  label: string;
  status: 'done' | 'current' | 'pending';
  at?: string | null;
}

export interface CustomerStatusView {
  trackingCode: string;
  customerCode: string;
  firstName: string;
  vehicleId: string;
  vehicleLabel: string;
  relationship: 'SERVICE' | 'PRE_DELIVERY';
  stage: string;
  stageLabel: string;
  steps: ServiceStep[];
  estimatedCompletion?: string;
  advisorNote?: string;
  advisorName?: string;
  updatedAt?: string;
  dealership: string;
}

export interface Customer {
  _id: string;
  customerCode: string;
  name: string;
  phone: string;
  email: string;
  vehicleId: string;
  vehicleLabel: string;
  relationship: 'SERVICE' | 'PRE_DELIVERY';
  trackingCode: string;
  advisorName?: string;
  serviceTaskId?: string;
  serviceStatus: { stage: string; steps: ServiceStep[]; estimatedCompletion?: string; advisorNote?: string; updatedAt?: string };
  notifications: { channel: string; message: string; at: string }[];
  view: CustomerStatusView;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  priority?: string;
  kind?: 'info' | 'success' | 'warning' | 'alert' | 'task';
  link?: string;
  vehicleId?: string;
  at: string;
  read?: boolean;
}

export interface AiMeta {
  engine: string;
  model: string;
  mode: 'live' | 'demo' | 'fallback';
  latencyMs: number;
  confidence: number | null;
}

export interface Observation {
  vehicleId: string | null;
  location: { row: string; position: number } | null;
  issues: Issue[];
  action: string;
  priority: string;
  fuelLevel?: number | null;
  batteryLevel?: number | null;
  notes?: string;
  confidence?: number | null;
}

export interface VoicePreview {
  ok: boolean;
  errors: { code: string; message: string }[];
  warnings: string[];
  vehicle: { vehicleId: string; label: string; variant?: string; type: string; color: string; status: VehicleStatus; location: string; healthScore: number; ownership: string } | null;
  changes: { field: string; label: string; group?: string; from: string; to: string; note?: string; severity?: string; changed?: boolean }[];
  effects: string[];
  actionLabel?: string;
  health?: { from: number; to: number };
}

export interface VoiceProcessResult {
  transcript: string;
  parsed: Observation;
  highlights: { start: number; end: number; type: string; text: string }[];
  ai: AiMeta;
  preview: VoicePreview;
}

export interface DispatchOp {
  taskId: string;
  vehicleId: string;
  vehicleLabel: string;
  issue: string;
  priority: Priority;
  kind: 'PRIORITIZE' | 'REASSIGN_TECH' | 'RESCHEDULE' | 'MOVE_BAY' | 'SCHEDULE';
  title: string;
  reason: string;
  changes: { time?: { from: string; to: string }; bay?: { from: string; to: string }; technician?: { from: string; to: string } };
}

export interface DispatchRecommendation {
  generatedAt: string;
  ops: DispatchOp[];
  idleBefore: number;
  idleAfter: number;
  savedMinutes: number;
  summary: string;
}

export interface BayCard {
  code: string;
  name: string;
  type: string;
  status: 'OCCUPIED' | 'AVAILABLE' | 'RESERVED' | 'BLOCKED';
  utilization: number;
  current: BayJob | null;
  next: BayJob | null;
}

export interface BayJob {
  taskId: string;
  vehicleId: string;
  vehicleLabel: string;
  issue: string;
  status: TaskStatus;
  priority: Priority;
  technicianName?: string;
  start: string;
  end: string;
  overrun?: number;
  progress: number;
}

export interface TechnicianLoad {
  _id: string;
  techId: string;
  name: string;
  level: string;
  skills: string[];
  status: 'AVAILABLE' | 'BUSY' | 'OFF';
  statusNote?: string;
  currentTask: { taskId: string; vehicleId: string; bay: string } | null;
  assignedMinutes: number;
  completedMinutes: number;
  capacityMinutes: number;
  jobs: number;
}

export interface ServiceBoard {
  now: string;
  window: { start: string; end: string };
  bays: BayCard[];
  technicians: TechnicianLoad[];
  timeline: { taskId: string; vehicleId: string; bay: string; issue: string; status: TaskStatus; priority: Priority; technicianName?: string; start: string; end: string; overrun?: number }[];
  unscheduled: ServiceTask[];
  waitingParts: ServiceTask[];
  qualityCheck: ServiceTask[];
  stats: Record<string, number>;
}
