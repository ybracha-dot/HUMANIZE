// Plays a keystroke plan in real time with pause, resume and stop. Timing runs
// on a timeline, so small delays never pile up into drift, and a slow moment
// never turns into a burst of catch-up typing.

export class Runner {
  constructor(actions, driver, hooks = {}, now = () => performance.now()) {
    this.now = now;
    this.actions = actions;
    this.driver = driver;
    this.hooks = hooks;
    this.paused = false;
    this.stopped = false;
    this.total = actions.reduce((n, a) => n + a.d, 0);
    this.elapsed = 0;
    this.index = 0;
    this.clock = 0;
    this.pausePromise = null;
    this.resolvePause = null;
    this.wake = null;
  }

  pause(reason) {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.pausePromise = new Promise((res) => {
      this.resolvePause = res;
    });
    this.wake?.();
    this.hooks.onPause?.(true, reason);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    const res = this.resolvePause;
    this.resolvePause = null;
    res?.();
    this.hooks.onPause?.(false);
  }

  stop() {
    this.stopped = true;
    if (this.paused) this.resume();
    this.wake?.();
  }

  async waitForClock(duration) {
    for (;;) {
      if (this.stopped) return;
      if (this.paused) {
        const t0 = this.now();
        const pause = this.pausePromise;
        try { await this.driver.releaseKeys?.(); } catch { /* tab may have closed */ }
        await pause;
        this.clock += this.now() - t0;
        continue;
      }
      const left = this.clock - this.now();
      if (left <= 0) {
        if (left < -300) this.clock = this.now();
        return;
      }
      if (left > 950) {
        const partial = Math.max(0, duration - left);
        this.hooks.onProgress?.(this.elapsed + partial, this.total);
      }
      await new Promise((res) => {
        const id = setTimeout(res, Math.min(left, 1000));
        this.wake = () => {
          clearTimeout(id);
          res();
        };
      });
      this.wake = null;
    }
  }

  async run() {
    this.clock = this.now();
    try {
      for (this.index = 0; this.index < this.actions.length; this.index++) {
        const a = this.actions[this.index];
        if (a.s) this.hooks.onStatus?.(a.s, a);
        this.clock += a.d;
        await this.waitForClock(a.d);
        if (this.stopped) break;
        if (a.check) {
          // Reread the page. If something's wrong, the check hands back the
          // keystrokes that fix it, and they run next. (Time spent checking
          // comes out of the pause that follows, so nothing bursts.)
          const extra = await this.hooks.onCheck?.(a);
          if (this.stopped) break;
          if (extra?.length) {
            this.actions.splice(this.index + 1, 0, ...extra);
            this.total += extra.reduce((n, x) => n + x.d, 0);
          }
          this.elapsed += a.d;
          this.hooks.onProgress?.(this.elapsed, this.total);
          continue;
        }
        if (a.k) await this.driver.exec(a);
        if (a.ev) this.hooks.onEvent?.(a.ev);
        this.elapsed += a.d;
        this.hooks.onProgress?.(this.elapsed, this.total);
      }
    } finally {
      try {
        await this.driver.releaseKeys?.();
      } catch {
        /* ignore */
      }
    }
    return !this.stopped;
  }
}
