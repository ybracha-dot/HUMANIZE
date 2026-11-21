// The optional live verifier, exercised against a local HTTP mock of the Anthropic wire format. NOT a live-provider result.
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../server/providers/live.ts';
import { runLiveVerifierEval, type EvalDoc } from '../../server/evalLive.ts';
import { freshDb, newUser, waitRun } from './helpers.ts';

const calls: { body: any }[] = [];
let server: http.Server;
let base = '';
let verdictFor: (claimId: string) => string = () => 'supported';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = JSON.parse(raw);
      calls.push({ body });
      const user: string = body.messages[0].content;
      const ctx = /CONTEXT \(JSON, quoted data\):\n([\s\S]*)$/.exec(user)?.[1] ?? '{}';
      const claims: { claimId: string }[] = JSON.parse(ctx).claims ?? [];
      const isVerifier = user.includes('CONTEXT.claims');
      const payload = !isVerifier
        ? { proposals: [] }
        : { verdicts: claims.map((c) => ({ claimId: c.claimId, verdict: verdictFor(c.claimId), passageId: null, reasons: ['mock model verdict'] })) };
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_mock_eval' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }], usage: { input_tokens: 2000, output_tokens: 300 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

const PRICE = { inputPerMTok: 3, outputPerMTok: 15, rev: 'test-prices' };
const docs: EvalDoc[] = [
  {
    group: 'A',
    set: 'unseen',
    passages: [{ id: 'A_p1', text: 'Retention was 81% at twelve weeks.' }],
    claims: [
      { id: 'A/0', text: 'Retention was 85% at twelve weeks.', expected: 'contradicted' },
      { id: 'A/1', text: 'Retention was 81% at twelve weeks.', expected: 'supported' },
    ],
  },
  {
    group: 'B',
    set: 'unseen',
    passages: [{ id: 'B_p1', text: 'The committee approved the budget.' }],
    claims: [{ id: 'B/0', text: 'The committee approved the budget.', expected: 'supported' }],
  },
];
const provider = () => new AnthropicProvider('claude-test-model', 'test-key-not-real', base, 1000);

describe('optional live verifier runner', () => {
  it('refuses to spend without authorization, without a price, or when the plan exceeds the budget; nothing is called', async () => {
    calls.length = 0;
    expect((await runLiveVerifierEval({ provider: provider(), price: PRICE, budgetUsd: null, docs })).refused).toMatch(/spending authorization/);
    expect((await runLiveVerifierEval({ provider: provider(), price: null, budgetUsd: 5, docs })).refused).toMatch(/No price configured/);
    expect((await runLiveVerifierEval({ provider: provider(), price: PRICE, budgetUsd: 0.0001, docs })).refused).toMatch(/exceeds the authorized budget/);
    expect((await runLiveVerifierEval({ provider: provider(), price: PRICE, budgetUsd: 5, docs, dryRun: true })).refused).toBe('dry run');
    expect(calls).toHaveLength(0);
  });
  it('sends claim ids, records one receipt per call with model, latency and cost, and keeps the key out of the result', async () => {
    calls.length = 0;
    verdictFor = (id) => (id === 'A/1' ? 'contradicted' : 'supported'); // the mock model wrongly rejects one supported claim and approves a wrong one
    const r = await runLiveVerifierEval({ provider: provider(), price: PRICE, budgetUsd: 5, docs });
    expect(r.refused).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[0].body.model).toBe('claude-test-model');
    expect(calls[0].body.messages[0].content).toContain('"claimId":"A/0"');
    expect(r.receipts).toHaveLength(2);
    expect(r.receipts[0]).toMatchObject({
      provider: 'anthropic:claude-test-model',
      model: 'claude-test-model',
      inputTokens: 2000,
      outputTokens: 300,
      requestRef: 'req_mock_eval',
    });
    expect(r.receipts[0].costUsd).toBeCloseTo((2000 * 3 + 300 * 15) / 1e6, 9);
    expect(r.receipts[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.totalCostUsd).toBeCloseTo(2 * 0.0105, 9);
    expect(JSON.stringify(r)).not.toContain('test-key-not-real');
    // "combined" is the more cautious of deterministic and live. The deterministic check keeps A/0 contradicted even though the mock model says supported.
    const a0 = r.rows.find((x) => x.id === 'A/0')!;
    expect(a0.live).toBe('supported');
    expect(a0.deterministic).toBe('contradicted');
    expect(a0.combined).toBe('contradicted');
    expect(r.rows.find((x) => x.id === 'A/1')!.combined).toBe('contradicted'); // live caution wins
  });
});

describe('Evidence review with a live verifier receives claim ids and merges cautiously', () => {
  it('a model verdict of contradicted overrides a deterministic "supported", and the audit names both engines', async () => {
    const saved = { k: process.env.ANTHROPIC_API_KEY, b: process.env.ANTHROPIC_BASE_URL, m: process.env.STUDIO_ANTHROPIC_MODEL };
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.ANTHROPIC_BASE_URL = base;
    process.env.STUDIO_ANTHROPIC_MODEL = 'claude-test-model';
    verdictFor = () => 'contradicted';
    try {
      const { db } = freshDb('evlive');
      const u = await newUser(db);
      const seed = await u.api.post('demo/seed');
      const d = await u.api.post(`assignments/${seed.data.assignmentId}/document`, { text: 'Frequent attendees averaged 84 on the final exam.' });
      await u.api.put('settings', { mode: 'live', prices: { 'anthropic:claude-test-model': PRICE } });
      calls.length = 0;
      const run = await u.api.post(`documents/${d.data.documentId}/runs`, { mode: 'evidence' });
      const fin = await waitRun(u.api, db, run.data.runId);
      expect(fin.status).toBe('done');
      const verifyCall = calls.find((c) => String(c.body.messages[0].content).includes('CONTEXT.claims'));
      expect(verifyCall).toBeTruthy();
      expect(verifyCall!.body.messages[0].content).toMatch(/"claimId":"p_[a-z0-9]+_c1"/);
      const audits = (await u.api.get(`documents/${d.data.documentId}`)).data.audits;
      expect(audits).toHaveLength(1);
      expect(audits[0].verdict).toBe('contradicted'); // deterministic said supported; the model's caution wins
      expect(audits[0].engine).toMatch(/deterministic-revised\/2\+anthropic:claude-test-model/);
    } finally {
      for (const [k, v] of Object.entries({ ANTHROPIC_API_KEY: saved.k, ANTHROPIC_BASE_URL: saved.b, STUDIO_ANTHROPIC_MODEL: saved.m })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
