import { createContext, useContext } from 'react';
import type { Stage } from '@shared/stages';
import type { JumpTarget } from '@/components/SourceReader';

export interface Overview {
  assignment: { id: string; title: string; genre: string; courseId: string };
  course: { id: string; name: string };
  isSample: boolean;
  mode: 'demo' | 'live';
  materials: {
    syllabi: any[];
    syllabusChosenId: string | null;
    syllabusSkipped: boolean;
    instructions: any[];
    rubricFiles: any[];
    foundInInstructions: any[];
    foundInRubric: any[];
    readings: any[];
    legacyAttachable: any[];
  };
  brief: any;
  plan: { idea: any; outline: any };
  document: {
    id: string;
    title: string;
    words: number;
    paragraphs: number;
    revisionId: string;
    cause: string;
    label: string | null;
    updatedAt: number;
    branch: string;
  } | null;
  review: { active: any; last: any; lastOutcome: { applied: number; kept: number; open: number; total: number } | null; pending: number; runs: any[] };
  exports: { confirmed: number };
  ui: { resume: { stage: Stage; at: number } | null };
  facts: { hasInstructions: boolean; hasPlan: boolean; hasDraft: boolean; reviewDone: boolean; exportDone: boolean };
  entry: Stage;
  unsupportedClaims: number;
}

export interface OpenSourceOpts {
  onClose?: () => void;
  backLabel?: string;
}
export interface Shell {
  o: Overview;
  reload: () => Promise<void>;
  go: (stage: Stage) => Promise<void>;
  openSource: (t: JumpTarget, opts?: OpenSourceOpts) => void;
  announce: (message: string) => void;
  /** a stage registers what must finish before leaving it (e.g. saving the draft) */
  setLeaveGuard: (fn: (() => Promise<void>) | null) => void;
}

export const ShellContext = createContext<Shell | null>(null);
export function useShell(): Shell {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell outside the assignment shell');
  return s;
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
