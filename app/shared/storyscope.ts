// Placeholder replaced in M4 by the manifest-driven narrative checks.
import type { Para } from './proposals.ts';
export function checkNarrative(_paragraphs: Para[], genre: string) {
  return { genre, applicable: false, checks: [] as { id: string; message: string; quote: string }[] };
}
