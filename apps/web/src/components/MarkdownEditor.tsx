import { lazy, Suspense } from 'react';
import type { EditorProps } from './MarkdownEditorImpl';

// CodeMirror is heavy; load it only when an editor is actually shown.
const Impl = lazy(() => import('./MarkdownEditorImpl'));

export function MarkdownEditor(p: EditorProps) {
  return (
    <Suspense
      fallback={
        <textarea
          className="textarea"
          aria-label={p.label}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          style={{ minHeight: p.minHeight ?? 160 }}
        />
      }
    >
      <Impl {...p} />
    </Suspense>
  );
}
