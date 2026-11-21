// Semantic design tokens. Every colour is a CSS variable holding an "r g b" triplet so Tailwind opacity modifiers still work.
// The legacy palette names (stone, amber, orange, red, emerald, violet) are remapped onto the same tokens, so older screens
// follow the active theme instead of carrying hard-coded colours.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (prefix, steps) => Object.fromEntries(steps.map((s) => [s, v(`${prefix}-${s}`)]));

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: v('page'),
        paper: v('page'),
        surface: v('surface'),
        ink: v('ink'),
        ink2: v('ink2'),
        accent: v('accent'),
        'accent-ink': v('accent-ink'),
        rule: v('rule'),
        edge: v('edge'),
        tint: v('tint'),
        ok: v('ok'),
        'ok-bg': v('ok-bg'),
        warn: v('warn'),
        'warn-bg': v('warn-bg'),
        err: v('err'),
        'err-bg': v('err-bg'),
        stone: scale('stone', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        amber: scale('warn', [50, 100, 200, 300, 700, 800, 900]),
        orange: scale('warn', [50, 100, 200, 300, 700, 800, 900]),
        red: scale('err', [50, 100, 200, 300, 700, 800, 900]),
        emerald: scale('ok', [50, 100, 200, 300, 700, 800, 900]),
        violet: scale('info', [50, 100, 200, 300, 700, 800, 900]),
      },
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        serif: ['Spectral', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
      maxWidth: { measure: '68ch', desk: '1040px' },
    },
  },
  plugins: [],
};
