// Live ADAPTER behaviour against a local HTTP mock of the Anthropic and OpenAI wire formats.
// This is NOT a live-provider test: no real key is used. It verifies request shape, retry, uncertain billing, schema repair,
// price gating, budget degradation and provider labelling.
import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, newUser, waitRun } from './helpers.ts';
import { all, one } from '../../server/db.ts';

type Mode = 'ok' | 'rate_limit_once' | 'hang' | 'bad_schema_once' | 'bad_schema_always';
const state = {
  mode: 'ok' as Mode,
  calls: [] as { path: string; headers: any; body: any }[],
  failedOnce: false,
  usage: { in: 1000, out: 200 },
  anthropicDown: false,
};
let server: http.Server;
let base = '';

function roleOf(user: string): string {
  if (user.includes('"critic_blind"') || user.includes('"weaknesses"')) return 'critic_blind';
  if (user.includes('"verdicts":[{"index"')) return 'critic_check';
  if (user.includes('"verdicts":[{"claimId"')) return 'evidence_verifier';
  if (user.includes('same shape as argument_editor')) return 'repair';
  if (user.includes('"proposals":[{"paragraphId"')) return 'argument_editor';
  return 'other';
}
function answer(role: string, user: string): unknown {
  const draft = /<draft paragraphId="([^"]+)">\n([^<]+)\n<\/draft>/.exec(user);
  if (role === 'argument_editor' && draft) {
    const m = /^(Moreover, )(.+?[.!?])/.exec(draft[2]);
    if (m)
      return {
        proposals: [
          {
            paragraphId: draft[1],
            original: m[0],
            replacement: m[2][0].toUpperCase() + m[2].slice(1),
            issue: 'style',
            reason: 'Stock transition adds no relation.',
            evidence: [],
            meaningChange: '',
            requiresDecision: false,
          },
        ],
      };
    return { proposals: [] };
  }
  if (role === 'critic_blind') return { weaknesses: [] };
  if (role === 'critic_check') return { verdicts: [{ index: 0, verdict: 'accept', reasons: [] }] };
  return { proposals: [] };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      state.calls.push({ path: req.url!, headers: req.headers, body });
      const isAnthropic = req.url === '/v1/messages';
      if (isAnthropic && state.anthropicDown) {
        res.writeHead(500);
        res.end('{"error":"down"}');
        return;
      }
      const user: string = isAnthropic ? body.messages[0].content : body.messages[1].content;
      const role = roleOf(user);
      if (state.mode === 'hang') return; // never answers
      if (state.mode === 'rate_limit_once' && !state.failedOnce) {
        state.failedOnce = true;
        res.writeHead(429, { 'retry-after': '0' });
        res.end('{}');
        return;
      }
      let payload: unknown = answer(role, user);
      if (state.mode === 'bad_schema_always' || (state.mode === 'bad_schema_once' && !state.failedOnce)) {
        state.failedOnce = true;
        payload = { proposals: 'nope' };
      }
      const text = '```json\n' + JSON.stringify(payload) + '\n```';
      res.writeHead(200, {
        'content-type': 'application/json',
        'request-id': 'req_mock_1',
      });
      res.end(
        JSON.stringify(
          isAnthropic
            ? {
                content: [{ type: 'text', text }],
                usage: {
                  input_tokens: state.usage.in,
                  output_tokens: state.usage.out,
                },
              }
            : {
                choices: [{ message: { content: text } }],
                usage: {
                  prompt_tokens: state.usage.in,
                  completion_tokens: state.usage.out,
                },
              },
        ),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());
const ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'STUDIO_ANTHROPIC_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'STUDIO_OPENAI_MODEL',
  'STUDIO_PROVIDER_TIMEOUT_MS',
  'STUDIO_MAX_OUTPUT_TOKENS',
];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  state.mode = 'ok';
  state.calls = [];
  state.failedOnce = false;
  state.usage = { in: 1000, out: 200 };
  state.anthropicDown = false;
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
});
const restore = () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
};
const useAnthropic = () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.STUDIO_ANTHROPIC_MODEL = 'claude-test-model';
};
const useOpenAI = () => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_BASE_URL = base;
  process.env.STUDIO_OPENAI_MODEL = 'gpt-test-model';
};
const PRICES = {
  'anthropic:claude-test-model': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    rev: 'test-prices',
  },
  'openai:gpt-test-model': {
    inputPerMTok: 2,
    outputPerMTok: 10,
    rev: 'test-prices',
  },
};

async function setup(name: string, withPrices = true) {
  const { db } = freshDb(name);
  const u = await newUser(db);
  const seed = await u.api.post('demo/seed');
  const d = await u.api.post(`assignments/${seed.data.assignmentId}/document`, {
    text: 'Moreover, attendance is associated with higher exam scores. We checked it.',
  });
  await u.api.put('settings', {
    mode: 'live',
    ...(withPrices ? { prices: PRICES } : {}),
  });
  return { db, u, doc: d.data.documentId as string };
}

describe('live adapters (mock HTTP server, no real key)', () => {
  it('Anthropic: request shape, provider label on every output, spend settled to observed tokens, key never returned', async () => {
    useAnthropic();
    try {
      const { db, u, doc } = await setup('la1');
      const run = await u.api.post(`documents/${doc}/runs`, { mode: 'quick' });
      const fin = await waitRun(u.api, db, run.data.runId);
      expect(fin.status).toBe('done');
      const call = state.calls.find((c) => c.path === '/v1/messages')!;
      expect(call.headers['x-api-key']).toBe('test-key-not-real');
      expect(call.headers['anthropic-version']).toBe('2023-06-01');
      expect(call.body.model).toBe('claude-test-model');
      expect(call.body.system).toMatch(/quoted DATA/);
      expect(call.body.messages[0].content).toMatch(/<source id="src_\d+_p\d+"/);
      const props = (await u.api.get(`documents/${doc}/proposals`)).data;
      expect(props.length).toBeGreaterThan(0);
      expect(props.every((p: any) => p.provider === 'anthropic:claude-test-model')).toBe(true);
      expect(fin.summary.providers.independent).toBe(false);
      expect(fin.summary.providers.independence).toMatch(/not an independent check/);
      expect(fin.spend.paidCalls).toBe(1);
      expect(fin.spend.settledUsd).toBeCloseTo((1000 * 3 + 200 * 15) / 1e6, 8); // 0.006
      expect(JSON.stringify([fin, props, (await u.api.get('settings')).data])).not.toContain('test-key-not-real');
    } finally {
      restore();
    }
  });

  it('independent only when two vendors are configured; the reviewer is then the other vendor', async () => {
    useAnthropic();
    useOpenAI();
    try {
      const { db, u, doc } = await setup('la2');
      const run = await u.api.post(`documents/${doc}/runs`, { mode: 'deep' });
      const fin = await waitRun(u.api, db, run.data.runId);
      expect(fin.status).toBe('done');
      expect(fin.summary.providers.independent).toBe(true);
      expect(fin.summary.providers.critic).toBe('openai:gpt-test-model');
      expect(state.calls.some((c) => c.path === '/v1/chat/completions')).toBe(true);
      expect((await u.api.get(`documents/${doc}/proposals`)).data[0].critic.independent).toBe(true);
    } finally {
      restore();
    }
  });

  it('retries a 429 with backoff and still records only one settled paid call', async () => {
    useAnthropic();
    state.mode = 'rate_limit_once';
    try {
      const { db, u, doc } = await setup('la3');
      const run = await u.api.post(`documents/${doc}/runs`, { mode: 'quick' });
      const fin = await waitRun(u.api, db, run.data.runId);
      expect(fin.status).toBe('done');
      expect(state.calls.filter((c) => c.path === '/v1/messages').length).toBe(2);
      expect(fin.spend.paidCalls).toBe(1);
    } finally {
      restore();
    }
  });

  it('a timeout after the request was sent marks spend UNCERTAIN, keeps it counted, and schedules a retry instead of retrying blindly', async () => {
    useAnthropic();
    state.mode = 'hang';
    process.env.STUDIO_PROVIDER_TIMEOUT_MS = '300';
    try {
      const { db, u, doc } = await setup('la4');
      const run = await u.api.post(`documents/${doc}/runs`, { mode: 'quick' });
      for (let i = 0; i < 3; i++) await (await import('./helpers.ts')).drain(db);
      const row = one(db, 'SELECT state, reserved_usd FROM spend WHERE paid=1')!;
      expect(row.state).toBe('uncertain');
      expect(row.reserved_usd).toBeGreaterThan(0);
      const st = one(db, "SELECT status, not_before, error FROM run_stages WHERE name='argument_edit'")!;
      expect(st.status).toBe('ready');
      expect(st.not_before).toBeGreaterThan(Date.now());
      expect(st.error).toMatch(/uncertain/i);
      expect((await u.api.get('settings')).data.usedUsd).toBeGreaterThan(0); // still counted against budgets
      expect((await u.api.get(`runs/${run.data.runId}`)).data.status).toBe('running');
    } finally {
      restore();
    }
  });

  it('an unknown price blocks paid use (never assumed); after configuring it the run resumes', async () => {
    useAnthropic();
    try {
      const { db, u, doc } = await setup('la5', false);
      const run = await u.api.post(`documents/${doc}/runs`, { mode: 'quick' });
      const est = await u.api.post(`documents/${doc}/runs/estimate`, {
        mode: 'quick',
      });
      expect(est.data.priceMissing).toBe(true);
      expect(est.data.costUsd).toBeNull();
      const blocked = await waitRun(u.api, db, run.data.runId);
      expect(blocked.status).toBe('blocked');
      expect(blocked.error).toMatch(/No price is configured/);
      expect(state.calls.length).toBe(0);
      await u.api.put('settings', { prices: PRICES });
      await u.api.post(`runs/${run.data.runId}/resume`);
      expect((await waitRun(u.api, db, run.data.runId)).status).toBe('done');
    } finally {
      restore();
    }
  });

  it('when the second opinion exceeds the cap the completed first pass is returned, with the degradation named', async () => {
    useAnthropic();
    useOpenAI();
    process.env.STUDIO_MAX_OUTPUT_TOKENS = '1000';
    state.usage = { in: 10000, out: 2000 }; // observed cost 0.06
    try {
      const { db, u, doc } = await setup('la6');
      const run = await u.api.post(`documents/${doc}/runs`, {
        mode: 'deep',
        budgetUsd: 0.07,
      });
      const fin = await waitRun(u.api, db, run.data.runId);
      expect(fin.status).toBe('done');
      expect(fin.summary.degraded.map((d: any) => d.stage)).toEqual(expect.arrayContaining(['critic_blind', 'critic_check']));
      expect(fin.summary.degraded[0].reason).toMatch(/budget/i);
      expect(fin.summary.providers.critic).toBeNull();
      const props = (await u.api.get(`documents/${doc}/proposals`)).data;
      expect(props.length).toBeGreaterThan(0); // first pass kept
      expect(fin.spend.settledUsd).toBeLessThanOrEqual(0.07);
    } finally {
      restore();
    }
  });

  it('invalid JSON gets one schema repair attempt; each attempt has its own ledger row; a second failure keeps the document unchanged', async () => {
    useAnthropic();
    state.mode = 'bad_schema_once';
    try {
      const { db, u, doc } = await setup('la7');
      const before = (await u.api.get(`documents/${doc}`)).data.revision.hash;
      const run = await u.api.post(`documents/${doc}/runs`, { mode: 'quick' });
      const fin = await waitRun(u.api, db, run.data.runId);
      expect(fin.status).toBe('done');
      expect(all(db, 'SELECT id FROM spend WHERE paid=1').length).toBe(2);
      expect(state.calls[1].body.messages[0].content).toMatch(/_schemaRepair/);
      // second failure
      state.mode = 'bad_schema_always';
      state.calls = [];
      const run2 = await u.api.post(`documents/${doc}/runs`, { mode: 'quick' });
      const fin2 = await waitRun(u.api, db, run2.data.runId);
      expect(fin2.status).toBe('failed');
      expect(fin2.error).toMatch(/did not match the argument_editor schema twice/);
      expect((await u.api.get(`documents/${doc}`)).data.revision.hash).toBe(before);
    } finally {
      restore();
    }
  });

  it('live mode without any key refuses clearly instead of silently using the fixture', async () => {
    const { u, doc } = await setup('la8');
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[k];
    try {
      const r = await u.api.post(`documents/${doc}/runs`, { mode: 'quick' });
      expect(r.status).toBe(409);
      expect(r.data.error.message).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      restore();
    }
  });
});
