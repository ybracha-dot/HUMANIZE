// Live provider adapters. Keys stay server-side (environment only). Every result carries "vendor:model" so the UI can
// show exactly which provider produced it. Retries are bounded and honor Retry-After; a timeout after the request was
// sent is reported as UNCERTAIN (billing unknown), never retried blindly by this layer.
import type { CallControl, CallResult, Provider } from './types.ts';
import { ProviderError, RetryableError, UncertainError } from './types.ts';
import { buildPrompt, type Role } from '../roles.ts';
import { extractJson } from '../../shared/proposals.ts';

const estimateTokens = (s: string) => Math.ceil(s.length / 3.2); // conservative for English prose

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, signal?: AbortSignal) {
  const ctl = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([ctl, signal]) : ctl;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: combined });
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new UncertainError('Request timed out after it was sent; the provider may still have processed (and billed) it.');
    throw new RetryableError(`network error: ${e?.cause?.code ?? e?.message ?? 'unknown'}`); // failed before a response: nothing was billed
  }
  const requestRef = res.headers.get('request-id') ?? res.headers.get('x-request-id') ?? undefined;
  if (res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers.get('retry-after'));
    throw new RetryableError(`provider returned ${res.status}`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`provider returned ${res.status}: ${text.slice(0, 300).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')}`, res.status);
  try { return { json: JSON.parse(text), requestRef }; } catch { throw new ProviderError('provider returned non-JSON'); }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 500, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!(e instanceof RetryableError) || i === attempts - 1) throw e;
      const wait = Math.min(e.retryAfterMs ?? baseMs * 2 ** i, 30000) + Math.floor(Math.random() * 100);
      await sleep(wait);
    }
  }
  throw last;
}

export class AnthropicProvider implements Provider {
  vendor = 'anthropic' as const; paid = true;
  constructor(public model: string, private key: string, private baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com', private maxOut = 4096) {}
  get id() { return `anthropic:${this.model}`; }
  estimate(role: Role, input: any) { const p = buildPrompt(role, input); return { inputTokens: estimateTokens(p.system + p.user), outputTokens: this.maxOut }; }
  async call(role: Role, input: any, ctl: CallControl = {}): Promise<CallResult> {
    const { system, user } = buildPrompt(role, input);
    const t0 = Date.now();
    const { json, requestRef } = await withRetry(() => postJson(`${this.baseUrl}/v1/messages`, { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' }, { model: this.model, max_tokens: ctl.maxOutputTokens ?? this.maxOut, system, messages: [{ role: 'user', content: user }] }, 120000, ctl.signal));
    const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return { output: extractJson(text), usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, cachedTokens: json.usage?.cache_read_input_tokens ?? 0 }, latencyMs: Date.now() - t0, provider: this.id, vendor: 'anthropic', model: this.model, paid: true, requestRef };
  }
}

export class OpenAIProvider implements Provider {
  vendor = 'openai' as const; paid = true;
  constructor(public model: string, private key: string, private baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com', private maxOut = 4096) {}
  get id() { return `openai:${this.model}`; }
  estimate(role: Role, input: any) { const p = buildPrompt(role, input); return { inputTokens: estimateTokens(p.system + p.user), outputTokens: this.maxOut }; }
  async call(role: Role, input: any, ctl: CallControl = {}): Promise<CallResult> {
    const { system, user } = buildPrompt(role, input);
    const t0 = Date.now();
    const { json, requestRef } = await withRetry(() => postJson(`${this.baseUrl}/v1/chat/completions`, { authorization: `Bearer ${this.key}` }, { model: this.model, max_completion_tokens: ctl.maxOutputTokens ?? this.maxOut, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, 120000, ctl.signal));
    const text = json.choices?.[0]?.message?.content ?? '';
    return { output: extractJson(text), usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0, cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0 }, latencyMs: Date.now() - t0, provider: this.id, vendor: 'openai', model: this.model, paid: true, requestRef };
  }
}
export { withRetry };
