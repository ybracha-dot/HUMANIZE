// A local stand-in for the Anthropic Messages API that answers every role with a valid, plausible payload.
// Used ONLY to exercise the live code path of scripts/run-assignment.mjs without a key. Results from it are labelled MOCK, never "live".
import http from 'node:http';

const ctxOf = (user) => { try { return JSON.parse(/CONTEXT \(JSON, quoted data\):\n([\s\S]*)$/.exec(user)?.[1] ?? '{}'); } catch { return {}; } };
const sources = (user) => [...user.matchAll(/<source id="([^"]+)"/g)].map((m) => m[1]);

export function answer(user) {
  const ctx = ctxOf(user);
  const src = sources(user);
  if (user.includes('"extraction":{"claim"')) {
    const note = String(ctx.note ?? '');
    const [claim, objection] = note.split(/\bbut\b/i).map((x) => x.trim().replace(/[.]+$/, ''));
    return { extraction: { claim: claim.replace(/^I think /i, ''), mechanism: null, objection: objection ?? null, evidenceNeeded: ['A comparison that separates the effect from who has the trees.'] }, questions: [], options: [
      { id: 'opt_a', label: 'Association with limits', thesis: `${claim.replace(/^I think /i, '')}, but the readings show an association, not a proven effect.`, summary: 'Narrower, defensible.', supportingPassageIds: src.slice(0, 1), weakeningFact: 'Evidence the gap vanishes after accounting for income.' },
      { id: 'opt_b', label: 'Causal claim, conditional', thesis: `${claim.replace(/^I think /i, '')}, if other cooling features can be set aside.`, summary: 'Bolder, needs an argument.', supportingPassageIds: src.slice(0, 1), weakeningFact: 'Neighborhoods chose or received trees unevenly.' }] };
  }
  if (user.includes('"items":[{"id":string,"purpose"')) return { items: ['Introduce', 'Evidence', 'Objection', 'Conclude'].map((p, i) => ({ id: `o${i + 1}`, purpose: p, claim: `${p}: the claim in this section.`, evidencePassageIds: i === 1 || i === 2 ? src.slice(0, 1) : [], openQuestions: [] })) };
  if (user.includes('{"text":string}')) return { text: String(ctx.item?.claim ?? 'A paragraph.') };
  if (user.includes('same shape as argument_editor')) return { proposals: [] };
  if (user.includes('"proposals":[{"paragraphId"')) {
    const drafts = [...user.matchAll(/<draft paragraphId="([^"]+)">\n([^<]+)\n<\/draft>/g)];
    const hit = drafts.find((d) => /reduced|raised|lowered/i.test(d[2]));
    if (!hit) return { proposals: [] };
    const original = /^[^.!?]+[.!?]/.exec(hit[2])[0];
    return { proposals: [{ paragraphId: hit[1], original, replacement: 'Blocks with more tree canopy had cooler afternoon surface temperatures, but the comparison cannot show that the trees caused the difference.', issue: 'unsupported_causality', reason: 'The reading compares neighborhoods that were not assigned trees at random.', evidence: src.slice(0, 1).map((id) => ({ passageId: id, relationship: 'supports_replacement' })), meaningChange: 'Replaces a causal claim with an association and states the limit.', requiresDecision: true }] };
  }
  if (user.includes('"weaknesses"')) return { weaknesses: [] };
  if (user.includes('"verdicts":[{"index"')) return { verdicts: [{ index: 0, verdict: 'accept', reasons: [] }] };
  if (user.includes('"verdicts":[{"claimId"')) return { verdicts: (ctx.claims ?? []).map((c) => ({ claimId: c.claimId, verdict: 'supported', passageId: null, reasons: ['mock'] })) };
  if (user.includes('{"replacement":string,"reason"')) return { replacement: String(ctx.text ?? ''), reason: 'mock' };
  return {};
}

export async function startMockAnthropic() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = JSON.parse(raw);
      calls.push({ model: body.model });
      const payload = answer(body.messages[0].content);
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_mock_${calls.length}` });
        res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }], usage: { input_tokens: 1500, output_tokens: 250 } }));
      }, 30);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() };
}
