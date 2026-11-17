export const ROLES = {
  MANAGER: 'MANAGER',
  LOT_ASSOCIATE: 'LOT_ASSOCIATE',
  SERVICE_ADVISOR: 'SERVICE_ADVISOR',
};

export const VEHICLE_STATUS = ['AVAILABLE', 'INSPECTION_REQUIRED', 'SERVICE', 'SOLD', 'HOLD'];
export const CONDITION_STATUS = ['GOOD', 'FAIR', 'POOR'];
export const CONDITION_KEYS = ['exterior', 'interior', 'tires', 'fuel', 'battery', 'mechanical'];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const PRIORITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4, CRITICAL: 4 };

export const TASK_STATUS = [
  'UNSCHEDULED',
  'SCHEDULED',
  'WAITING_PARTS',
  'IN_PROGRESS',
  'QUALITY_CHECK',
  'COMPLETED',
  'CANCELLED',
];
export const ACTIVE_TASK_STATUS = ['UNSCHEDULED', 'SCHEDULED', 'WAITING_PARTS', 'IN_PROGRESS', 'QUALITY_CHECK'];

export const PART_LINE_STATUS = [
  'AVAILABLE',
  'RESERVED',
  'SHORTAGE',
  'TRANSFER_REQUESTED',
  'IN_TRANSIT',
  'ORDERED',
  'RECEIVED',
];

export const LOT_ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const LOT_POSITIONS = 12;

export const ALERT_TYPES = [
  'INSPECTION',
  'AGING',
  'PARTS_SHORTAGE',
  'SCHEDULING',
  'SERVICE_DELAY',
  'LOT_ACCURACY',
  'BATTERY',
  'URGENT_REPAIR',
  'CUSTOMER',
  'SUSTAINABILITY',
];

export const SERVICE_STEPS = [
  { key: 'RECEIVED', label: 'Vehicle received' },
  { key: 'INSPECTED', label: 'Inspection completed' },
  { key: 'PARTS_IDENTIFIED', label: 'Parts identified' },
  { key: 'PARTS_AVAILABLE', label: 'Parts available' },
  { key: 'REPAIR_SCHEDULED', label: 'Repair scheduled' },
  { key: 'IN_REPAIR', label: 'Repair in progress' },
  { key: 'QUALITY_CHECK', label: 'Quality check' },
  { key: 'READY', label: 'Ready for pickup' },
];
