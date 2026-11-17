import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { complete, modelFor, PROVIDER_LABELS } from './providers.js';
import { OBSERVATION_SYSTEM, observationUser, AGING_SYSTEM, agingUser, STORE_SYSTEM, storeUser } from './promptTemplates.js';
import { extractJson, validateObservation, computeHighlights } from './parsers.js';
import * as rules from './demoEngine.js';

/**
 * Single entry point for every AI capability in LotFlow.
 * - With AI_API_KEY set, calls the configured provider (Anthropic, OpenAI or Groq).
 * - Without a key (or if the provider fails / returns invalid JSON) it uses the
 *   deterministic LotFlow rules engine, so the product never breaks.
 */

export function aiStatus() {
  const live = env.ai.provider !== 'demo';
  return {
    mode: live ? 'live' : 'demo',
    provider: env.ai.provider,
    label: PROVIDER_LABELS[env.ai.provider] || env.ai.provider,
    model: live ? modelFor() : 'lotflow-rules-v2',
  };
}

const isLive = () => env.ai.provider !== 'demo';

export async function extractObservation(transcript, ctx = {}) {
  const started = Date.now();
  const warnings = [];
  let source = 'rules';
  let result = null;

  if (isLive()) {
    try {
      const text = await complete({ system: OBSERVATION_SYSTEM, user: observationUser(transcript, ctx), maxTokens: 700 });
      const raw = extractJson(text);
      const v = validateObservation(raw);
      if (v.data && (v.ok || v.data.vehicleId)) {
        result = v;
        source = 'llm';
      } else {
        warnings.push('The AI response did not pass validation, so the LotFlow rules engine was used instead.');
      }
    } catch (err) {
      logger.warn(`[ai] extraction via ${env.ai.provider} failed: ${err.message}`);
      const unreadable = /JSON|Unexpected token|Empty AI response/i.test(err.message);
      warnings.push(
        unreadable
          ? 'The AI response could not be read, so the LotFlow rules engine was used instead.'
          : 'The AI provider was unavailable, so the LotFlow rules engine was used instead.',
      );
    }
  }

  if (!result) result = validateObservation(rules.extractObservation(transcript, ctx));

  const status = aiStatus();
  return {
    data: result.data,
    ok: result.ok,
    errors: result.errors,
    warnings: [...warnings, ...result.warnings],
    highlights: computeHighlights(transcript, result.data),
    meta: {
      engine: source === 'llm' ? status.label : PROVIDER_LABELS.demo,
      model: source === 'llm' ? status.model : 'lotflow-rules-v2',
      mode: source === 'llm' ? 'live' : isLive() ? 'fallback' : 'demo',
      latencyMs: Date.now() - started,
      confidence: result.data?.confidence ?? null,
    },
  };
}

export async function explainAging(facts) {
  const base = rules.agingSummary(facts);
  if (!isLive()) return { summary: base, engine: PROVIDER_LABELS.demo };
  try {
    const text = await complete({ system: AGING_SYSTEM, user: agingUser(facts), maxTokens: 300 });
    const { summary } = extractJson(text);
    if (typeof summary === 'string' && summary.length > 20 && !/price|discount/i.test(summary)) {
      return { summary: summary.trim(), engine: aiStatus().label };
    }
  } catch (err) {
    logger.warn(`[ai] aging explanation failed: ${err.message}`);
  }
  return { summary: base, engine: PROVIDER_LABELS.demo };
}

export async function storeInsight(stores) {
  const base = rules.storeInsight(stores);
  if (!isLive()) return { insight: base, engine: PROVIDER_LABELS.demo };
  try {
    const text = await complete({ system: STORE_SYSTEM, user: storeUser(stores), maxTokens: 250 });
    const { insight } = extractJson(text);
    if (typeof insight === 'string' && insight.length > 20) return { insight: insight.trim(), engine: aiStatus().label };
  } catch (err) {
    logger.warn(`[ai] store insight failed: ${err.message}`);
  }
  return { insight: base, engine: PROVIDER_LABELS.demo };
}
