import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { APP_NAME } from '@cipherkeep/shared';
import { buildHeatGrid } from '../../lib/heatmap';
import { useOverview, useTokens, type Overview } from '../../lib/overview';
import { useStarterPack } from '../StarterPackCard';

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const verb: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  delete: 'Deleted',
  study: 'Reviewed',
  lab: 'Lab work on',
  import: 'Imported',
};
const ROUTE = (c?: string, id?: string) => (c && id ? `/${c}/${id}` : undefined);

function Banner({ o }: { o: Overview }) {
  const t = o.banner.threat;
  return (
    <div className="banner-big" aria-label="Status banner">
      [{' '}
      <b style={{ color: 'var(--accent-text)' }}>
        {APP_NAME.toUpperCase()} {o.banner.name}
      </b>{' '}
      ] | STATUS: <b>{o.banner.status}</b> | MODE: <b>{o.banner.mode}</b> | THREAT LEVEL:{' '}
      <span
        className={`threat threat-${t.level}`}
        tabIndex={0}
        title={t.explanation}
        aria-label={`Threat level ${t.level}. ${t.explanation}`}
      >
        {t.level}
      </span>
    </div>
  );
}

export function Heatmap({ heat }: { heat: Overview['heatmap'] }) {
  const cols = buildHeatGrid(heat.days, heat.from, heat.to);
  const total = Object.values(heat.days).reduce((a, b) => a + b, 0);
  return (
    <div>
      <div
        className="heat"
        role="img"
        aria-label={`Activity over the past year: ${total} actions on ${Object.keys(heat.days).length} days`}
      >
        {cols.map((col, i) => (
          <div className="heat-col" key={i}>
            {col.map((c) => (
              <i
                key={c.date}
                className={`heat-cell l${c.level} ${c.inRange ? '' : 'out'}`}
                title={`${fmtDay(c.date)}: ${c.count} action${c.count === 1 ? '' : 's'}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="rowflex faint" style={{ fontSize: 11, gap: 4, marginTop: 4 }}>
        less{' '}
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`heat-cell l${l}`} />
        ))}{' '}
        more
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data: o, isLoading, error } = useOverview();
  const tk = useTokens();
  const starter = useStarterPack();
  if (isLoading || !o)
    return <div className="pad">{error ? 'Could not load the dashboard.' : 'Loading…'}</div>;
  const empty = Object.values(o.counts).every((n) => n === 0);
  const radar = o.skillMap.map((s) => ({ domain: s.name, score: s.score }));
  const platforms = Object.entries(o.labs.byPlatform).map(([name, v]) => ({
    name,
    completed: v.completed,
    other: v.total - v.completed,
  }));
  const diffs = ['Easy', 'Medium', 'Hard'].map((d) => ({
    name: d,
    count: o.labs.byDifficulty[d] ?? 0,
  }));
  const weeks = o.timePerWeek.map((w) => ({
    week: fmtDay(w.week),
    hours: Math.round((w.minutes / 60) * 10) / 10,
  }));
  const ranked = [...o.skillMap].sort((a, b) => b.score - a.score);
  const tooltipStyle = {
    background: tk.surface,
    border: `1px solid ${tk.border}`,
    borderRadius: 8,
    color: tk.text,
    fontSize: 12,
  };

  return (
    <div className="pad">
      <div className="dash">
        <section className="card panel span-12 hero" aria-label="Overview">
          <div>
            <Banner o={o} />
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
              {o.streak.current > 0
                ? `🔥 ${o.streak.current}-day streak`
                : 'No streak yet. One action today starts it'}{' '}
              · longest {o.streak.longest} · {o.study.reviewedToday} cards reviewed today
            </div>
          </div>
          <div className="rowflex">
            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700 }}>
                {o.study.due}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                cards due{o.study.newAvailable > 0 ? ` · ${o.study.newAvailable} new` : ''}
              </div>
            </div>
            <Link
              className="btn primary"
              style={{ fontSize: 16, padding: '12px 22px' }}
              to="/study"
            >
              Start review
            </Link>
          </div>
        </section>

        {empty && (
          <section
            className="card empty span-12"
            style={{ gridColumn: 'span 12' }}
            aria-label="Get started"
          >
            <h3>Welcome to {APP_NAME}</h3>
            <span>
              Start with your own notes or with ready-made content. Everything stays on this
              computer.
            </span>
            <div className="rowflex" style={{ justifyContent: 'center' }}>
              <Link className="btn primary" to="/import">
                Import my Notion export
              </Link>
              <button
                className="btn primary"
                onClick={() => void starter.load()}
                disabled={starter.busy}
              >
                Start with the starter pack
              </button>
              <Link className="btn" to="/commands">
                Start empty
              </Link>
            </div>
            {starter.info && (
              <span className="faint" style={{ fontSize: 12 }}>
                The starter pack: {starter.info.counts.commands} commands,{' '}
                {starter.info.counts.concepts} concepts, {starter.info.counts.notes} cheat sheets
                and guides, {starter.info.counts.labs} practice labs, all original.
              </span>
            )}
          </section>
        )}

        <div className="span-12 kpis" style={{ margin: 0 }}>
          {[
            [
              'Commands mastered',
              o.kpis.commandsMastered,
              `of ${o.kpis.commandsTotal}`,
              '/commands',
            ],
            [
              'Concepts studied',
              o.kpis.conceptsStudied,
              `${o.kpis.conceptsConfident} confident`,
              '/concepts',
            ],
            ['Labs completed', o.kpis.labsCompleted, `of ${o.kpis.labsTotal}`, '/labs'],
            ['Active projects', o.kpis.activeProjects, 'in progress', '/projects'],
          ].map(([l, n, sub, to]) => (
            <Link key={String(l)} to={String(to)} className="card kpi" style={{ color: 'inherit' }}>
              <div className="n">{n}</div>
              <div>{l}</div>
              <div className="l">{sub}</div>
            </Link>
          ))}
        </div>

        <section className="card panel span-7" aria-label="Skill map">
          <h2>Skill map</h2>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <RadarChart data={radar} outerRadius="70%">
                <PolarGrid stroke={tk.border} />
                <PolarAngleAxis dataKey="domain" tick={{ fill: tk.muted, fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  dataKey="score"
                  stroke={tk.accent}
                  fill={tk.accent}
                  fillOpacity={0.25}
                  isAnimationActive={false}
                />
                <Tooltip contentStyle={tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card panel span-5 bars" aria-label="Domain scores">
          <h2>
            Domains{' '}
            <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
              score out of 100 · trend vs. last week
            </span>
          </h2>
          {ranked.map((s) => (
            <div
              key={s.name}
              className="bar-row"
              title={`concepts ${s.parts.concepts}/35 · commands ${s.parts.commands}/25 · labs ${s.parts.labs}/30 · recency ${s.parts.recency}/10`}
            >
              <span>{s.name}</span>
              <div
                className="bar"
                role="meter"
                aria-valuenow={s.score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${s.name} score`}
              >
                <i style={{ width: `${s.score}%` }} />
              </div>
              <span className="mono">
                {s.score}
                {s.trend ? (
                  <span style={{ color: s.trend > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {' '}
                    {s.trend > 0 ? '▲' : '▼'}
                    {Math.abs(s.trend)}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </section>

        <section className="card panel span-5" aria-label="Next up">
          <h2>Next up</h2>
          {o.recommendations.length === 0 && (
            <span className="muted">
              Nothing to suggest right now. Add commands, concepts or labs and recommendations
              appear here, each with its reason.
            </span>
          )}
          {o.recommendations.map((r) => (
            <Link key={r.id} className="reco" to={r.route}>
              <b>{r.title}</b>
              <span>{r.why}</span>
            </Link>
          ))}
        </section>

        <section className="card panel span-7" aria-label="Activity">
          <h2>Streak & activity</h2>
          <Heatmap heat={o.heatmap} />
          <h2 style={{ marginTop: 8 }}>Recent activity</h2>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 13,
            }}
          >
            {o.recent.length === 0 && <li className="muted">No activity yet.</li>}
            {o.recent.map((r, i) => {
              const to = ROUTE(r.collection, r.id);
              return (
                <li key={i} className="rowflex" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <span className="faint" style={{ minWidth: 92 }}>
                    {fmtDay(r.ts.slice(0, 10))}{' '}
                    {new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span>{verb[r.type] ?? r.type}</span>
                  {r.title ? (
                    to ? (
                      <Link to={to}>{r.title}</Link>
                    ) : (
                      <span>{r.title}</span>
                    )
                  ) : (
                    <span className="faint">{r.collection ?? 'item'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card panel span-6" aria-label="Time per week">
          <h2>Time spent per week (hours)</h2>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={weeks}>
                <CartesianGrid stroke={tk.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" tick={{ fill: tk.muted, fontSize: 10 }} interval={1} />
                <YAxis tick={{ fill: tk.muted, fontSize: 10 }} width={28} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'transparent' }} />
                <Bar
                  dataKey="hours"
                  fill={tk.accent}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card panel span-6" aria-label="Labs">
          <h2>Labs by platform & difficulty</h2>
          {platforms.length === 0 ? (
            <span className="muted">No labs logged yet.</span>
          ) : (
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={platforms} layout="vertical">
                  <CartesianGrid stroke={tk.border} strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: tk.muted, fontSize: 10 }}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: tk.muted, fontSize: 11 }}
                    width={80}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'transparent' }} />
                  <Bar
                    dataKey="completed"
                    stackId="a"
                    name="Completed"
                    fill={tk.accent}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="other"
                    stackId="a"
                    name="Not completed"
                    fill={tk.border}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="rowflex">
            {diffs.map((d) => (
              <span key={d.name} className="chip">
                <b>{d.count}</b> {d.name}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
