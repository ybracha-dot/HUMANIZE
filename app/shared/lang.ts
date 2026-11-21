// Very small language guess used to decide whether a claim and a passage can be compared lexically.
export type Lang = 'en' | 'es' | 'he' | 'other';
export function detectLanguage(text: string): Lang {
  if (/[\u0590-\u05FF]/.test(text) && (text.match(/[\u0590-\u05FF]/g)?.length ?? 0) > text.length * 0.2) return 'he';
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (set: string[]) => words.filter((w) => set.includes(w)).length;
  const en = score(['the', 'and', 'of', 'to', 'is', 'in', 'that', 'was', 'for', 'with', 'are', 'it', 'were', 'by', 'on', 'at', 'from', 'than', 'had', 'has']);
  const es = score(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'es', 'en', 'un', 'una', 'por', 'con', 'para', 'mi', 'su', 'del', 'al', 'fue', 'se', 'no']);
  if (!words.length) return 'other';
  if (es > en && es >= 2) return 'es';
  if (en >= 2) return 'en';
  return 'other';
}
