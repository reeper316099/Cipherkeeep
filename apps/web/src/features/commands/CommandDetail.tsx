import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { detectPlaceholders, fillPlaceholders, type Command } from '@cipherkeep/shared';
import { IconArchive, IconCopy, IconEdit, IconStar } from '../../components/Icons';
import { copyText } from '../../lib/clipboard';
import { primaryExample } from '../../lib/commandFilters';
import { useConcepts, useLabs, usePatchCommand } from '../../lib/queries';
import { useUI } from '../../lib/store';
import { PlaceholderBar } from './PlaceholderBar';
import { Tokens } from './Tokens';

const MASTERY = ['Unseen', 'Learning', 'Comfortable', 'Mastered'] as const;

export function Dots({ n }: { n: number }) {
  return (
    <span className="dots" role="img" aria-label={`Mastery ${n} of 3: ${MASTERY[n] ?? ''}`}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} />
      ))}
    </span>
  );
}

export function useCopy() {
  const toast = useUI((s) => s.toast);
  const values = useUI((s) => s.values);
  return async (text: string, label = 'Copied') => {
    const filled = fillPlaceholders(text, values);
    toast(
      (await copyText(filled))
        ? `${label}: ${filled.length > 70 ? filled.slice(0, 70) + '…' : filled}`
        : 'Copy failed',
      { kind: 'info' },
    );
  };
}

export function CommandDetail({ cmd }: { cmd: Command }) {
  const copy = useCopy();
  const nav = useNavigate();
  const patch = usePatchCommand();
  const values = useUI((s) => s.values);
  const setEditor = useUI((s) => s.setEditor);
  const toast = useUI((s) => s.toast);
  const concepts = useConcepts();
  const labs = useLabs();

  const names = useMemo(
    () => [
      ...new Set([
        ...detectPlaceholders(cmd.syntax, ...cmd.examples.map((e) => e.command)),
        ...cmd.placeholders,
      ]),
    ],
    [cmd],
  );
  const relConcepts = (concepts.data ?? []).filter((c) => c.relatedCommandIds.includes(cmd.id));
  const relLabs = (labs.data ?? []).filter((l) => l.commandIds.includes(cmd.id));

  const archive = () => {
    patch.mutate({ id: cmd.id, patch: { archived: true } });
    nav('/commands');
    toast(`Archived ${cmd.name}`, {
      action: {
        label: 'Undo',
        run: () => patch.mutate({ id: cmd.id, patch: { archived: false } }),
      },
    });
  };

  return (
    <article className="detail" aria-label={`${cmd.name} details`}>
      <header className="detail-head">
        <button
          className="btn ghost icon only-narrow"
          aria-label="Back to list"
          onClick={() => nav('/commands')}
        >
          ←
        </button>
        <div className="grow stack" style={{ gap: 6 }}>
          <h1>{cmd.name}</h1>
          <div className="rowflex" style={{ gap: 6 }}>
            {cmd.category && <span className="chip">{cmd.category}</span>}
            <span
              className={`chip risk-${cmd.risk}`}
              title={
                cmd.risk === 'destructive'
                  ? 'Can delete or overwrite data. Double-check targets.'
                  : cmd.risk === 'caution'
                    ? 'Changes state; read before running.'
                    : 'Read-only or low impact.'
              }
            >
              {cmd.risk === 'destructive' ? '⚠ destructive' : cmd.risk}
            </span>
            {cmd.platforms.map((p) => (
              <span key={p} className="chip">
                {p}
              </span>
            ))}
            {cmd.tags.map((t) => (
              <span key={t} className="chip">
                #{t}
              </span>
            ))}
          </div>
          {cmd.explanation && <div className="muted">{cmd.explanation}</div>}
        </div>
        <div className="rowflex" style={{ gap: 6 }}>
          <button
            className="btn primary"
            onClick={() => copy(primaryExample(cmd), 'Copied')}
            title="Copy primary example (C)"
          >
            <IconCopy /> Copy example <kbd style={{ marginLeft: 4 }}>C</kbd>
          </button>
          <button
            className="btn icon"
            aria-label={cmd.favorite ? 'Remove favourite' : 'Add favourite'}
            aria-pressed={cmd.favorite}
            onClick={() => patch.mutate({ id: cmd.id, patch: { favorite: !cmd.favorite } })}
          >
            <IconStar on={cmd.favorite} />
          </button>
          <button
            className="btn icon"
            aria-label="Edit command (E)"
            title="Edit (E)"
            onClick={() => setEditor({ mode: 'edit', id: cmd.id })}
          >
            <IconEdit />
          </button>
          <button
            className="btn icon"
            aria-label="Archive command"
            title="Archive"
            onClick={archive}
          >
            <IconArchive />
          </button>
        </div>
      </header>

      <section>
        <h2>Mastery</h2>
        <div className="rowflex">
          <div className="seg" role="group" aria-label="Mastery level">
            {MASTERY.map((label, i) => (
              <button
                key={label}
                aria-pressed={cmd.mastery === i}
                onClick={() => patch.mutate({ id: cmd.id, patch: { mastery: i as 0 | 1 | 2 | 3 } })}
              >
                {i} · {label}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => nav(`/study?command=${cmd.id}`)}>
            Practice this
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            practiced {cmd.practiceCount}×
            {cmd.lastPracticedAt
              ? ` · last ${new Date(cmd.lastPracticedAt).toLocaleDateString()}`
              : ''}
          </span>
        </div>
      </section>

      <PlaceholderBar names={names} />

      {cmd.syntax && (
        <section>
          <h2>Syntax</h2>
          <div
            className="code"
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
          >
            <span>
              <Tokens text={cmd.syntax} values={values} />
            </span>
            <button
              className="btn ghost icon"
              aria-label="Copy syntax"
              onClick={() => copy(cmd.syntax, 'Copied syntax')}
            >
              <IconCopy />
            </button>
          </div>
        </section>
      )}

      {cmd.whatItDoes && (
        <section>
          <h2>What it does</h2>
          <div style={{ whiteSpace: 'pre-wrap' }}>{cmd.whatItDoes}</div>
        </section>
      )}

      {cmd.arguments.length > 0 && (
        <section>
          <h2>Arguments</h2>
          <table className="flags">
            <tbody>
              {cmd.arguments.map((a, i) => (
                <tr key={i}>
                  <td>{a.name}</td>
                  <td>{a.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {cmd.options.length > 0 && (
        <section>
          <h2>Options</h2>
          <table className="flags">
            <tbody>
              {cmd.options.map((o, i) => (
                <tr key={i}>
                  <td>
                    <button
                      className="btn ghost"
                      style={{ padding: 0, font: 'inherit', color: 'inherit' }}
                      title="Copy"
                      onClick={() => copy(o.flag, 'Copied')}
                    >
                      {o.flag}
                    </button>
                  </td>
                  <td>{o.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {cmd.examples.length > 0 && (
        <section>
          <h2>Examples</h2>
          <div className="code" style={{ whiteSpace: 'normal', padding: '2px 12px' }}>
            {cmd.examples.map((e, i) => (
              <div key={i} className="example">
                <div>
                  <div className="cmd">
                    <Tokens text={e.command} values={values} />
                  </div>
                  {e.description && <div className="desc">{e.description}</div>}
                </div>
                <button
                  className="btn ghost icon"
                  aria-label={`Copy example: ${e.command}`}
                  onClick={() => copy(e.command)}
                >
                  <IconCopy />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {cmd.notes && (
        <section>
          <h2>Notes</h2>
          <div style={{ whiteSpace: 'pre-wrap' }} className="muted">
            {cmd.notes}
          </div>
        </section>
      )}

      {(relConcepts.length > 0 || relLabs.length > 0) && (
        <section>
          <h2>Related</h2>
          <div className="rowflex" style={{ gap: 6 }}>
            {relConcepts.map((c) => (
              <Link key={c.id} className="chip" to={`/concepts/${c.id}`}>
                📚 {c.title}
              </Link>
            ))}
            {relLabs.map((l) => (
              <Link key={l.id} className="chip" to={`/labs/${l.id}`}>
                🧪 {l.title}
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
