import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { checkFill, checkTask, type Rating } from '@cipherkeep/shared';
import { MarkdownView } from '../../components/MarkdownView';
import { api } from '../../lib/api';
import {
  RATING_KEYS,
  RATING_LABEL,
  nextIntervalLabel,
  suggestRating,
  summarize,
  type QueueItem,
} from '../../lib/study';

interface QueueResponse {
  items: QueueItem[];
  due: number;
  newAvailable: number;
  newToday: number;
}
interface Stats {
  due: number;
  newAvailable: number;
  reviewedToday: number;
  retention30d: number | null;
  newPerDay: number;
}

const TZ = () => new Date().getTimezoneOffset();
const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export function StudyPage() {
  const [params] = useSearchParams();
  const only = params.get('command') ?? undefined;
  const [phase, setPhase] = useState<'intro' | 'run' | 'done'>('intro');
  const [collection, setCollection] = useState<'' | 'commands' | 'concepts'>('');
  const [size, setSize] = useState(20);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [answers, setAnswers] = useState<{ rating: Rating }[]>([]);
  const [started, setStarted] = useState(0);
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const stats = useQuery({
    queryKey: ['study-stats'],
    queryFn: () => api<Stats>(`/study/stats?tzOffset=${TZ()}`),
  });

  const start = useCallback(
    async (onlyId?: string) => {
      setError('');
      const qs = new URLSearchParams({ limit: String(size), tzOffset: String(TZ()) });
      if (collection) qs.set('collection', collection);
      if (onlyId) qs.set('onlyId', onlyId);
      const r = await api<QueueResponse>(`/study/queue?${qs}`);
      if (!r.items.length)
        return setError(
          onlyId
            ? 'That command has nothing to quiz yet. Add an explanation, examples or options.'
            : 'Nothing to review right now. Come back later, or raise the daily new-card limit in Settings.',
        );
      setQueue(r.items);
      setAnswers([]);
      setStarted(Date.now());
      setPhase('run');
    },
    [collection, size],
  );

  useEffect(() => {
    if (only) void start(only);
  }, [only]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    setPhase('done');
    void qc.invalidateQueries({ queryKey: ['overview'] });
    void qc.invalidateQueries({ queryKey: ['study-stats'] });
    void qc.invalidateQueries({ queryKey: ['coll'] });
  };

  if (phase === 'run')
    return (
      <Session
        queue={queue}
        setQueue={setQueue}
        onAnswer={(a) => setAnswers((x) => [...x, a])}
        answers={answers}
        onFinish={finish}
        started={started}
      />
    );
  if (phase === 'done')
    return (
      <Summary answers={answers} ms={Date.now() - started} onAgain={() => setPhase('intro')} />
    );

  const s = stats.data;
  return (
    <div className="pad">
      <h1 className="page-title">Review</h1>
      <div className="kpis">
        <div className="card kpi">
          <div className="n">{s?.due ?? '–'}</div>
          <div>Due now</div>
          <div className="l">cards waiting for review</div>
        </div>
        <div className="card kpi">
          <div className="n">{s?.newAvailable ?? '–'}</div>
          <div>New today</div>
          <div className="l">of {s?.newPerDay ?? 10} per day</div>
        </div>
        <div className="card kpi">
          <div className="n">{s?.reviewedToday ?? '–'}</div>
          <div>Reviewed today</div>
        </div>
        <div className="card kpi">
          <div className="n">
            {s?.retention30d === null || s?.retention30d === undefined ? '–' : `${s.retention30d}%`}
          </div>
          <div>Retention</div>
          <div className="l">last 30 days</div>
        </div>
      </div>
      <section className="card stack" style={{ padding: 'var(--space-4)', maxWidth: 560 }}>
        <div className="rowflex">
          <label className="field">
            <span>WHAT TO REVIEW</span>
            <select
              className="select"
              value={collection}
              onChange={(e) => setCollection(e.target.value as typeof collection)}
            >
              <option value="">Commands and concepts</option>
              <option value="commands">Commands only</option>
              <option value="concepts">Concepts only</option>
            </select>
          </label>
          <label className="field">
            <span>SESSION SIZE</span>
            <select
              className="select"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} cards
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="btn primary"
          style={{ fontSize: 16, padding: '10px 18px', alignSelf: 'flex-start' }}
          onClick={() => void start()}
          disabled={s ? s.due + s.newAvailable === 0 : false}
        >
          Start review{' '}
          {s && s.due + s.newAvailable > 0 && (
            <span className="chip">{s.due + s.newAvailable}</span>
          )}
        </button>
        {error && (
          <div role="alert" style={{ color: 'var(--warning)' }}>
            {error}
          </div>
        )}
        {s && s.due + s.newAvailable === 0 && !error && (
          <span className="muted">
            You’re all caught up. Nothing is due and today’s new cards are done.
          </span>
        )}
        <span className="faint" style={{ fontSize: 12 }}>
          Keys: <kbd>Space</kbd>/<kbd>Enter</kbd> show or check · <kbd>1</kbd> again <kbd>2</kbd>{' '}
          hard <kbd>3</kbd> good <kbd>4</kbd> easy · <kbd>Esc</kbd> end session. Cards come back on
          an SM-2 schedule, and your mastery updates as intervals grow.
        </span>
      </section>
    </div>
  );
}

function Session({
  queue,
  setQueue,
  answers,
  onAnswer,
  onFinish,
  started,
}: {
  queue: QueueItem[];
  setQueue(q: QueueItem[]): void;
  answers: { rating: Rating }[];
  onAnswer(a: { rating: Rating }): void;
  onFinish(): void;
  started: number;
}) {
  const nav = useNavigate();
  const item = queue[0];
  const [revealed, setRevealed] = useState(false);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{ correct: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const shownAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setRevealed(false);
    setInput('');
    setResult(null);
    shownAt.current = Date.now();
    inputRef.current?.focus();
  }, [item?.card.entityId, item?.card.type, answers.length]);

  const card = item?.card;
  const answered = card ? (card.kind === 'type' ? result !== null : revealed) : false;

  const rate = useCallback(
    async (rating: Rating) => {
      if (!item || busy) return;
      setBusy(true);
      setErr('');
      try {
        await api('/study/answer', {
          method: 'POST',
          json: {
            id: item.card.entityId,
            collection: item.card.collection,
            rating,
            ms: Date.now() - shownAt.current,
            cardType: item.card.type,
          },
        });
        onAnswer({ rating });
        // a lapse stays in this session: show it again after the rest
        const rest = queue.slice(1);
        const next = rating === 'again' ? [...rest, { ...item, isNew: false }] : rest;
        if (!next.length) return onFinish();
        setQueue(next);
      } catch {
        setErr('Could not save that answer. Check that the app is still running and try again.');
      } finally {
        setBusy(false);
      }
    },
    [item, busy, queue, onAnswer, onFinish, setQueue],
  );

  const check = useCallback(() => {
    if (!card || card.kind !== 'type' || result) return;
    const ok =
      card.type === 'fill'
        ? checkFill(input, card.expected ?? [])
        : checkTask(input, card.expected ?? []).correct;
    setResult({ correct: ok });
  }, [card, input, result]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') return onFinish();
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (!card) return;
      if (e.key === 'Enter' || ((e.key === ' ' || e.code === 'Space') && !typing)) {
        e.preventDefault();
        if (!answered) {
          if (card.kind === 'type') check();
          else setRevealed(true);
        } else if (e.key === 'Enter')
          void rate(card.kind === 'type' && result ? suggestRating(result.correct) : 'good');
      } else if (answered && !typing && ['1', '2', '3', '4'].includes(e.key))
        void rate(RATING_KEYS[Number(e.key) - 1]!);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [card, answered, check, rate, result, onFinish]);

  const total = answers.length + queue.length;
  const pct = total ? Math.round((answers.length / total) * 100) : 0;
  const suggested = useMemo(
    () => (card?.kind === 'type' && result ? suggestRating(result.correct) : null),
    [card, result],
  );
  if (!item || !card) return null;

  return (
    <div className="pad" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 'min(720px, 100%)' }} className="stack">
        <div className="rowflex" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn ghost"
            onClick={() => (answers.length ? onFinish() : nav('/study'))}
          >
            ← End session
          </button>
          <span className="faint mono" aria-live="off">
            {answers.length}/{total} · {mmss(Date.now() - started)}
          </span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Session progress"
        >
          <i style={{ width: `${pct}%` }} />
        </div>

        <section className="card study-card" aria-label="Flashcard">
          <div className="rowflex" style={{ justifyContent: 'space-between' }}>
            <span className="chip">
              {card.collection === 'commands' ? '›_ command' : '📚 concept'}
            </span>
            <span className="rowflex" style={{ gap: 6 }}>
              {item.isNew && (
                <span className="chip" style={{ color: 'var(--accent-text)' }}>
                  new
                </span>
              )}
              <span className="chip">
                {
                  {
                    name: 'what it does',
                    task: 'type it',
                    flag: 'flag',
                    fill: 'fill the blank',
                    teach: 'teach back',
                    what: 'recall',
                  }[card.type]
                }
              </span>
            </span>
          </div>
          <h2 className="study-prompt">
            <Prompt text={card.prompt} />
          </h2>
          {card.kind === 'type' && (
            <div className="stack" style={{ gap: 8 }}>
              <input
                ref={inputRef}
                className="input mono"
                style={{ fontSize: 16, padding: '10px 12px' }}
                aria-label="Your answer"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={card.type === 'fill' ? 'the missing part…' : 'type the command…'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!!result}
              />
              {card.hint && !result && (
                <span className="faint" style={{ fontSize: 12.5 }}>
                  Hint: {card.hint}
                </span>
              )}
              {!result && (
                <div>
                  <button className="btn primary" onClick={check} disabled={!input.trim()}>
                    Check <kbd>Enter</kbd>
                  </button>
                </div>
              )}
              {result && (
                <div role="status" className="study-result" data-correct={result.correct}>
                  <b>{result.correct ? '✓ Correct' : '✗ Not quite'}</b>
                  <div className="mono" style={{ marginTop: 4 }}>
                    {card.answer}
                  </div>
                  {card.type === 'task' && result.correct && (
                    <span className="faint" style={{ fontSize: 12 }}>
                      Flag order and spacing don’t matter.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {card.kind === 'reveal' && !revealed && (
            <button
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setRevealed(true)}
            >
              Show answer <kbd>Space</kbd>
            </button>
          )}
          {card.kind === 'reveal' && revealed && (
            <div className="study-result" data-correct="neutral">
              <MarkdownView source={card.answer} />
            </div>
          )}
        </section>

        {answered ? (
          <div className="rate-row" role="group" aria-label="How well did you know it?">
            {RATING_KEYS.map((r, i) => (
              <button
                key={r}
                className={`btn rate rate-${r} ${suggested === r ? 'suggested' : ''}`}
                onClick={() => void rate(r)}
                disabled={busy}
              >
                <kbd>{i + 1}</kbd> {RATING_LABEL[r]}
                <span className="faint">{nextIntervalLabel(item.srs, r)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ minHeight: 56 }} />
        )}
        {err && (
          <div role="alert" style={{ color: 'var(--danger)' }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

/** Prompts mark commands with `backticks`; show those as code. */
function Prompt({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code key={i} className="mono" style={{ color: 'var(--accent-text)' }}>
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Summary({
  answers,
  ms,
  onAgain,
}: {
  answers: { rating: Rating }[];
  ms: number;
  onAgain(): void;
}) {
  const s = summarize(answers, ms);
  return (
    <div className="pad">
      <h1 className="page-title">Session complete</h1>
      <div className="kpis">
        <div className="card kpi">
          <div className="n">{s.total}</div>
          <div>Cards reviewed</div>
        </div>
        <div className="card kpi">
          <div className="n">{s.accuracy}%</div>
          <div>Recalled</div>
          <div className="l">hard, good or easy</div>
        </div>
        <div className="card kpi">
          <div className="n">{mmss(s.ms)}</div>
          <div>Time</div>
        </div>
      </div>
      <div className="card" style={{ padding: 'var(--space-4)', maxWidth: 560 }}>
        <div className="rowflex">
          {(['again', 'hard', 'good', 'easy'] as Rating[]).map((r) => (
            <span key={r} className="chip">
              <b>{s.byRating[r]}</b> {RATING_LABEL[r].toLowerCase()}
            </span>
          ))}
        </div>
        <div className="rowflex" style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn primary" onClick={onAgain}>
            Review more
          </button>
          <Link className="btn" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
