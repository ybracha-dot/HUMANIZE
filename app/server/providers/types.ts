import type { Role } from '../roles.ts';

export interface CallResult<T = any> {
  output: T;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  latencyMs: number;
  /** e.g. "anthropic:claude-sonnet-5-5" or "fixture:rules/1" — shown next to every output */
  provider: string;
  vendor: 'fixture' | 'anthropic' | 'openai';
  model: string;
  paid: boolean;
  requestRef?: string;
}
export interface CallControl {
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

export interface Provider {
  id: string;
  vendor: 'fixture' | 'anthropic' | 'openai';
  model: string;
  paid: boolean;
  call(role: Role, input: any, ctl?: CallControl): Promise<CallResult>;
  /** rough upper bound used before dispatch */
  estimate(role: Role, input: any): { inputTokens: number; outputTokens: number };
}

/** Error whose outcome at the provider is unknown (timeout after send). The caller marks spend 'uncertain'. */
export class UncertainError extends Error {
  constructor(
    message: string,
    public requestRef?: string,
  ) {
    super(message);
  }
}
export class RetryableError extends Error {
  constructor(
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
