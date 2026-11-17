import { z } from 'zod';
import { Activity } from '../models/index.js';
import { processTranscript, previewObservation, applyObservation, DEMO_SCRIPTS } from '../services/voiceWorkflowService.js';
import { validateObservation } from '../services/ai/parsers.js';
import { aiStatus } from '../services/ai/aiService.js';
import { ApiError } from '../utils/ApiError.js';

export const processSchema = z.object({
  transcript: z.string().trim().min(3, 'Say or type an observation first.').max(1000, 'Keep observations under 1,000 characters.'),
});

export const confirmSchema = z.object({
  parsed: z.record(z.string(), z.unknown()),
  transcript: z.string().max(1000).optional(),
  photos: z.array(z.object({ url: z.string().url(), label: z.string().max(60).optional() })).max(6).optional(),
  ai: z.record(z.string(), z.unknown()).optional(),
});

export async function process(req, res) {
  res.json(await processTranscript(req.body.transcript));
}

/** Re-validates an edited observation and returns a fresh preview. */
export async function preview(req, res) {
  const v = validateObservation(req.body.parsed);
  if (!v.data) throw ApiError.badRequest('The observation could not be read.', v.errors);
  const p = await previewObservation(v.data);
  res.json({ parsed: v.data, preview: { ...p, warnings: [...v.warnings, ...(p.warnings || [])], errors: [...v.errors.map((m) => ({ code: 'VALIDATION', message: m })), ...(p.errors || [])].filter((e, i, arr) => arr.findIndex((x) => x.message === e.message) === i) } });
}

export async function confirm(req, res) {
  const v = validateObservation(req.body.parsed);
  if (!v.ok) throw ApiError.badRequest(v.errors[0] || 'The observation is incomplete.', v.errors);
  const result = await applyObservation(v.data, req.user, {
    transcript: req.body.transcript,
    photos: req.body.photos || [],
    aiMeta: req.body.ai ? { provider: String(req.body.ai.engine || ''), confidence: Number(req.body.ai.confidence) || undefined, mode: String(req.body.ai.mode || '') } : undefined,
  });
  res.status(201).json(result);
}

export async function recent(req, res) {
  const filter = { source: 'VOICE' };
  if (req.query.mine === 'true') filter['actor.name'] = req.user.name;
  const items = await Activity.find(filter).sort({ createdAt: -1 }).limit(12).lean();
  res.json({ items });
}

export async function samples(_req, res) {
  res.json({ samples: DEMO_SCRIPTS, ai: aiStatus() });
}
