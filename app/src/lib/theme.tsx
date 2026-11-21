import { useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'studio.theme';

/** Light is the first-visit default, even on a dark OS. An explicit saved choice always wins. */
export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage blocked: fall back to light */
  }
  return 'light';
}

export function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export function ThemeControl() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [pref]);
  const choose = (p: ThemePref) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* ignore */
    }
  };
  return (
    <>
      <label className="flex items-center gap-2 text-sm md:hidden">
        <span className="text-ink2">Theme</span>
        <select
          className="input !min-h-[40px] !w-auto"
          value={pref}
          onChange={(e) => choose(e.target.value as ThemePref)}
          aria-label="Colour theme"
          data-testid="theme-select"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className="hidden overflow-hidden rounded-md border border-edge text-sm md:inline-flex"
        data-testid="theme-control"
      >
        {(['light', 'dark', 'system'] as const).map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={pref === p}
            onClick={() => choose(p)}
            className={`min-h-[36px] px-3 capitalize ${pref === p ? 'bg-tint font-semibold text-ink' : 'bg-surface text-ink2 hover:bg-tint'}`}
            data-testid={`theme-${p}`}
          >
            {p}
          </button>
        ))}
      </div>
    </>
  );
}
