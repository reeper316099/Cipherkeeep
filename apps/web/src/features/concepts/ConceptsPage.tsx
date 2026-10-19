import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Concept } from '@cipherkeep/shared';
import { BacklinksPanel } from '../../components/BacklinksPanel';
import { EntityPicker } from '../../components/EntityPicker';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { MarkdownView } from '../../components/MarkdownView';
import { MasterDetail } from '../../components/MasterDetail';
import { QuickCreate } from '../../components/QuickCreate';
import { SaveBar } from '../../components/SaveBar';
import { api } from '../../lib/api';
import {
  countOpen,
  INTUITION_KEY,
  isBlank,
  missingSections,
  parseQuestions,
  QUESTIONS_KEY,
  toggleQuestion,
  type TemplateSection,
} from '../../lib/concepts';
import { useEntities, useEntityMutations } from '../../lib/entities';
import { useSettings } from '../../lib/queries';
import { useDraft } from '../../lib/useDraft';
import { useUI } from '../../lib/store';

const CONF = ['Unsure', 'Shaky', 'Comfortable', 'Solid'];

function Dots({ n }: { n: number }) {
  return (
    <span className="dots" role="img" aria-label={`Confidence ${n} of 3`}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  );
}

function useTemplate() {
  return useQuery({
    queryKey: ['template', 'concepts'],
    queryFn: () => api<{ sections: TemplateSection[] }>('/templates/concepts'),
    staleTime: 60_000,
  });
}

export function ConceptsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data = [], isLoading } = useEntities('concepts');
  const m = useEntityMutations('concepts');
  const tpl = useTemplate();
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [creating, setCreating] = useState(false);

  const cats = useMemo(
    () => [...new Set(data.map((c) => c.category).filter(Boolean))].sort(),
    [data],
  );
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return data.filter(
      (c) =>
        !c.archived &&
        (!cat || c.category === cat) &&
        (!n ||
          c.title.toLowerCase().includes(n) ||
          c.tags.some((t) => t.toLowerCase().includes(n))),
    );
  }, [data, q, cat]);
  const selected = data.find((c) => c.id === id);
  const move = (d: number) => {
    const i = list.findIndex((c) => c.id === id);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + d))];
    if (next) nav(`/concepts/${next.id}`, { replace: true });
  };

  const create = async (title: string) => {
    const sections = (tpl.data?.sections ?? []).map((s) => ({
      key: s.key,
      title: s.title,
      markdown: '',
    }));
    const c = await m.create.mutateAsync({ title, category: cat || 'General', sections });
    toast(`Created ${c.title}`);
    nav(`/concepts/${c.id}`);
  };

  return (
    <>
      <MasterDetail
        label="Concepts"
        items={list}
        getId={(c) => c.id}
        selectedId={id}
        onOpen={(c) => nav(`/concepts/${c.id}`)}
        onMove={move}
        tools={
          <>
            <input
              className="input"
              style={{ flex: '1 1 100%' }}
              type="search"
              aria-label="Search concepts"
              placeholder="Search concepts or tags…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="select"
              aria-label="Category"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
            >
              <option value="">All categories</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button className="btn primary" onClick={() => setCreating(true)}>
              + New concept
            </button>
          </>
        }
        renderRow={(c) => (
          <>
            <span className="title">{c.title}</span>
            <span className="sub">
              <span>{c.category || '—'}</span>
              <span>· {c.difficulty}</span>
              {c.questionsOpen > 0 && (
                <span style={{ color: 'var(--warning)' }}>· {c.questionsOpen} open ?</span>
              )}
              <span style={{ marginLeft: 'auto' }}>
                <Dots n={c.confidence} />
              </span>
            </span>
          </>
        )}
        empty={
          isLoading ? (
            <div className="empty">Loading…</div>
          ) : (
            <div className="empty">
              <h3>No concepts yet</h3>
              <span>Create one from your template, or import your Notion export.</span>
            </div>
          )
        }
        footer={<span>{list.length} concepts</span>}
        detail={
          selected ? (
            <ConceptDetail
              key={selected.id}
              concept={selected}
              template={tpl.data?.sections ?? []}
            />
          ) : (
            <div className="empty detail-empty">
              <h3>Not found</h3>
            </div>
          )
        }
      />
      {creating && (
        <QuickCreate
          title="New concept"
          label="Name"
          onCreate={create}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function ConceptDetail({ concept, template }: { concept: Concept; template: TemplateSection[] }) {
  const [mode, setMode] = useState<'read' | 'edit' | 'teach'>('read');
  const nav = useNavigate();
  const m = useEntityMutations('concepts');
  const toast = useUI((s) => s.toast);
  const settings = useSettings();
  const { draft, set, dirty, reset, markSaved } = useDraft(concept);
  const commands = useEntities('commands');
  const cmdById = useMemo(
    () => new Map((commands.data ?? []).map((c) => [c.id, c])),
    [commands.data],
  );
  const all = useEntities('concepts');
  const byId = useMemo(() => new Map((all.data ?? []).map((c) => [c.id, c])), [all.data]);
  const [revealed, setRevealed] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const c = draft ?? concept;
  const save = async () => {
    if (!draft) return;
    const questions = draft.sections.find((s) => s.key === QUESTIONS_KEY);
    const saved = await m.patch.mutateAsync({
      id: draft.id,
      payload: {
        title: draft.title,
        category: draft.category,
        difficulty: draft.difficulty,
        tags: draft.tags,
        sections: draft.sections,
        relatedCommandIds: draft.relatedCommandIds,
        relatedConceptIds: draft.relatedConceptIds,
        confidence: draft.confidence,
        questionsOpen: questions ? countOpen(questions.markdown) : draft.questionsOpen,
      },
    });
    markSaved(saved);
    toast('Saved');
  };
  useEffect(() => {
    if (mode !== 'edit') return;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const setSection = (key: string, markdown: string) =>
    set(
      'sections',
      c.sections.map((s) => (s.key === key ? { ...s, markdown } : s)),
    );
  const quick = async (patch: Record<string, unknown>) =>
    void (await m.patch.mutateAsync({ id: concept.id, payload: patch }));
  const questions = c.sections.find((s) => s.key === QUESTIONS_KEY);
  const intuition = c.sections.find((s) => s.key === INTUITION_KEY);
  const missing = missingSections(c.sections, template);

  const toggleQ = (line: number) => {
    if (!questions) return;
    const md = toggleQuestion(questions.markdown, line);
    void quick({
      sections: c.sections.map((s) => (s.key === QUESTIONS_KEY ? { ...s, markdown: md } : s)),
      questionsOpen: countOpen(md),
    });
  };

  return (
    <article className="detail" aria-label={`${c.title} concept`}>
      <header className="detail-head">
        <button
          className="btn ghost icon only-narrow"
          aria-label="Back to list"
          onClick={() => nav('/concepts')}
        >
          ←
        </button>
        <div className="grow stack" style={{ gap: 6 }}>
          {mode === 'edit' ? (
            <input
              className="input"
              style={{ fontSize: 20, fontWeight: 700 }}
              aria-label="Title"
              value={c.title}
              onChange={(e) => set('title', e.target.value)}
            />
          ) : (
            <h1 style={{ fontFamily: 'var(--sans)' }}>{c.title}</h1>
          )}
          <div className="rowflex" style={{ gap: 6 }}>
            {c.category && <span className="chip">{c.category}</span>}
            <span className="chip">{c.difficulty}</span>
            {c.tags.map((t) => (
              <span key={t} className="chip">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <div className="seg" role="group" aria-label="Mode">
          {(['read', 'edit', 'teach'] as const).map((x) => (
            <button
              key={x}
              aria-pressed={mode === x}
              onClick={() => (setMode(x), setRevealed(false))}
            >
              {x === 'teach' ? 'Teach-back' : x[0]!.toUpperCase() + x.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <section>
        <h2>Confidence</h2>
        <div className="seg" role="group" aria-label="Confidence level">
          {CONF.map((label, i) => (
            <button
              key={label}
              aria-pressed={c.confidence === i}
              onClick={() =>
                mode === 'edit'
                  ? set('confidence', i as 0 | 1 | 2 | 3)
                  : void quick({ confidence: i })
              }
            >
              {i} · {label}
            </button>
          ))}
        </div>
      </section>

      {mode === 'teach' && (
        <section className="card" style={{ padding: 'var(--space-5)' }}>
          <h2>Teach it back</h2>
          <p style={{ fontSize: 18, margin: '0 0 12px' }}>
            Explain <b>{c.title}</b> in your own words. What is it basically like…?
          </p>
          <textarea
            className="textarea"
            style={{ fontFamily: 'var(--sans)' }}
            rows={4}
            placeholder="Say it out loud or type it here (not saved)…"
          />
          <div className="rowflex" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => setRevealed(true)}>
              Reveal my intuition
            </button>
          </div>
          {revealed &&
            (intuition?.markdown.trim() ? (
              <div style={{ marginTop: 12 }}>
                <MarkdownView source={intuition.markdown} />
              </div>
            ) : (
              <p className="muted">
                You haven’t written an intuition yet. Switch to Edit and fill in “Intuition”.
              </p>
            ))}
        </section>
      )}

      {mode === 'read' && (
        <>
          {c.sections.map((s) =>
            s.key === QUESTIONS_KEY ? null : (
              <section key={s.key}>
                <h2>{s.title}</h2>
                {!isBlank(s.markdown) ? (
                  <MarkdownView source={s.markdown} />
                ) : (
                  <span className="faint">—</span>
                )}
              </section>
            ),
          )}
          <section>
            <h2>
              Open questions{' '}
              {questions && <span className="chip">{countOpen(questions.markdown)} open</span>}
            </h2>
            {questions && parseQuestions(questions.markdown).length ? (
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6 }}>
                {parseQuestions(questions.markdown).map((q) => (
                  <li key={q.line}>
                    <label
                      className="rowflex"
                      style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}
                    >
                      <input
                        type="checkbox"
                        checked={q.done}
                        onChange={() => toggleQ(q.line)}
                        aria-label={q.text}
                      />
                      <span
                        style={{
                          textDecoration: q.done ? 'line-through' : 'none',
                          color: q.done ? 'var(--text-faint)' : undefined,
                        }}
                      >
                        {q.text}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="faint">None. Add bullets under “Questions I still have”.</span>
            )}
          </section>
          <section>
            <h2>Related</h2>
            <div className="rowflex" style={{ gap: 6 }}>
              {c.relatedCommandIds
                .map((id) => cmdById.get(id))
                .filter(Boolean)
                .map((cmd) => (
                  <Link key={cmd!.id} className="chip mono" to={`/commands/${cmd!.id}`}>
                    ›_ {cmd!.name}
                  </Link>
                ))}
              {c.relatedConceptIds
                .map((id) => byId.get(id))
                .filter(Boolean)
                .map((x) => (
                  <Link key={x!.id} className="chip" to={`/concepts/${x!.id}`}>
                    📚 {x!.title}
                  </Link>
                ))}
              {!c.relatedCommandIds.length && !c.relatedConceptIds.length && (
                <span className="faint">Nothing linked yet.</span>
              )}
            </div>
          </section>
          <BacklinksPanel id={c.id} />
        </>
      )}

      {mode === 'edit' && (
        <>
          <div className="grid2">
            <label className="field">
              <span>CATEGORY</span>
              <input
                className="input"
                value={c.category}
                onChange={(e) => set('category', e.target.value)}
              />
            </label>
            <label className="field">
              <span>DIFFICULTY</span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={c.difficulty}
                onChange={(e) => set('difficulty', e.target.value)}
              >
                {['Easy', 'Medium', 'Hard'].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>TAGS (comma separated)</span>
            <input
              className="input"
              value={c.tags.join(', ')}
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
          <div className="grid2">
            <EntityPicker
              collection="commands"
              label="RELATED COMMANDS"
              value={c.relatedCommandIds}
              onChange={(v) => set('relatedCommandIds', v)}
            />
            <EntityPicker
              collection="concepts"
              label="RELATED CONCEPTS"
              value={c.relatedConceptIds.filter((x) => x !== c.id)}
              onChange={(v) => set('relatedConceptIds', v)}
            />
          </div>
          {c.sections.map((s) => (
            <section key={s.key} className="stack" style={{ gap: 6 }}>
              <h2>{s.title}</h2>
              {template.find((t) => t.key === s.key)?.hint && !s.markdown && (
                <span className="faint" style={{ fontSize: 12 }}>
                  {template.find((t) => t.key === s.key)!.hint}
                </span>
              )}
              <MarkdownEditor
                label={s.title}
                value={s.markdown}
                onChange={(v) => setSection(s.key, v)}
                vimMode={settings.data?.vimMode}
                onSave={() => void save()}
                minHeight={90}
              />
            </section>
          ))}
          {missing.length > 0 && (
            <button
              className="btn"
              onClick={() =>
                set('sections', [
                  ...c.sections,
                  ...missing.map((t) => ({ key: t.key, title: t.title, markdown: '' })),
                ])
              }
            >
              Add {missing.length} missing section{missing.length > 1 ? 's' : ''} from the template
            </button>
          )}
          <SaveBar
            dirty={dirty}
            saving={m.patch.isPending}
            onSave={() => void save()}
            onRevert={reset}
            onDelete={async () => {
              if (!confirm) return setConfirm(true);
              await m.remove.mutateAsync(c.id);
              toast(`Deleted ${c.title}`);
              nav('/concepts');
            }}
            extra={confirm ? <span className="muted">Click Delete again to confirm</span> : null}
          />
        </>
      )}
    </article>
  );
}
