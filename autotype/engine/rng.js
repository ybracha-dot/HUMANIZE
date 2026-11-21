// Small seeded random number generator (mulberry32) plus the distributions the
// engine needs. Seeding keeps a previewed rough draft identical to the one typed.

export function makeRng(seed) {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = next;
  r.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(next() * arr.length)];
  r.chance = (p) => next() < p;
  r.normal = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  // Log-normal with the given mean: right-skewed like real human pauses.
  r.lognormal = (mean, sigma) => (mean <= 0 ? 0 : mean * Math.exp(sigma * r.normal() - (sigma * sigma) / 2));
  r.weighted = (items, weightOf) => {
    let total = 0;
    for (const it of items) total += weightOf(it);
    let x = next() * total;
    for (const it of items) {
      x -= weightOf(it);
      if (x <= 0) return it;
    }
    return items[items.length - 1];
  };
  return r;
}

export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}
