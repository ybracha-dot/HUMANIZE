import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import UniqueID from '@tiptap/extension-unique-id';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface Para {
  id: string;
  text: string;
}
export interface Mark {
  paragraphId: string;
  start: number;
  end: number;
  cls: string;
  claimId?: string;
}
export interface Metrics {
  inserted: number;
  deleted: number;
  activeMs: number;
}

export interface EditorHandle {
  getParagraphs(): Para[];
  focusAt(paragraphId: string, offset?: number): void;
  selection(): { paragraphId: string; start: number; end: number } | null;
  cursorParagraph(): string | null;
  takeMetrics(): Metrics;
}

const newId = () => 'p_' + Math.random().toString(36).slice(2, 10);

function toDoc(paras: Para[]) {
  return {
    type: 'doc',
    content: paras.map((p) => ({
      type: 'paragraph',
      attrs: { id: p.id },
      content: p.text ? [{ type: 'text', text: p.text }] : [],
    })),
  };
}
function fromDoc(doc: PMNode): Para[] {
  const out: Para[] = [];
  doc.forEach((node) => {
    if (node.type.name === 'paragraph') out.push({ id: node.attrs.id ?? newId(), text: node.textContent });
  });
  return out;
}

const Marks = Extension.create<{ get: () => Mark[] }>({
  name: 'studioMarks',
  addOptions() {
    return { get: () => [] };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    const build = (doc: PMNode) => {
      const decos: Decoration[] = [];
      const marks = opts.get();
      doc.forEach((node, offset) => {
        if (node.type.name !== 'paragraph') return;
        for (const m of marks.filter((x) => x.paragraphId === node.attrs.id)) {
          const from = offset + 1 + Math.min(m.start, node.content.size);
          const to = offset + 1 + Math.min(m.end, node.content.size);
          if (to > from)
            decos.push(
              Decoration.inline(from, to, {
                class: m.cls,
                ...(m.claimId ? { 'data-claim': m.claimId } : {}),
              }),
            );
        }
      });
      return DecorationSet.create(doc, decos);
    };
    return [
      new Plugin({
        key: new PluginKey('studioMarks'),
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta('studioMarks') ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

interface Props {
  revisionId: string;
  paragraphs: Para[];
  marks: Mark[];
  readOnly?: boolean;
  onDirty: () => void;
  onPaste: (chars: number) => void;
  onClaimClick: (claimId: string) => void;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ revisionId, paragraphs, marks, readOnly, onDirty, onPaste, onClaimClick }, ref) {
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const metrics = useRef<Metrics>({ inserted: 0, deleted: 0, activeMs: 0 });
  const last = useRef(0);
  const dirty = useRef(onDirty);
  dirty.current = onDirty;
  const paste = useRef(onPaste);
  paste.current = onPaste;

  const extensions = useMemo(
    () => [
      // Plain-text schema on purpose: paragraphs only, so what is exported is exactly what was approved.
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        hardBreak: false,
        bold: false,
        italic: false,
        strike: false,
      }),
      UniqueID.configure({
        attributeName: 'id',
        types: ['paragraph'],
        generateID: newId,
      }),
      Marks.configure({ get: () => marksRef.current }),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: toDoc(paragraphs.length ? paragraphs : [{ id: newId(), text: '' }]),
    editable: !readOnly,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Essay editor',
        spellcheck: 'true',
      },
      handlePaste: (_v, e) => {
        paste.current(e.clipboardData?.getData('text/plain').length ?? 0);
        return false;
      },
    },
    onTransaction: ({ transaction: tr }) => {
      if (!tr.docChanged) return;
      const now = Date.now();
      if (last.current) metrics.current.activeMs += Math.min(now - last.current, 5000);
      last.current = now;
      for (const step of tr.steps as any[]) {
        const from = step.from ?? 0;
        const to = step.to ?? 0;
        const size = step.slice?.size ?? 0;
        metrics.current.inserted += size;
        metrics.current.deleted += Math.max(0, to - from);
      }
      if (!tr.getMeta('studioReset')) dirty.current();
    },
  });

  // Load a new revision (accept, restore, switch branch) without treating it as typing.
  useEffect(() => {
    if (!editor) return;
    editor.commands.command(({ tr, dispatch }) => {
      tr.setMeta('studioReset', true);
      dispatch?.(tr);
      return true;
    });
    editor.commands.setContent(toDoc(paragraphs.length ? paragraphs : [{ id: newId(), text: '' }]), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, revisionId]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta('studioMarks', true));
  }, [editor, marks]);

  useImperativeHandle(
    ref,
    () => ({
      getParagraphs: () => (editor ? fromDoc(editor.state.doc) : []),
      focusAt(paragraphId, offset = 0) {
        if (!editor) return;
        let target = -1;
        editor.state.doc.forEach((n, o) => {
          if (n.attrs.id === paragraphId) target = o;
        });
        if (target < 0) {
          editor.commands.focus();
          return;
        }
        const pos = target + 1 + offset;
        editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
      },
      selection() {
        if (!editor) return null;
        const { $from, $to, empty } = editor.state.selection;
        if (empty || $from.parent !== $to.parent) return null;
        return {
          paragraphId: $from.parent.attrs.id,
          start: $from.parentOffset,
          end: $to.parentOffset,
        };
      },
      cursorParagraph() {
        return editor ? (editor.state.selection.$from.parent.attrs.id ?? null) : null;
      },
      takeMetrics() {
        const m = { ...metrics.current };
        metrics.current = { inserted: 0, deleted: 0, activeMs: 0 };
        last.current = 0;
        return m;
      },
    }),
    [editor],
  );

  return (
    <div
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest('[data-claim]');
        if (el) onClaimClick(el.getAttribute('data-claim')!);
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
});
