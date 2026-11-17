import { env } from '../config/env.js';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Round a date up to the next N-minute boundary. */
export function roundUp(date, minutes = 15) {
  const ms = minutes * MINUTE;
  return new Date(Math.ceil(new Date(date).getTime() / ms) * ms);
}

export function roundDown(date, minutes = 15) {
  const ms = minutes * MINUTE;
  return new Date(Math.floor(new Date(date).getTime() / ms) * ms);
}

export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * MINUTE);
}

export function daysBetween(from, to = new Date()) {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / DAY));
}

/** Format a time in the dealership's local timezone, e.g. "4:30 PM". */
export function formatLocalTime(date) {
  const d = new Date(new Date(date).getTime() + env.tzOffsetMinutes * MINUTE);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Start of "today" in the dealership's timezone, returned as a UTC Date. */
export function startOfLocalDay(date = new Date()) {
  const offset = env.tzOffsetMinutes * MINUTE;
  const local = new Date(new Date(date).getTime() + offset);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offset);
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}
