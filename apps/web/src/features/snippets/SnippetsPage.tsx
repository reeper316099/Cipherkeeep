import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Snippet } from '@cipherkeep/shared';
import { BacklinksPanel } from '../../components/BacklinksPanel';
import { MarkdownView } from '../../components/MarkdownView';
import { MasterDetail } from '../../components/MasterDetail';
import { QuickCreate } from '../../components/QuickCreate';
import { SaveBar } from '../../components/SaveBar';
import { copyText } from '../../lib/clipboard';
import { useEntities, useEntityMutations } from '../../lib/entities';
import { useUI } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';

const LANGS = ['bash', 'python', 'javascript', 'powershell', 'sql', 'c', 'text'];

/** Fence long enough that the snippet itself can never close it. */
export function fence(code: string, lang: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

export function SnippetsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data = [], isLoading } = useEntities('snippets');
  const m = useEntityMutations('snippets');
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  const [creating, setCreating] = useState(false);
  const langs = useMemo(() => [...new Set(data.map((s) => s.language))].sort(), [data]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return data
      .filter(
        (s) =>
          !s.archived &&
          (!lang || s.language === lang) &&
          (!n ||
            s.title.toLowerCase().includes(n) ||
            s.tags.some((t) => t.toLowerCase().includes(n)) ||
            (s.code ?? '').toLowerCase().includes(n)),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [data, q, lang]);
  const selected = data.find((s) => s.id === id);
  const move = (d: number) => {
    const i = list.findIndex((s) => s.id === id);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + d))];
    if (next) nav(`/snippets/${next.id}`, { replace: true });
  };
  const create = async (title: string) => {
    const s = await m.create.mutateAsync({ title, language: lang || 'bash', code: '' });
    toast(`Created ${s.title}`);
    nav(`/snippets/${s.id}`);
  };
  return (
    <>
      <MasterDetail
        label="Snippets"
        items={list}
        getId={(s) => s.id}
        selectedId={id}
        onOpen={(s) => nav(`/snippets/${s.id}`)}
        onMove={move}
        tools={
          <>
            <input
              className="input"
              style={{ flex: '1 1 100%' }}
              type="search"
              aria-label="Search snippets"
              placeholder="Search title, tag or code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="select"
              aria-label="Language"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              <option value="">All languages</option>
              {langs.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <button className="btn primary" onClick={() => setCreating(true)}>
              + New snippet
            </button>
          </>
        }
        renderRow={(s) => (
          <>
            <span className="title">{s.title}</span>
            <span className="sub">
              <span className="chip">{s.language}</span>
              {s.filePath && <span title={s.filePath}>📎 file</span>}
              <span>{s.description.slice(0, 60)}</span>
            </span>
          </>
        )}
        empty={
          isLoading ? (
            <div className="empty">Loading…</div>
          ) : (
            <div className="empty">
              <h3>No snippets yet</h3>
              <span>
                Store one-liners and scripts here. They are displayed and copied, never executed.
              </span>
            </div>
          )
        }
        footer={<span>{list.length} snippets</span>}
        detail={
          selected ? (
            <SnippetEditor key={selected.id} snippet={selected} />
          ) : (
            <div className="empty detail-empty">
              <h3>Not found</h3>
            </div>
          )
        }
      />
      {creating && (
        <QuickCreate title="New snippet" onCreate={create} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

function SnippetEditor({ snippet }: { snippet: Snippet }) {
  const nav = useNavigate();
  const m = useEntityMutations('snippets');
  const toast = useUI((s) => s.toast);
  const { draft, set, dirty, reset, markSaved } = useDraft(snippet);
  const [editing, setEditing] = useState(!snippet.code && !snippet.filePath);
  const [confirm, setConfirm] = useState(false);
  const s = draft ?? snippet;
  const bridge = (window as unknown as { cipherkeep?: { revealInFolder?: (p: string) => void } })
    .cipherkeep;
  const save = async () => {
    if (!draft) return;
    const saved = await m.patch.mutateAsync({
      id: draft.id,
      payload: {
        title: draft.title,
        language: draft.language,
        code: draft.code || null,
        filePath: draft.filePath?.trim() || null,
        description: draft.description,
        tags: draft.tags,
      },
    });
    markSaved(saved);
    toast('Saved');
  };
  return (
    <article className="detail" aria-label={`${s.title} snippet`}>
      <header className="detail-head">
        <button
          className="btn ghost icon only-narrow"
          aria-label="Back to list"
          onClick={() => nav('/snippets')}
        >
          ←
        </button>
        <input
          className="input grow"
          style={{ fontSize: 20, fontWeight: 700 }}
          aria-label="Title"
          value={s.title}
          onChange={(e) => set('title', e.target.value)}
        />
        <button
          className="btn"
          onClick={async () =>
            toast((await copyText(s.code ?? '')) ? 'Copied snippet' : 'Copy failed')
          }
          disabled={!s.code}
        >
          Copy
        </button>
        <button className="btn" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </header>
      <div className="grid2">
        <label className="field">
          <span>LANGUAGE</span>
          <input
            className="input"
            list="snip-langs"
            value={s.language}
            onChange={(e) => set('language', e.target.value)}
          />
          <datalist id="snip-langs">
            {LANGS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>TAGS (comma separated)</span>
          <input
            className="input"
            value={s.tags.join(', ')}
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
      </div>
      <label className="field">
        <span>DESCRIPTION</span>
        <input
          className="input"
          value={s.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </label>
      <label className="field">
        <span>LINKED LOCAL FILE (path only; the file is never read or run)</span>
        <span className="rowflex" style={{ flexWrap: 'nowrap' }}>
          <input
            className="input mono"
            value={s.filePath ?? ''}
            onChange={(e) => set('filePath', e.target.value)}
            placeholder="/home/me/scripts/solve.py"
          />
          <button
            className="btn"
            disabled={!bridge?.revealInFolder || !s.filePath}
            title={
              bridge?.revealInFolder ? 'Show in your file manager' : 'Available in the desktop app'
            }
            onClick={() => bridge?.revealInFolder?.(s.filePath!)}
          >
            Reveal in folder
          </button>
        </span>
      </label>
      <section className="stack" style={{ gap: 6 }}>
        <h2>Code</h2>
        {editing ? (
          <textarea
            className="textarea"
            rows={14}
            spellCheck={false}
            aria-label="Code"
            value={s.code ?? ''}
            onChange={(e) => set('code', e.target.value)}
            data-sensitive
          />
        ) : s.code ? (
          <div data-sensitive>
            <MarkdownView source={fence(s.code, s.language === 'text' ? '' : s.language)} />
          </div>
        ) : (
          <span className="faint">No inline code.</span>
        )}
      </section>
      <BacklinksPanel id={snippet.id} />
      <SaveBar
        dirty={dirty}
        saving={m.patch.isPending}
        onSave={() => void save()}
        onRevert={reset}
        onDelete={async () => {
          if (!confirm) return setConfirm(true);
          await m.remove.mutateAsync(snippet.id);
          toast(`Deleted ${snippet.title}`);
          nav('/snippets');
        }}
        extra={confirm ? <span className="muted">Click Delete again to confirm</span> : null}
      />
    </article>
  );
}
