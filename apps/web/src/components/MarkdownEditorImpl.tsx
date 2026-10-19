import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { vim } from '@replit/codemirror-vim';
import { useEffect, useRef } from 'react';

export interface EditorProps {
  value: string;
  onChange(v: string): void;
  vimMode?: boolean;
  onSave?(): void;
  /** Upload a pasted image; resolves to a ck:// URL. */
  onPasteImage?(file: File): Promise<string>;
  minHeight?: number;
  placeholder?: string;
  label: string;
}

const theme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--text)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '13px',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 3px rgb(var(--accent-rgb) / 0.18)',
  },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 12px', caretColor: 'var(--accent)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    background: 'var(--selection) !important',
  },
  '.cm-placeholder': { color: 'var(--text-faint)' },
  '.cm-fat-cursor': {
    background: 'var(--accent) !important',
    color: 'var(--on-accent) !important',
  },
  '.cm-vim-panel': {
    background: 'var(--surface-2)',
    color: 'var(--text)',
    fontFamily: 'var(--mono)',
    padding: '2px 8px',
  },
});

const highlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--accent-text)', fontWeight: '700' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--secondary)' },
  { tag: [t.monospace], color: 'var(--warning)' },
  { tag: [t.quote], color: 'var(--text-muted)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--text-faint)' },
]);

export default function MarkdownEditorImpl(p: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const vimC = useRef(new Compartment());
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: p.value,
        extensions: [
          vimC.current.of(p.vimMode ? vim() : []),
          history(),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave?.(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          EditorView.contentAttributes.of({ 'aria-label': p.label, 'aria-multiline': 'true' }),
          cmPlaceholder(p.placeholder ?? ''),
          EditorView.updateListener.of(
            (u) => u.docChanged && cb.current.onChange(u.state.doc.toString()),
          ),
          EditorView.domEventHandlers({
            paste(e, ev) {
              const file = [...(e.clipboardData?.files ?? [])].find((f) =>
                f.type.startsWith('image/'),
              );
              if (!file || !cb.current.onPasteImage) return false;
              e.preventDefault();
              void cb.current.onPasteImage(file).then((url) => {
                const sel = ev.state.selection.main;
                ev.dispatch({ changes: { from: sel.from, to: sel.to, insert: `![](${url})` } });
              });
              return true;
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== p.value)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: p.value } });
  }, [p.value]);

  useEffect(() => {
    view.current?.dispatch({ effects: vimC.current.reconfigure(p.vimMode ? vim() : []) });
  }, [p.vimMode]);

  return <div ref={host} style={{ minHeight: p.minHeight ?? 160 }} />;
}
