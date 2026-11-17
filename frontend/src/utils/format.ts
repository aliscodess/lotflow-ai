import clsx, { type ClassValue } from 'clsx';
import type { Priority, TaskStatus, VehicleStatus } from '../types';

export const cn = (...args: ClassValue[]) => clsx(args);

export function timeAgo(date?: string | Date | null) {
  if (!date) return '';
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 0) return 'just now';
  if (diff < 45) return 'just now';
  if (diff < 90) return '1 min ago';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 5400) return '1 hr ago';
  if (diff < 86400) return `${Math.round(diff / 3600)} hr ago`;
  const d = Math.round(diff / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function clock(date?: string | Date | null) {
  if (!date) return '—';
  return new Date(date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}

export function dayClock(date?: string | Date | null) {
  if (!date) return '—';
  const d = new Date(date);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 86400000).toDateString() === d.toDateString();
  if (sameDay) return clock(d);
  if (tomorrow) return `Tomorrow ${clock(d)}`;
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${clock(d)}`;
}

export function shortDate(date?: string | Date | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const inr = (n?: number) =>
  n === undefined || n === null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

/** ₹24.5 L style for vehicle prices */
export const lakh = (n?: number) => (n ? `₹${(n / 100000).toFixed(n >= 10000000 ? 0 : 1)} L` : '—');

export const km = (n?: number) => (n === undefined ? '—' : `${new Intl.NumberFormat('en-IN').format(n)} km`);

export const VEHICLE_STATUS: Record<VehicleStatus, { label: string; tone: Tone; color: string }> = {
  AVAILABLE: { label: 'Available', tone: 'ok', color: 'var(--color-ok)' },
  INSPECTION_REQUIRED: { label: 'Inspection required', tone: 'warn', color: 'var(--color-warn)' },
  SERVICE: { label: 'In service', tone: 'svc', color: 'var(--color-svc)' },
  HOLD: { label: 'On hold', tone: 'hold', color: 'var(--color-hold)' },
  SOLD: { label: 'Sold', tone: 'sold', color: 'var(--color-sold)' },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  UNSCHEDULED: { label: 'Unscheduled', tone: 'neutral' },
  SCHEDULED: { label: 'Scheduled', tone: 'brand' },
  WAITING_PARTS: { label: 'Waiting on parts', tone: 'warn' },
  IN_PROGRESS: { label: 'In progress', tone: 'svc' },
  QUALITY_CHECK: { label: 'Quality check', tone: 'sold' },
  COMPLETED: { label: 'Completed', tone: 'ok' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'brand' },
  HIGH: { label: 'High', tone: 'warn' },
  URGENT: { label: 'Urgent', tone: 'bad' },
  CRITICAL: { label: 'Critical', tone: 'bad' },
};

export const ROLE_LABEL = { MANAGER: 'Manager', LOT_ASSOCIATE: 'Lot associate', SERVICE_ADVISOR: 'Service advisor' } as const;

export type Tone = 'ok' | 'warn' | 'svc' | 'hold' | 'sold' | 'bad' | 'brand' | 'neutral' | 'paint';

export const toneClasses: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok ring-ok/25',
  warn: 'bg-warn/12 text-warn ring-warn/30',
  svc: 'bg-svc/12 text-svc ring-svc/30 dark:text-[#9d88ff]',
  hold: 'bg-hold/12 text-hold ring-hold/30 dark:text-[#a3afc2]',
  sold: 'bg-sold/12 text-sold ring-sold/30',
  bad: 'bg-bad/12 text-bad ring-bad/30',
  brand: 'bg-brand/10 text-brand ring-brand/25 dark:text-brand-2',
  neutral: 'bg-surface-2 text-muted ring-line',
  paint: 'bg-paint/15 text-[#8a6a00] ring-paint/40 dark:text-paint',
};

export const healthTone = (score: number): Tone => (score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'bad');
export const healthColor = (score: number) => (score >= 85 ? 'var(--color-ok)' : score >= 60 ? 'var(--color-warn)' : 'var(--color-bad)');

export const STAGES = [
  { key: 'RECEIVED', label: 'Vehicle received' },
  { key: 'INSPECTED', label: 'Inspection completed' },
  { key: 'PARTS_IDENTIFIED', label: 'Parts identified' },
  { key: 'PARTS_AVAILABLE', label: 'Parts available' },
  { key: 'REPAIR_SCHEDULED', label: 'Repair scheduled' },
  { key: 'IN_REPAIR', label: 'Repair in progress' },
  { key: 'QUALITY_CHECK', label: 'Quality check' },
  { key: 'READY', label: 'Ready for pickup' },
];

export const bayName = (code?: string | null) => (code ? code.replace('BAY-', 'Bay ') : 'Unassigned');

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
