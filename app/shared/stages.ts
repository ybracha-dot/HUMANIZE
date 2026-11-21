// Stage model for the assignment shell. Pure and derived: progress comes from persisted material, plan, draft, run and export facts.
// Only genuine choices (resume location, explicit skips, theme) are stored. Resume location is separate from completion.
export const STAGES = ['materials', 'plan', 'draft', 'review', 'export'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { materials: 'Materials', plan: 'Plan', draft: 'Draft', review: 'Review', export: 'Export' };

export interface StageFacts {
  hasInstructions: boolean;
  hasPlan: boolean; // a thesis was chosen or written
  hasDraft: boolean; // a document with words
  reviewDone: boolean; // a run actually finished
  exportDone: boolean; // a download completed successfully
}
export type StageState = 'current' | 'complete' | 'available' | 'unavailable';
export interface StageInfo {
  id: Stage;
  label: string;
  state: StageState;
  /** why an unavailable stage is locked and the shortest real route that unlocks it */
  unlock?: { text: string; to: Stage; action: string };
}

export const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v);

export function stageAvailable(stage: Stage, f: StageFacts): boolean {
  if (stage === 'review' || stage === 'export') return f.hasDraft;
  return true; // Materials, Plan and Draft can always be opened: an experienced student must never be trapped in onboarding
}

export function computeStages(current: Stage, f: StageFacts): StageInfo[] {
  const done: Record<Stage, boolean> = { materials: f.hasInstructions, plan: f.hasPlan, draft: f.hasDraft, review: f.reviewDone, export: f.exportDone };
  return STAGES.map((id) => {
    const available = stageAvailable(id, f);
    const state: StageState = id === current ? 'current' : !available ? 'unavailable' : done[id] ? 'complete' : 'available';
    const info: StageInfo = { id, label: STAGE_LABEL[id], state };
    if (!available) {
      info.unlock = {
        text:
          id === 'review' ? 'Review needs a draft to read. Write one or paste the one you have.' : 'Export needs a draft. Write one or paste the one you have.',
        to: 'draft',
        action: 'Go to Draft',
      };
    }
    return info;
  });
}

/** Where to open: an explicit valid stage in the URL, then the last meaningful location, then the state inferred from what exists. */
export function entryStage(f: StageFacts, urlStage?: string | null, resume?: string | null): Stage {
  if (isStage(urlStage)) return urlStage;
  if (isStage(resume) && stageAvailable(resume, f)) return resume;
  if (f.hasDraft) return 'draft';
  if (f.hasPlan) return 'plan';
  return 'materials';
}

export type FileType = 'syllabus' | 'assignment' | 'rubric' | 'reading';
/** A suggested type from clear filename cues. Anything ambiguous returns null so the student must choose. */
export function suggestType(filename: string): FileType | null {
  const n = filename
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[_\-.]+/g, ' ');
  const hits = new Set<FileType>();
  if (/\bsyllab/.test(n)) hits.add('syllabus');
  if (/\brubric|grading (?:criteria|guide)|scoring guide\b/.test(n)) hits.add('rubric');
  if (/\b(assignment|instructions?|prompt|essay prompt|paper prompt|project brief|handout)\b/.test(n)) hits.add('assignment');
  if (/\b(reading|article|chapter|study|report|journal|paper by|excerpt)\b/.test(n)) hits.add('reading');
  return hits.size === 1 ? [...hits][0] : null;
}
