import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Project } from '@cipherkeep/shared';
import { BacklinksPanel } from '../../components/BacklinksPanel';
import { EntityPicker } from '../../components/EntityPicker';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { MarkdownView } from '../../components/MarkdownView';
import { MasterDetail } from '../../components/MasterDetail';
import { openExternal } from '../../components/MarkdownView';
import { QuickCreate } from '../../components/QuickCreate';
import { SaveBar } from '../../components/SaveBar';
import { useEntities, useEntityMutations } from '../../lib/entities';
import { useSettings } from '../../lib/queries';
import { useUI } from '../../lib/store';
import { useDraft } from '../../lib/useDraft';

const STATUSES = ['Not started', 'In progress', 'Done'] as const;
const isHttp = (u?: string) => !!u && /^https?:\/\//i.test(u);

export function ProjectsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data = [], isLoading } = useEntities('projects');
  const m = useEntityMutations('projects');
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useMemo(
    () =>
      data
        .filter(
          (p) =>
            !p.archived &&
            (!status || p.status === status) &&
            (!q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase())),
        )
        .sort((a, b) => a.title.localeCompare(b.title)),
    [data, q, status],
  );
  const selected = data.find((p) => p.id === id);
  const move = (d: number) => {
    const i = list.findIndex((p) => p.id === id);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + d))];
    if (next) nav(`/projects/${next.id}`, { replace: true });
  };
  const create = async (title: string) => {
    const p = await m.create.mutateAsync({ title, type: 'Script', category: 'Script' });
    toast(`Created ${p.title}`);
    nav(`/projects/${p.id}`);
  };
  return (
    <>
      <MasterDetail
        label="Projects"
        items={list}
        getId={(p) => p.id}
        selectedId={id}
        onOpen={(p) => nav(`/projects/${p.id}`)}
        onMove={move}
        tools={
          <>
            <input
              className="input"
              style={{ flex: '1 1 100%' }}
              type="search"
              aria-label="Search projects"
              placeholder="Search projects…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="select"
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button className="btn primary" onClick={() => setCreating(true)}>
              + New project
            </button>
          </>
        }
        renderRow={(p) => (
          <>
            <span className="title">{p.title}</span>
            <span className="sub">
              <span className="chip">{p.type}</span>
              <span>{p.status}</span>
              {p.skillsUsed.length > 0 && <span>· {p.skillsUsed.slice(0, 3).join(', ')}</span>}
            </span>
          </>
        )}
        empty={
          isLoading ? (
            <div className="empty">Loading…</div>
          ) : (
            <div className="empty">
              <h3>No projects yet</h3>
              <span>Websites, tools and scripts you’re building.</span>
            </div>
          )
        }
        footer={<span>{list.length} projects</span>}
        detail={
          selected ? (
            <ProjectEditor key={selected.id} project={selected} />
          ) : (
            <div className="empty detail-empty">
              <h3>Not found</h3>
            </div>
          )
        }
      />
      {creating && (
        <QuickCreate
          title="New project"
          label="Name"
          onCreate={create}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function ProjectEditor({ project }: { project: Project }) {
  const nav = useNavigate();
  const m = useEntityMutations('projects');
  const toast = useUI((s) => s.toast);
  const settings = useSettings();
  const { draft, set, dirty, reset, markSaved } = useDraft(project);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const p = draft ?? project;
  const save = async () => {
    if (!draft) return;
    const repo = draft.repoUrl?.trim();
    if (repo && !isHttp(repo))
      return void toast('Repository link must start with http:// or https://', { kind: 'error' });
    const saved = await m.patch.mutateAsync({
      id: draft.id,
      payload: {
        title: draft.title,
        type: draft.type,
        category: draft.type,
        status: draft.status,
        skillsUsed: draft.skillsUsed,
        conceptIds: draft.conceptIds,
        repoUrl: repo || undefined,
        notes: draft.notes,
        tags: draft.tags,
      },
    });
    markSaved(saved);
    toast('Saved');
  };
  return (
    <article className="detail" aria-label={`${p.title} project`}>
      <header className="detail-head">
        <button
          className="btn ghost icon only-narrow"
          aria-label="Back to list"
          onClick={() => nav('/projects')}
        >
          ←
        </button>
        <input
          className="input grow"
          style={{ fontSize: 20, fontWeight: 700 }}
          aria-label="Name"
          value={p.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </header>
      <div className="rowflex">
        <div className="field">
          <span>TYPE</span>
          <div className="seg" role="group" aria-label="Type">
            {['Website', 'Tool', 'Script'].map((t) => (
              <button key={t} aria-pressed={p.type === t} onClick={() => set('type', t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>STATUS</span>
          <div className="seg" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button key={s} aria-pressed={p.status === s} onClick={() => set('status', s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="field">
        <span>SKILLS USED (comma separated)</span>
        <input
          className="input"
          value={p.skillsUsed.join(', ')}
          onChange={(e) =>
            set(
              'skillsUsed',
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      <EntityPicker
        collection="concepts"
        label="RELATED CONCEPTS"
        value={p.conceptIds}
        onChange={(v) => set('conceptIds', v)}
      />
      <label className="field">
        <span>REPOSITORY LINK</span>
        <span className="rowflex" style={{ flexWrap: 'nowrap' }}>
          <input
            className="input"
            value={p.repoUrl ?? ''}
            onChange={(e) => set('repoUrl', e.target.value)}
            placeholder="https://…"
          />
          {isHttp(p.repoUrl) && (
            <button className="btn" onClick={() => openExternal(p.repoUrl!)}>
              Open
            </button>
          )}
        </span>
      </label>
      <section className="stack" style={{ gap: 6 }}>
        <div className="rowflex" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Notes</h2>
          <button className="btn" onClick={() => setPreview(!preview)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="preview card" style={{ padding: 12 }}>
            <MarkdownView source={p.notes} />
          </div>
        ) : (
          <MarkdownEditor
            label="Project notes"
            value={p.notes}
            onChange={(v) => set('notes', v)}
            vimMode={settings.data?.vimMode}
            onSave={() => void save()}
            minHeight={160}
          />
        )}
      </section>
      <BacklinksPanel id={project.id} />
      <SaveBar
        dirty={dirty}
        saving={m.patch.isPending}
        onSave={() => void save()}
        onRevert={reset}
        onDelete={async () => {
          if (!confirm) return setConfirm(true);
          await m.remove.mutateAsync(project.id);
          toast(`Deleted ${project.title}`);
          nav('/projects');
        }}
        extra={confirm ? <span className="muted">Click Delete again to confirm</span> : null}
      />
    </article>
  );
}
