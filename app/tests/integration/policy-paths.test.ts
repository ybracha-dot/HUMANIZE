// Which cleaning stages actually run, in which execution path. The upstream skills are NOT executed by the app; the app runs its own
// reimplementation (shared/voice.ts clarity rules + shared/unicode.ts hygiene) and records the policy version on every suggestion.
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, newUser, waitRun } from './helpers.ts';

let server: http.Server;
let base = '';
let reply: (paragraphId: string, text: string) => unknown = () => ({ proposals: [] });
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const user: string = JSON.parse(raw).messages[0].content;
      const m = /<draft paragraphId="([^"]+)">\n([^<]+)\n<\/draft>/.exec(user);
      const payload = user.includes('"proposals":[{"paragraphId"') && m ? reply(m[1], m[2]) : { proposals: [] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }], usage: { input_tokens: 800, output_tokens: 120 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

const SENT = 'Moreover, we utilize data in order to learn (Lee 4), and the pilot saved $3 million "a quiet revolution" in 2024.';
const PROFILE = { directness: 'direct', firstPerson: 'allow', avoidEmDash: true, preferredTerms: {}, openings: [], language: 'auto', notes: '', confirmed: {} };

async function liveRun(name: string, issue: string, replacement: string, text = SENT) {
  const saved = { k: process.env.ANTHROPIC_API_KEY, b: process.env.ANTHROPIC_BASE_URL, m: process.env.STUDIO_ANTHROPIC_MODEL };
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.STUDIO_ANTHROPIC_MODEL = 'claude-test-model';
  try {
    const { db } = freshDb(name);
    const u = await newUser(db);
    const seed = await u.api.post('demo/seed');
    const d = await u.api.post(`assignments/${seed.data.assignmentId}/document`, { text });
    await u.api.put('settings', { mode: 'live', prices: { 'anthropic:claude-test-model': { inputPerMTok: 3, outputPerMTok: 15, rev: 'test' } } });
    await u.api.put('voice/profile', PROFILE);
    reply = (pid) => ({
      proposals: [{ paragraphId: pid, original: text, replacement, issue, reason: 'mock', evidence: [], meaningChange: '', requiresDecision: false }],
    });
    const run = await u.api.post(`documents/${d.data.documentId}/runs`, { mode: 'quick' });
    const fin = await waitRun(u.api, db, run.data.runId);
    expect(fin.status).toBe('done');
    return (await u.api.get(`documents/${d.data.documentId}/proposals`)).data as any[];
  } finally {
    for (const [k, v] of Object.entries({ ANTHROPIC_API_KEY: saved.k, ANTHROPIC_BASE_URL: saved.b, STUDIO_ANTHROPIC_MODEL: saved.m })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('live path: clarity rules and hygiene run on model output before it is stored', () => {
  it('a style suggestion is cleaned (wordy phrases, em dash per profile, invisible character) and keeps quote, citation, figure, year', async () => {
    const dirty = 'We utilize data in order to learn (Lee 4) — and the pilot saved $3 million "a quiet revolution" in 2024.​';
    const [p] = await liveRun('pp1', 'stock_phrase', dirty);
    expect(p.replacement).toBe('We use data to learn (Lee 4), and the pilot saved $3 million "a quiet revolution" in 2024.');
    expect(p.replacement).not.toMatch(/​|—/);
    for (const keep of ['(Lee 4)', '$3 million', '"a quiet revolution"', '2024']) expect(p.replacement).toContain(keep);
    expect(p.policyVersion).toMatch(/^writing-studio-policy\/1/);
    expect(p.provider).toBe('anthropic:claude-test-model');
  });
  it("a substantive suggestion gets hygiene only: an invisible character goes, the writer's wording is not restyled", async () => {
    const sentence = 'Attendance was linked to higher scores.';
    const [p] = await liveRun('pp2', 'unsupported_claim', 'Attendance was linked to higher scores,​ and we utilize that in order to argue.', sentence);
    expect(p.replacement).not.toMatch(/​/);
    expect(p.replacement).toContain('we utilize that in order to argue'); // not a style issue: wording untouched
  });
  it('meaningful Unicode survives: an emoji joiner and Hebrew direction marks are kept while a stray joiner is removed', async () => {
    const sentence = 'Plain sentence here.';
    const [p] = await liveRun('pp3', 'unsupported_claim', 'Plain ‍sentence 👩‍💻 ‏שלום‏ here.', sentence);
    expect(p.replacement).toBe('Plain sentence 👩‍💻 ‏שלום‏ here.');
  });
});

describe('demo path and the editor preview use the same two stages', () => {
  const { db } = freshDb('pp-demo');
  it('fixture review: a wordy sentence is cleaned by the same policy and labelled fixture', async () => {
    const u = await newUser(db);
    const seed = await u.api.post('demo/seed');
    await u.api.put('voice/profile', PROFILE);
    const d = await u.api.post(`assignments/${seed.data.assignmentId}/document`, { text: 'Moreover, we utilize data in order to learn — quickly.' });
    await waitRun(u.api, db, (await u.api.post(`documents/${d.data.documentId}/runs`, { mode: 'quick' })).data.runId);
    const [p] = (await u.api.get(`documents/${d.data.documentId}/proposals`)).data;
    expect(p.replacement).toBe('We use data to learn, quickly.');
    expect(p.provider).toBe('fixture:rules/1');
    expect(p.policyVersion).toMatch(/^writing-studio-policy\/1/);
  });
  it("voice preview applies the writer's profile and reports hygiene hits; a Spanish sentence gets no English rules", async () => {
    const u = await newUser(db);
    await u.api.put('voice/profile', PROFILE);
    const r = (await u.api.post('voice/preview', { text: 'We utilize data​ in order to learn.' })).data;
    expect(r.replacement).toBe('We use data to learn.');
    expect(r.hygieneRemoved).toBe(1);
    const es = (await u.api.post('voice/preview', { text: 'Utilizamos los datos para aprender, además.' })).data;
    expect(es.noChange).toBe(true);
  });
});
