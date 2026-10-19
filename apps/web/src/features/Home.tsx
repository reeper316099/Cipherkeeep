import { Link } from 'react-router-dom';
import { APP_NAME } from '@cipherkeep/shared';
import { useCommands, useMeta } from '../lib/queries';

export function Home() {
  const meta = useMeta();
  const commands = useCommands();
  const c = meta.data?.counts ?? {};
  const mastered = (commands.data ?? []).filter((x) => x.mastery === 3).length;
  const empty = meta.data && Object.values(c).every((n) => n === 0);
  return (
    <div className="pad">
      <h1 className="page-title">Welcome back</h1>
      <div className="kpis">
        {[
          ['Commands', c.commands ?? 0, `${mastered} mastered`],
          ['Concepts', c.concepts ?? 0, 'studied'],
          ['Labs', c.labs ?? 0, 'logged'],
          ['Projects', c.projects ?? 0, 'tracked'],
          ['Notes', c.notes ?? 0, 'guides & cheat sheets'],
        ].map(([l, n, sub]) => (
          <div key={String(l)} className="card kpi">
            <div className="n">{n}</div>
            <div>{l}</div>
            <div className="l">{sub}</div>
          </div>
        ))}
      </div>
      {empty ? (
        <div className="card empty">
          <h3>Your {APP_NAME} is empty</h3>
          <span>Bring in your Notion export, or start by adding a command.</span>
          <div className="rowflex">
            <Link className="btn primary" to="/import">
              Import Notion export
            </Link>
            <Link className="btn" to="/commands">
              Open command library
            </Link>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <p className="muted" style={{ margin: 0 }}>
            Skill map, streaks, recommendations and the review queue arrive with the study engine.
            For now: jump into the <Link to="/commands">command library</Link> or press{' '}
            <kbd>⌘K</kbd>.
          </p>
        </div>
      )}
    </div>
  );
}

export function ComingSoon({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div className="pad">
      <h1 className="page-title">{title}</h1>
      <div className="card empty">
        <h3>Not built yet</h3>
        <span>
          This screen arrives in {milestone}. Your data is already stored and searchable (⌘K).
        </span>
      </div>
    </div>
  );
}
