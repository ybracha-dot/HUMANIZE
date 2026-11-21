export const textToParas = (t: string) =>
  t
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((text, i) => ({ id: `p${i}`, text }));
