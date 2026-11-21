import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Runner } from '../driver/runner.js';
import { fullTarget, pageIdentity, retryRead, withDeadline } from '../driver/recovery.js';

test('eight hours of scheduled playback, extended pause, and one write per action', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const hour = 3600000;
  const events = [];
  const progress = [];
  const actions = Array.from({ length: 8 }, (_, i) => ({ d: hour, k: 'type', g: String(i) }));
  const runner = new Runner(actions, { exec: async a => events.push(a.g) },
    { onProgress: elapsed => progress.push(elapsed) }, Date.now);
  const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const finished = runner.run();
  for (let i = 1; i <= 8 * 60; i++) {
    t.mock.timers.tick(60000);
    await drain();
    if (i === 10) {
      runner.pause();
      await drain();
      t.mock.timers.tick(3 * hour);
      await drain();
      assert.equal(events.length, 0);
      runner.resume();
      await drain();
    }
  }
  assert.equal(await finished, true);
  assert.deepEqual(events, ['0','1','2','3','4','5','6','7']);
  assert.equal(runner.elapsed, 8 * hour);
  assert.ok(progress.some(elapsed => elapsed > 0 && elapsed < hour));
  assert.ok(progress.every((value, i) => !i || value >= progress[i - 1]));
});
test('stop during a long wait dispatches no new action', async () => {
  const driver = { exec: () => assert.fail('late write') };
  const runner = new Runner([{ d: 3600000, k: 'type' }], driver);
  const result = runner.run();
  runner.stop();
  assert.equal(await result, false);
});
test('temporary read failures recover with bounded backoff', async () => {
  let calls = 0;
  const delays = [];
  const read = async () => { if (++calls < 3) throw Error('temporary'); return { text: '' }; };
  assert.deepEqual(await retryRead(read, { wait: async ms => delays.push(ms) }), { text: '' });
  assert.deepEqual(delays, [600,1200]);
  await assert.rejects(withDeadline(new Promise(() => {}), 5, 'timed out'), /timed out/);
});
test('recovery preserves surrounding text and separates Google Doc tabs', () => {
  assert.equal(fullTarget({kind:'write',after:'new'},'prefixsuffix',6),'prefixnewsuffix');
  assert.equal(fullTarget({kind:'write',after:'new'},'abc',null),null);
  assert.equal(fullTarget({kind:'edit',after:'replace'},'abc',null),'replace');
  const one='https://docs.google.com/document/d/abc/edit?tab=t.1';
  assert.equal(pageIdentity(one),pageIdentity(one+'#heading=h.foo'));
  assert.notEqual(pageIdentity(one),pageIdentity(one.replace('t.1','t.2')));
});
