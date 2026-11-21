// Recovery stores the intended result. A new plan starts from what the editor
// actually contains, since a timed-out keypress may already have been applied.
export const RECORD_PREFIX = 'autotype.recovery.';
export function pageIdentity(raw) {
  const url = new URL(raw);
  const doc = url.hostname === 'docs.google.com' && url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (doc) return 'docs:' + doc[1] + ':' + (url.searchParams.get('tab') || '');
  return url.href;
}

export function fullTarget(job, baseline, offset) {
  if (job.kind === 'edit') return job.after;
  if (!Number.isInteger(offset) || offset < 0 || offset > baseline.length) return null;
  return baseline.slice(0, offset) + job.after + baseline.slice(offset);
}

export function withDeadline(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export async function retryRead(read, { attempts = 3, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), notify = () => {} } = {}) {
  for (let n = 0; n < attempts; n++) {
    if (n) { notify(n); await wait(600 * 2 ** (n - 1)); }
    const result = await Promise.resolve().then(read).catch(() => null);
    if (typeof result?.text === 'string') return result;
    if (result?.permanent) return null;
  }
  return null;
}
