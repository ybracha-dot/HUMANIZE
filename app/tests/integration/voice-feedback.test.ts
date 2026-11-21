import { describe, expect, it } from 'vitest';
import { freshDb, newUser } from './helpers.ts';

describe('voice profile: same idea in two registers; meaning survives', () => {
  const { db } = freshDb('voice');
  const SRC = 'Moreover, management expects the program to save about $3 million annually after full rollout (Lee 4) — "a quiet revolution," as Miller calls it. The sample did not show a statistically significant increase.';
  it('direct/no-em-dash vs formal profile both keep units, quotes, citations and qualifiers; only wording and punctuation differ', async () => {
    const u = await newUser(db);
    const direct = await u.api.put('voice/profile', { directness: 'direct', firstPerson: 'allow', avoidEmDash: true, preferredTerms: {}, openings: [], language: 'auto', notes: '', confirmed: {} });
    expect(direct.status).toBe(200);
    const a = (await u.api.post('voice/preview', { text: SRC })).data;
    await u.api.put('voice/profile', { directness: 'formal', firstPerson: 'avoid', avoidEmDash: false, preferredTerms: {}, openings: [], language: 'auto', notes: '', confirmed: {} });
    const b = (await u.api.post('voice/preview', { text: SRC })).data;
    for (const r of [a, b]) {
      expect(r.replacement).toContain('$3 million');
      expect(r.replacement).toContain('(Lee 4)');
      expect(r.replacement).toContain('"a quiet revolution,"');
      expect(r.replacement).toContain('statistically significant');
      expect(r.replacement).toContain('about');
      expect(r.replacement).toContain('annually');
      expect(r.meaning.material).toEqual([]);
    }
    expect(a.replacement).not.toContain('—');
    expect(b.replacement).toContain('—'); // the formal profile has no em-dash preference
    expect(a.replacement).not.toBe(b.replacement);
    expect(a.policyVersion).toMatch(/writing-studio-policy/);
  });
  it('a Spanish composition is not rewritten with English rules, and accents survive', async () => {
    const u = await newUser(db);
    await u.api.put('voice/profile', { directness: 'direct', firstPerson: 'allow', avoidEmDash: false, preferredTerms: {}, openings: [], language: 'auto', notes: '', confirmed: {} });
    const t = 'Además, la educación es muy importante para todos los niños de mi ciudad. En mi familia, mi abuela me enseñó a leer.';
    const r = (await u.api.post('voice/preview', { text: t })).data;
    expect(r.noChange).toBe(true);
    expect(r.replacement).toBe(t);
  });
  it('hygiene removes invisible characters but keeps an emoji joiner and Hebrew marks', async () => {
    const u = await newUser(db);
    const t = 'Clean​ text 👩‍💻 ‏שלום‏ and the end.';
    const r = (await u.api.post('voice/preview', { text: t })).data;
    expect(r.hygiene.filter((h: any) => h.verdict === 'remove')).toHaveLength(1);
    expect(r.hygiene.filter((h: any) => h.verdict === 'keep').length).toBeGreaterThanOrEqual(3);
  });
  it('profile calibration needs at most three samples and previews a real sentence of the writer', async () => {
    const u = await newUser(db);
    const add = (text: string) => u.api.post('voice/samples', { text, genre: 'memo', language: 'en', audience: 'class', register: 'plain' });
    expect((await add('I think the plan works — mostly. We should test it first. It is short and plain enough to read.')).status).toBe(200);
    await add('Second sample paragraph that is long enough to be accepted by the server here.');
    await add('Third sample paragraph that is long enough to be accepted by the server there.');
    expect((await add('Fourth sample paragraph that is long enough to be accepted by the server again.')).status).toBe(409);
    const s = (await u.api.post('voice/suggest')).data;
    expect(s.previews[0].hasExample).toBe(true);
    expect(s.previews[0].sample).toContain('—');
    expect(s.previews[0].proposed).not.toContain('—');
    expect(s.profile.confirmed).toEqual({}); // nothing applied until the writer confirms
  });
});

describe('course feedback memory is scoped and confirmed', () => {
  const { db } = freshDb('feedback');
  it('a comment is reusable only after it is confirmed recurring, only inside its course; a rejected suggestion creates no rule', async () => {
    const u = await newUser(db);
    const c1 = (await u.api.post('courses', { name: 'Course A', instructor: 'Prof A' })).data;
    const c2 = (await u.api.post('courses', { name: 'Course B', instructor: 'Prof B' })).data;
    const fb = (await u.api.post(`courses/${c1.id}/feedback`, { comment: 'Always state your thesis in the first sentence.', explanation: 'Applied to the paper on tariffs only.' })).data;
    expect(fb.scope).toBe('one_off');
    expect((await u.api.get(`courses/${c1.id}`)).data.preferences).toEqual([]); // unconfirmed
    await u.api.put(`feedback/${fb.id}`, { scope: 'recurring' });
    expect((await u.api.get(`courses/${c1.id}`)).data.preferences).toHaveLength(1);
    expect((await u.api.get(`courses/${c2.id}`)).data.preferences).toEqual([]); // no leak into another course
    const fb2 = (await u.api.post(`courses/${c1.id}/feedback`, { comment: 'Too informal here.' })).data;
    await u.api.put(`feedback/${fb2.id}`, { scope: 'irrelevant' });
    expect((await u.api.get(`courses/${c1.id}`)).data.preferences).toHaveLength(1);
    const seed = await u.api.post('demo/seed');
    const d = await u.api.post(`assignments/${seed.data.assignmentId}/document`, { text: 'Moreover, the plan is fine.' });
    const { waitRun } = await import('./helpers.ts');
    await waitRun(u.api, db, (await u.api.post(`documents/${d.data.documentId}/runs`, { mode: 'quick' })).data.runId);
    const p = (await u.api.get(`documents/${d.data.documentId}/proposals?decision=pending`)).data[0];
    await u.api.post(`proposals/${p.id}/decision`, { action: 'reject', idempotencyKey: 'fb-reject-1' });
    const all = (await u.api.get(`courses/${seed.data.courseId}`)).data;
    expect(all.preferences).toEqual([]);
    expect(all.feedback).toEqual([]); // a single rejection is not evidence of a style rule
  });
});
