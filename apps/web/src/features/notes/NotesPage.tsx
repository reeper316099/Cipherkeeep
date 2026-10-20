import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Note } from '@cipherkeep/shared';
import { BacklinksPanel } from '../../components/BacklinksPanel';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { MarkdownView } from '../../components/MarkdownView';
import { MasterDetail } from '../../components/MasterDetail';
import { QuickCreate } from '../../components/QuickCreate';
import { SaveBar } from '../../components/SaveBar';
import { api } from '../../lib/api';
import { useEntities, useEntity, useEntityMutations } from '../../lib/entities';
import { buildFolderTree, inFolder, type FolderNode } from '../../lib/folders';
import { useSettings } from '../../lib/queries';
import { useDraft } from '../../lib/useDraft';
import { useUI } from '../../lib/store';

function Tree({
  node,
  selected,
  onSelect,
  depth = 0,
}: {
  node: FolderNode;
  selected: string;
  onSelect(p: string): void;
  depth?: number;
}) {
  return (
    <>
      {node.children.map((c) => (
        <div key={c.path}>
          <button
            className="folder-btn"
            aria-pressed={selected === c.path}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => onSelect(selected === c.path ? '' : c.path)}
          >
            📁 {c.name} <span className="faint">{c.count}</span>
          </button>
          <Tree node={c} selected={selected} onSelect={onSelect} depth={depth + 1} />
        </div>
      ))}
    </>
  );
}

export function NotesPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data = [], isLoading } = useEntities('notes');
  const m = useEntityMutations('notes');
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [creating, setCreating] = useState(false);

  const live = useMemo(() => data.filter((n) => !n.archived), [data]);
  const tree = useMemo(() => buildFolderTree(live.map((n) => n.folder)), [live]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return live
      .filter(
        (x) =>
          inFolder(x.folder, folder) &&
          (!n ||
            x.title.toLowerCase().includes(n) ||
            x.tags.some((t) => t.toLowerCase().includes(n))),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [live, q, folder]);
  const selected = data.find((n) => n.id === id);
  const move = (d: number) => {
    const i = list.findIndex((n) => n.id === id);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + d))];
    if (next) nav(`/notes/${next.id}`, { replace: true });
  };
  const create = async (title: string) => {
    const n = await m.create.mutateAsync({ title, folder, markdown: `# ${title}\n\n` });
    toast(`Created ${n.title}`);
    nav(`/notes/${n.id}`);
  };

  return (
    <>
      <MasterDetail
        label="Notes"
        items={list}
        getId={(n) => n.id}
        selectedId={id}
        onOpen={(n) => nav(`/notes/${n.id}`)}
        onMove={move}
        tools={
          <>
            <input
              className="input"
              style={{ flex: '1 1 100%' }}
              type="search"
              aria-label="Search notes"
              placeholder="Search notes and tags…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn primary" onClick={() => setCreating(true)}>
              + New note{folder ? ` in ${folder}` : ''}
            </button>
            {folder && (
              <button className="btn ghost" onClick={() => setFolder('')}>
                All folders
              </button>
            )}
            <div className="tree" role="group" aria-label="Folders">
              <button
                className="folder-btn"
                aria-pressed={folder === ''}
                onClick={() => setFolder('')}
              >
                🗂 All notes <span className="faint">{live.length}</span>
              </button>
              <Tree node={tree} selected={folder} onSelect={setFolder} />
            </div>
          </>
        }
        renderRow={(n) => (
          <>
            <span className="title">{n.title}</span>
            <span className="sub">
              <span className="chip">{n.kind}</span>
              <span>{n.folder || '(root)'}</span>
              {n.favorite && <span style={{ color: 'var(--warning)' }}>★</span>}
            </span>
          </>
        )}
        empty={
          isLoading ? (
            <div className="empty">Loading…</div>
          ) : (
            <div className="empty">
              <h3>No notes here</h3>
              <span>Cheat sheets, guides and writeup notes live here as Markdown files.</span>
            </div>
          )
        }
        footer={<span>{list.length} notes</span>}
        detail={
          selected ? (
            <NoteLoader key={selected.id} id={selected.id} />
          ) : (
            <div className="empty detail-empty">
              <h3>Not found</h3>
            </div>
          )
        }
      />
      {creating && (
        <QuickCreate
          title={`New note${folder ? ` in ${folder}` : ''}`}
          onCreate={create}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function NoteLoader({ id }: { id: string }) {
  const { data, isError } = useEntity('notes', id);
  if (data) return <NoteEditor note={data} />;
  return (
    <div className="empty detail-empty">
      <h3>{isError ? 'Could not load this note' : 'Loading…'}</h3>
    </div>
  );
}

function NoteEditor({ note }: { note: Note }) {
  const nav = useNavigate();
  const m = useEntityMutations('notes');
  const toast = useUI((s) => s.toast);
  const settings = useSettings();
  const all = useEntities('notes');
  const { draft, set, dirty, reset, markSaved } = useDraft(note);
  const [view, setView] = useState<'split' | 'edit' | 'preview'>('split');
  const [confirm, setConfirm] = useState(false);
  const n = draft ?? note;
  const folders = useMemo(
    () => [...new Set((all.data ?? []).map((x) => x.folder))].sort(),
    [all.data],
  );

  const save = async () => {
    if (!draft) return;
    const saved = await m.patch.mutateAsync({
      id: draft.id,
      payload: {
        title: draft.title,
        folder: draft.folder,
        markdown: draft.markdown,
        tags: draft.tags,
        kind: draft.kind,
        favorite: draft.favorite,
        category: draft.category,
      },
    });
    markSaved(saved);
    toast('Saved');
  };
  const pasteImage = async (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name || 'pasted.png');
    return (await api<{ url: string }>('/attachments', { method: 'POST', body: form })).url;
  };

  return (
    <article className="detail" aria-label={`${n.title} note`}>
      <header className="detail-head">
        <button
          className="btn ghost icon only-narrow"
          aria-label="Back to list"
          onClick={() => nav('/notes')}
        >
          ←
        </button>
        <input
          className="input grow"
          style={{ fontSize: 20, fontWeight: 700 }}
          aria-label="Title"
          value={n.title}
          onChange={(e) => set('title', e.target.value)}
        />
        <button
          className="btn icon"
          aria-pressed={n.favorite}
          aria-label="Favourite"
          onClick={() => set('favorite', !n.favorite)}
        >
          {n.favorite ? '★' : '☆'}
        </button>
        <div className="seg" role="group" aria-label="View">
          {(['edit', 'split', 'preview'] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
      </header>
      <div className="grid2">
        <label className="field">
          <span>FOLDER</span>
          <input
            className="input"
            list="note-folders"
            value={n.folder}
            onChange={(e) => set('folder', e.target.value)}
            placeholder="e.g. guides/networking"
          />
          <datalist id="note-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>KIND</span>
          <select
            className="select"
            style={{ width: '100%' }}
            value={n.kind}
            onChange={(e) => set('kind', e.target.value as Note['kind'])}
          >
            {['general', 'cheatsheet', 'guide', 'writeup-notes'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>TAGS (comma separated)</span>
        <input
          className="input"
          value={n.tags.join(', ')}
          onChange={(e) =>
            set(
              'tags',
              e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      <div className={view === 'split' ? 'editor-split' : ''} data-sensitive>
        {view !== 'preview' && (
          <MarkdownEditor
            label="Note body"
            value={n.markdown}
            onChange={(v) => set('markdown', v)}
            vimMode={settings.data?.vimMode}
            onSave={() => void save()}
            onPasteImage={pasteImage}
            minHeight={320}
            placeholder="Markdown. Link with [[Title]] or [[cmd:ls]]. Paste an image to attach it."
          />
        )}
        {view !== 'edit' && (
          <div className="preview">
            <MarkdownView source={n.markdown} />
          </div>
        )}
      </div>
      <BacklinksPanel id={note.id} />
      <SaveBar
        dirty={dirty}
        saving={m.patch.isPending}
        onSave={() => void save()}
        onRevert={reset}
        onDelete={async () => {
          if (!confirm) return setConfirm(true);
          await m.remove.mutateAsync(note.id);
          toast(`Deleted ${note.title}`);
          nav('/notes');
        }}
        extra={confirm ? <span className="muted">Click Delete again to confirm</span> : null}
      />
    </article>
  );
}
