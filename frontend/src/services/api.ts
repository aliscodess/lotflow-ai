import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type {
  Alert,
  Activity,
  Customer,
  CustomerStatusView,
  DispatchRecommendation,
  Inspection,
  LotMapData,
  LotVehicle,
  Observation,
  Resolution,
  Role,
  ServiceBoard,
  ServiceTask,
  User,
  Vehicle,
  VoicePreview,
  VoiceProcessResult,
} from '../types';

export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const TOKEN_KEY = 'lotflow-access';
const REFRESH_KEY = 'lotflow-refresh';

export const tokens = {
  get access() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const http = axios.create({ baseURL: `${API_URL}/api`, timeout: 20000 });

/** Timestamp of the user's last write request; used to avoid echoing their own actions as realtime toasts. */
export let lastMutationAt = 0;

http.interceptors.request.use((config) => {
  if (config.method && config.method.toLowerCase() !== 'get') lastMutationAt = Date.now();
  const t = tokens.access;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

async function refreshAccess(): Promise<string | null> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
    tokens.set(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthCall = original?.url?.includes('/auth/');
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      refreshing ||= refreshAccess().finally(() => {
        refreshing = null;
      });
      const fresh = await refreshing;
      if (fresh) {
        original.headers.Authorization = `Bearer ${fresh}`;
        return http(original);
      }
      tokens.clear();
      onSessionExpired?.();
    }
    return Promise.reject(error);
  },
);

/** Human-readable message for any API error. */
export function errorMessage(err: unknown): string {
  const e = err as AxiosError<{ error?: { message?: string } }>;
  if (e?.response?.data?.error?.message) return e.response.data.error.message;
  if (e?.code === 'ECONNABORTED') return 'The server took too long to respond. Try again.';
  if (e?.message === 'Network Error' || !e?.response) return 'Cannot reach the LotFlow server. Check that the backend is running.';
  if (e?.response?.status === 503) return 'The database is unavailable. Check that MongoDB is running.';
  return 'Something went wrong. Try again.';
}

const get = <T>(url: string, params?: object) => http.get<T>(url, { params }).then((r) => r.data);
const post = <T>(url: string, body?: object) => http.post<T>(url, body).then((r) => r.data);
const patch = <T>(url: string, body?: object) => http.patch<T>(url, body).then((r) => r.data);

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface SystemStatus {
  status: string;
  demoMode: boolean;
  ai: { mode: 'live' | 'demo'; provider: string; label: string; model: string };
  db: { mode: string; state: string };
  storage: string;
}

export interface DashboardData {
  generatedAt: string;
  kpis: {
    totalVehicles: number;
    healthy: number;
    attention: number;
    critical: number;
    inspectionsToday: number;
    openInspections: number;
    serviceJobs: number;
    completedToday: number;
    avgDaysInInventory: number;
    lotAccuracy: number;
    serviceDelayRate: number;
    serviceDelays: number;
    agingVehicles: number;
    openAlerts: number;
    actionable: number;
  };
  statusCounts: Record<string, number>;
  agingBuckets: { label: string; count: number }[];
  alerts: Alert[];
  activity: Activity[];
}

export interface AgingItem {
  vehicleId: string;
  label: string;
  variant?: string;
  segment: string;
  location: string;
  daysInInventory: number;
  expectedDaysToSell: number;
  overBy: number;
  risk: 'HIGH' | 'MEDIUM' | 'LOW';
  photos: number;
  listingCompleteness: number;
  views: number;
  reasons: { key: string; title: string; detail: string }[];
  recommendations: { key: string; title: string; detail: string }[];
  pricingNote: string;
  playbookApplied: boolean;
  summary?: string;
  engine?: string;
}

export interface StoreRow {
  code: string;
  name: string;
  label: string;
  city: string;
  distanceKm: number;
  isPrimary?: boolean;
  lotAccuracy: number;
  avgDaysToSell: number;
  serviceDelayRate: number;
  inspectionCompletion: number;
  photoCompleteness: number;
  listingCompleteness: number;
  csat: number;
  monthlyUnits: number;
  inventory: number;
}

export interface SustainabilityData {
  score: number;
  metrics: { avoidableMovementKm: number; fuelSavingsINR: number; idleReductionPct: number; evUtilizationPct: number; co2AvoidedKg: number; transferKm30d: number; lotMoves30d: number };
  breakdown: { key: string; label: string; score: number }[];
  trend: { month: string; score: number }[];
  recommendations: { key: string; title: string; detail: string; impact: string; actionable?: boolean }[];
  transferGroups: { fromStore: string; storeName: string; count: number; distanceKm: number; transfers: { transferId: string; partName: string; eta: string; serviceTaskId?: string }[] }[];
}

export interface PartRow {
  _id: string;
  partNumber: string;
  name: string;
  category: string;
  brand: string;
  compatibleModels: string[];
  unitPriceINR: number;
  leadTimeDays: number;
  inventoryByStore: { storeCode: string; quantity: number; reserved: number; reorderLevel: number; bin?: string }[];
  localAvailable: number;
  lowStock: boolean;
}

export interface Transfer {
  _id: string;
  transferId: string;
  partNumber: string;
  partName: string;
  qty: number;
  fromStore: string;
  toStore: string;
  distanceKm: number;
  eta: string;
  status: 'REQUESTED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  serviceTaskId?: string;
  vehicleId?: string;
  requestedBy: string;
  createdAt: string;
}

export const api = {
  // auth
  login: (email: string, password: string) => post<AuthResponse>('/auth/login', { email, password }),
  demoLogin: (role: Role) => post<AuthResponse>('/auth/demo', { role }),
  me: () => get<{ user: User }>('/auth/me'),
  logout: () => post('/auth/logout'),
  health: () => get<SystemStatus>('/health'),
  resetDemo: () => post<{ ok: boolean }>('/system/demo/reset'),

  // vehicles
  vehicles: (params?: { status?: string; q?: string; sort?: string; health?: string; ownership?: string }) => get<{ items: LotVehicle[]; total: number }>('/vehicles', params),
  lot: () => get<LotMapData>('/vehicles/lot'),
  vehicle: (id: string) =>
    get<{ vehicle: Vehicle; inspections: Inspection[]; tasks: ServiceTask[]; activity: Activity[]; customer: { name: string; phone: string; relationship: string; trackingCode: string; customerCode: string; stage?: string } | null; aging: AgingItem | null }>(
      `/vehicles/${id}`,
    ),
  updateVehicle: (id: string, body: object) => patch<{ vehicle: Vehicle }>(`/vehicles/${id}`, body),
  uploadVehiclePhotos: (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('photos', f));
    return http.post<{ urls: string[]; vehicle: Vehicle }>(`/vehicles/${id}/photos`, fd).then((r) => r.data);
  },
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('photos', f));
    return http.post<{ files: { url: string; storage: string }[] }>('/uploads', fd).then((r) => r.data);
  },

  // voice
  voiceSamples: () => get<{ samples: { id: string; label: string; text: string }[]; ai: SystemStatus['ai'] }>('/voice/samples'),
  voiceRecent: () => get<{ items: Activity[] }>('/voice/recent'),
  voiceProcess: (transcript: string) => post<VoiceProcessResult>('/voice/process', { transcript }),
  voicePreview: (parsed: Observation) => post<{ parsed: Observation; preview: VoicePreview }>('/voice/preview', { parsed }),
  voiceConfirm: (body: { parsed: Observation; transcript?: string; photos?: { url: string; label?: string }[]; ai?: object }) =>
    post<{ vehicle: Vehicle; inspection: Inspection | null; task: ServiceTask | null; steps: { key: string; label: string; detail: string }[] }>('/voice/confirm', body),

  // inspections & service
  inspections: (status?: string) => get<{ items: Inspection[] }>('/inspections', { status }),
  convertInspection: (id: string) => post<{ task: ServiceTask; message: string; alreadyConverted?: boolean }>(`/inspections/${id}/convert`),
  tasks: (status?: string) => get<{ items: ServiceTask[] }>('/service/tasks', { status }),
  task: (id: string) => get<{ task: ServiceTask; resolutions: Resolution[] }>(`/service/tasks/${id}`),
  updateTask: (id: string, body: object) => patch<{ task: ServiceTask; message: string }>(`/service/tasks/${id}`, body),
  addPart: (id: string, partNumber: string, qty = 1) =>
    post<{ task: ServiceTask; resolution: Resolution | null; reserved: boolean; duplicate?: boolean }>(`/service/tasks/${id}/parts`, { partNumber, qty }),
  board: () => get<ServiceBoard>('/service/board'),
  recommendation: () => get<DispatchRecommendation>('/service/dispatch/recommendation'),
  applyDispatch: () => post<DispatchRecommendation & { appliedCount: number }>('/service/dispatch/apply'),

  // parts
  parts: (params?: { q?: string; shortage?: boolean }) => get<{ items: PartRow[]; stores: { code: string; name: string; label: string; distanceKm: number }[] }>('/parts', params),
  transfers: () => get<{ items: Transfer[] }>('/parts/transfers'),
  receiveTransfer: (id: string) => post(`/parts/transfers/${id}/receive`),
  resolveParts: (taskId: string, partNumber: string, strategy: string) => post<{ message: string; task: ServiceTask }>('/parts/resolve', { taskId, partNumber, strategy }),

  // analytics
  dashboard: () => get<DashboardData>('/analytics/dashboard'),
  aging: () => get<{ items: AgingItem[]; summary: { aging: number; highRisk: number; avgOverBy: number; avgDaysInInventory: number } }>('/analytics/aging'),
  agingExplain: (vehicleId: string) => get<AgingItem>(`/analytics/aging/${vehicleId}`),
  agingPlaybook: (vehicleId: string) => post<{ message: string }>(`/analytics/aging/${vehicleId}/playbook`),
  stores: () => get<{ stores: StoreRow[]; trend: Record<string, number | string>[]; insight: string; engine: string }>('/analytics/stores'),
  sustainability: () => get<SustainabilityData>('/analytics/sustainability'),

  // alerts & actions
  alerts: (status = 'OPEN') => get<{ items: Alert[] }>('/alerts', { status }),
  updateAlert: (id: string, status: string) => patch<{ alert: Alert }>(`/alerts/${id}`, { status }),
  actions: () => get<{ open: Alert[]; applied: Alert[]; counts: { open: number; appliedToday: number } }>('/actions'),
  applyAction: (id: string) => post<{ message: string; alert: Alert }>(`/actions/${id}/apply`),

  // customers
  customers: () => get<{ items: Customer[] }>('/customers'),
  customerStatus: (id: string) => get<{ customer: Customer; status: CustomerStatusView; task: ServiceTask | null }>(`/customers/${id}/service-status`),
  updateCustomerStatus: (id: string, body: { stage?: string; estimatedCompletion?: string; note?: string; notify?: boolean }) =>
    patch<{ customer: Customer; status: CustomerStatusView }>(`/customers/${id}/service-status`, body),
  notifyCustomer: (id: string) => post<{ message: string }>(`/customers/${id}/notify`, {}),
  track: (code: string) => get<CustomerStatusView>(`/public/track/${code}`),
};
