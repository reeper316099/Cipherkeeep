import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QUESTIONS_KEY, countOpen, toggleQuestion } from '@cipherkeep/shared';
import { api } from '../../lib/api';
import { useEntityMutations } from '../../lib/entities';
import { useUI } from '../../lib/store';

interface Q {
  conceptId: string;
  concept: string;
  text: string;
  line: number;
  done: boolean;
}

export function QuestionsPage() {
  const [showDone, setShowDone] = useState(false);
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const m = useEntityMutations('concepts');
  const { data = [], isLoading } = useQuery({
    queryKey: ['questions', showDone],
    queryFn: () => api<Q[]>(`/questions?includeDone=${showDone}`),
  });

  const toggle = async (q: Q) => {
    const concept = await api<{ sections: { key: string; markdown: string }[] }>(
      `/concepts/${q.conceptId}`,
    );
    const sections = concept.sections.map((s) =>
      s.key === QUESTIONS_KEY ? { ...s, markdown: toggleQuestion(s.markdown, q.line) } : s,
    );
    const md = sections.find((s) => s.key === QUESTIONS_KEY)!.markdown;
    await m.patch.mutateAsync({
      id: q.conceptId,
      payload: { sections, questionsOpen: countOpen(md) },
    });
    void qc.invalidateQueries({ queryKey: ['questions'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
    toast(q.done ? 'Marked open again' : 'Marked answered');
  };

  const groups = new Map<string, Q[]>();
  for (const q of data) groups.set(q.conceptId, [...(groups.get(q.conceptId) ?? []), q]);

  return (
    <div className="pad">
      <div className="rowflex" style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Open questions
        </h1>
        <span style={{ flex: 1 }} />
        <label className="rowflex" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />{' '}
          show answered
        </label>
      </div>
      {isLoading ? (
        <div className="empty">Loading…</div>
      ) : data.length === 0 ? (
        <div className="card empty">
          <h3>No open questions</h3>
          <span>Questions you jot under “Questions I still have” in a concept collect here.</span>
        </div>
      ) : (
        <div className="stack" style={{ maxWidth: 760 }}>
          {[...groups].map(([id, qs]) => (
            <section key={id} className="card panel">
              <h2>
                <Link to={`/concepts/${id}`}>{qs[0]!.concept}</Link>
              </h2>
              {qs.map((q) => (
                <label
                  key={q.line}
                  className="rowflex"
                  style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}
                >
                  <input
                    type="checkbox"
                    checked={q.done}
                    onChange={() => void toggle(q)}
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
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
