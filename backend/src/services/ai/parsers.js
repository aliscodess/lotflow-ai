import { z } from 'zod';

export const ACTIONS = ['inspection_required', 'service_required', 'location_update', 'mark_available', 'hold', 'mark_sold', 'none'];
export const SEVERITIES = ['low', 'medium', 'high'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const upper = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

/** Extracts the first JSON object from an LLM response (handles code fences and stray prose). */
export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty AI response');
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in AI response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Maps a free-text vehicle area to the condition field it affects. */
export function conditionKeyForArea(area = '') {
  const a = area.toLowerCase();
  if (/(tyre|tire|wheel|rim|alloy|tread|valve)/.test(a)) return 'tires';
  if (/(12v|battery|charge|soc|hv )/.test(a)) return 'battery';
  if (/(fuel|tank|petrol|diesel)/.test(a)) return 'fuel';
  if (/(seat|dash|upholster|interior|cabin|carpet|steering|infotainment|ac\b|air ?con|headliner|console)/.test(a)) return 'interior';
  if (/(brake|engine|clutch|suspension|gear|transmission|coolant|oil|exhaust|warning|steering rack|horn)/.test(a)) return 'mechanical';
  return 'exterior';
}

const issueSchema = z.object({
  area: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(140),
  severity: z.preprocess(lower, z.enum(SEVERITIES)).catch('low'),
});

const observationSchema = z.object({
  vehicleId: z.preprocess(
    (v) => (v === null || v === undefined || v === '' ? null : String(v).replace(/[^0-9A-Za-z]/g, '')),
    z.string().min(2).max(12).nullable(),
  ),
  location: z
    .object({
      row: z.preprocess(upper, z.string()),
      position: z.coerce.number(),
    })
    .nullable()
    .optional()
    .catch(null),
  issues: z.array(z.unknown()).max(12).catch([]).default([]),
  action: z.preprocess(lower, z.enum(ACTIONS)).catch('none').default('none'),
  priority: z.preprocess(lower, z.enum(PRIORITIES)).catch('medium').default('medium'),
  fuelLevel: z.coerce.number().min(0).max(100).nullable().optional().catch(null),
  batteryLevel: z.coerce.number().min(0).max(100).nullable().optional().catch(null),
  notes: z.string().max(400).optional().catch(''),
  confidence: z.coerce.number().min(0).max(1).optional().catch(undefined),
});

/**
 * Validates and normalises an observation from any source (LLM, rule engine or a human edit).
 * Never throws: returns { ok, data, errors, warnings }.
 */
export function validateObservation(raw) {
  const warnings = [];
  const errors = [];
  const parsed = observationSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, data: null, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), warnings };
  }
  const d = parsed.data;

  let location = null;
  if (d.location && d.location.row) {
    const row = String(d.location.row).slice(0, 1);
    const position = Math.round(Number(d.location.position));
    if (!/^[A-F]$/.test(row)) warnings.push(`Row "${d.location.row}" is not on this lot (rows A–F). Location was not changed.`);
    else if (!Number.isFinite(position) || position < 1 || position > 12) warnings.push(`Position ${d.location.position} is outside row ${row} (1–12). Location was not changed.`);
    else location = { row, position };
  }

  const issues = [];
  for (const item of d.issues) {
    const r = issueSchema.safeParse(item);
    if (r.success) issues.push({ ...r.data, area: r.data.area.toLowerCase(), conditionKey: conditionKeyForArea(r.data.area) });
    else warnings.push('One reported issue could not be understood and was skipped.');
  }

  let { action, priority } = d;
  if (action === 'none' && issues.length) {
    action = 'inspection_required';
    warnings.push('No action was stated, so an inspection was assumed for the reported damage.');
  }
  if (action === 'none' && location) action = 'location_update';
  const rank = { low: 1, medium: 2, high: 3, urgent: 4 };
  const maxSeverity = issues.reduce((m, i) => Math.max(m, rank[i.severity]), 0);
  if (issues.length && rank[priority] < maxSeverity) priority = ['low', 'low', 'medium', 'high'][maxSeverity];

  if (!d.vehicleId) errors.push('No vehicle number was heard. Say the stock number, for example "Vehicle 2847".');
  if (!location && !issues.length && ['none', 'location_update'].includes(action) && d.fuelLevel == null && d.batteryLevel == null) {
    errors.push('Nothing to update was heard. Mention a location, an issue or an action.');
  }

  return {
    ok: errors.length === 0,
    data: {
      vehicleId: d.vehicleId,
      location,
      issues,
      action,
      priority,
      fuelLevel: d.fuelLevel ?? null,
      batteryLevel: d.batteryLevel ?? null,
      notes: d.notes || '',
      confidence: d.confidence ?? null,
    },
    errors,
    warnings,
  };
}

/** Finds spans in the transcript that correspond to extracted entities, for UI highlighting. */
export function computeHighlights(transcript, data) {
  if (!transcript || !data) return [];
  const spans = [];
  const add = (re, type) => {
    const m = re.exec(transcript);
    if (m) spans.push({ start: m.index, end: m.index + m[0].length, type, text: m[0] });
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (data.vehicleId) add(new RegExp(`(vehicle|stock|car|unit|number|#)?\\s*#?${esc(data.vehicleId)}`, 'i'), 'vehicle');
  if (data.location) {
    add(new RegExp(`row\\s+${data.location.row}\\b[^.]*?\\b${data.location.position}\\b`, 'i'), 'location');
    if (!spans.some((s) => s.type === 'location')) add(new RegExp(`\\b${data.location.row}\\s*-?\\s*${data.location.position}\\b`, 'i'), 'location');
  }
  const tyre = (w) => (/^t(y|i)res?$/.test(w) ? 't(?:y|i)res?' : `${esc(w)}s?`);
  for (const issue of data.issues || []) {
    const words = issue.area.split(/\s+/).filter(Boolean);
    const phrase = words.map(tyre).join('\\s+');
    const before = spans.length;
    if (phrase) add(new RegExp(`\\b${phrase}\\b`, 'i'), 'issue');
    if (spans.length === before && words.length) add(new RegExp(`\\b${tyre(words[words.length - 1])}\\b`, 'i'), 'issue');
    const keyWord = issue.description.split(/\s+/).find((w) => w.length > 3 && !/^(minor|light|slight|very)$/i.test(w));
    if (keyWord) add(new RegExp(`\\b${esc(keyWord.slice(0, 5))}\\w*`, 'i'), 'condition');
  }
  add(/\b(send (it )?(for|to) (an )?(inspection|service)|needs? (an? )?(inspection|service|repair)|inspect\w*|put (it )?on hold|front ?line ready|ready for sale|mark (it )?(as )?sold)\b/i, 'action');
  // de-duplicate overlapping spans
  spans.sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of spans) if (!out.length || s.start >= out[out.length - 1].end) out.push(s);
  return out;
}
