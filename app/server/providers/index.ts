import { AnthropicProvider, OpenAIProvider } from './live.ts';
import { FixtureProvider } from './fixture.ts';
import type { Provider } from './types.ts';

export interface ProviderSet {
  mode: 'demo' | 'live';
  editor: Provider;
  critic: Provider;
  verifier: Provider;
  /** true only when editor and critic are different vendors. Two calls to one model are never "independent". */
  independent: boolean;
  independence: string;
  notes: string[];
}

export function providerStatus() {
  return {
    anthropic: { configured: !!process.env.ANTHROPIC_API_KEY, model: process.env.STUDIO_ANTHROPIC_MODEL ?? 'claude-sonnet-5-5' },
    openai: { configured: !!process.env.OPENAI_API_KEY, model: process.env.STUDIO_OPENAI_MODEL ?? '' },
  };
}

export function selectProviders(mode: 'demo' | 'live'): ProviderSet {
  const fixture = new FixtureProvider();
  if (mode === 'demo') {
    return { mode, editor: fixture, critic: fixture, verifier: fixture, independent: false, independence: 'Demo mode: every stage is the same deterministic local rule engine (fixture). It is not an independent model and no key was used.', notes: [] };
  }
  const notes: string[] = [];
  const a = process.env.ANTHROPIC_API_KEY ? new AnthropicProvider(process.env.STUDIO_ANTHROPIC_MODEL ?? 'claude-sonnet-5-5', process.env.ANTHROPIC_API_KEY) : null;
  const oModel = process.env.STUDIO_OPENAI_MODEL;
  const o = process.env.OPENAI_API_KEY && oModel ? new OpenAIProvider(oModel, process.env.OPENAI_API_KEY) : null;
  if (process.env.OPENAI_API_KEY && !oModel) notes.push('OPENAI_API_KEY is set but STUDIO_OPENAI_MODEL is not; the OpenAI critic is disabled.');
  if (!a && !o) throw new Error('Live mode needs ANTHROPIC_API_KEY and/or OPENAI_API_KEY (and STUDIO_OPENAI_MODEL for OpenAI). Switch to demo mode or set a key.');
  const editor: Provider = a ?? o!;
  const critic: Provider = a && o ? o : editor;
  const independent = editor.vendor !== critic.vendor;
  if (!independent) notes.push('Only one provider is configured, so the second opinion is the same model on a fresh prompt. It is labelled as a second pass, not an independent review.');
  return { mode, editor, critic, verifier: editor, independent, independence: independent ? `Independent vendors: editor ${editor.id}, reviewer ${critic.id}.` : `Single provider (${editor.id}): the reviewer is a second pass by the same model, not an independent check.`, notes };
}
