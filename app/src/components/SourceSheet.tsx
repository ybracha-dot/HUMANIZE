import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef } from 'react';
import { SourceReader, type JumpTarget } from './SourceReader';

/** Evidence opens here, at the exact quote: a drawer on desktop, a bottom sheet on a phone. Escape or Back closes it and focus returns to where the student was. */
export function SourceSheet({ target, backLabel, onClose }: { target: JumpTarget | null; backLabel: string; onClose: () => void }) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={!!target} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[500px] flex-col overflow-hidden border-l border-rule bg-surface shadow-xl max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-[88vh] max-md:max-w-none max-md:rounded-t-xl max-md:border-l-0 max-md:border-t"
          data-testid="source-sheet"
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            const el = opener.current;
            opener.current = null;
            if (el && el.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <Dialog.Title className="text-base font-semibold">What your source says</Dialog.Title>
            <Dialog.Close className="btn btn-quiet px-2" aria-label="Close source">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{target && <SourceReader target={target} onBack={onClose} backLabel={backLabel} />}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
