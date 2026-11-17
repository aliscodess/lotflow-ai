import { env } from '../../config/env.js';

const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
};

const BASE_URLS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
};

export const PROVIDER_LABELS = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  groq: 'Groq',
  demo: 'LotFlow NLU (on-premise rules)',
};

export function modelFor(provider = env.ai.provider) {
  return env.ai.model || DEFAULT_MODELS[provider] || '';
}

async function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ai.timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timed out after ${env.ai.timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic({ system, user, maxTokens }) {
  return withTimeout(async (signal) => {
    const res = await fetch(env.ai.baseUrl || BASE_URLS.anthropic, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ai.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelFor('anthropic'),
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = await res.json();
    return (json.content || []).map((c) => c.text || '').join('');
  });
}

async function callOpenAICompatible(provider, { system, user, maxTokens, json }) {
  return withTimeout(async (signal) => {
    const base = env.ai.baseUrl || BASE_URLS[provider];
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.ai.apiKey}` },
      body: JSON.stringify({
        model: modelFor(provider),
        temperature: 0,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${provider} API ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  });
}

/** Provider-agnostic completion. Returns raw text. Throws on transport errors. */
export async function complete({ system, user, maxTokens = 700, json = true }) {
  const provider = env.ai.provider;
  if (provider === 'demo') throw new Error('No AI provider configured');
  if (provider === 'anthropic') return callAnthropic({ system, user, maxTokens });
  if (provider === 'openai' || provider === 'groq' || provider === 'custom') {
    return callOpenAICompatible(provider === 'custom' ? 'openai' : provider, { system, user, maxTokens, json });
  }
  throw new Error(`Unknown AI_PROVIDER "${provider}"`);
}
