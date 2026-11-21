// QWERTY neighbors, used to make realistic fat-finger typos.

const NEIGHBORS = {
  q: 'wa', w: 'qeas', e: 'wrsd', r: 'etdf', t: 'ryfg', y: 'tugh', u: 'yihj', i: 'uojk', o: 'iplk', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

export function neighborOf(ch, r) {
  const lower = ch.toLowerCase();
  const options = NEIGHBORS[lower];
  if (!options) return null;
  const pick = options[Math.floor(r() * options.length)];
  return ch === lower ? pick : pick.toUpperCase();
}
