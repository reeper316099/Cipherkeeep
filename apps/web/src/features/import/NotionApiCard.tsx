import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSettings } from '../../lib/queries';

interface Job {
  state: 'running' | 'done' | 'failed' | 'cancelled';
  progress: { phase: string; done: number; total: number };
  message?: string;
  stats?: { databases: number; pages: number; skippedPages: number; images: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preview?: any;
}

const PHASE: Record<string, string> = {
  listing: 'Finding what your integration can see…',
  reading: 'Reading pages',
  building: 'Preparing the preview…',
};

/** Optional: read a Notion workspace through the API. Off until enabled in Settings; the token is never saved. */
export function NotionApiCard({ onPreview }: { onPreview: (preview: never) => void }) {
  const settings = useSettings();
  const [token, setToken] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const handed = useRef(false);
  const enabled = !!settings.data?.notionApiEnabled;

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await api<Job>(`/import/notion-api/${jobId}`);
        if (stop) return;
        setJob(j);
        if (j.state === 'running') setTimeout(() => void tick(), 800);
        else if (j.state === 'done' && j.preview && !handed.current) {
          handed.current = true;
          onPreview(j.preview as never);
          setJobId(null);
        } else if (j.state !== 'done') setJobId(null);
      } catch (e) {
        if (!stop) {
          setError(e instanceof Error ? e.message : 'Lost track of the import');
          setJobId(null);
        }
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId, onPreview]);

  const start = async () => {
    setError('');
    setJob(null);
    handed.current = false;
    try {
      const r = await api<{ jobId: string }>('/import/notion-api/start', {
        method: 'POST',
        json: { token },
      });
      setToken(''); // the server holds it only for the length of the job
      setJobId(r.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    }
  };
  const running = !!jobId;

  return (
    <section className="card" aria-label="Import from the Notion API">
      <h2 style={{ margin: 0, fontSize: 15 }}>Import from Notion (API)</h2>
      {!enabled ? (
        <p className="muted" style={{ margin: 0 }}>
          Off. This is the only feature that uses the internet, and only to api.notion.com while an
          import runs. Turn it on in <Link to="/settings">Settings → Privacy</Link>. A Notion export
          (zip) above works without it.
        </p>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Create an internal integration in Notion, share your pages with it, and paste its token.
            The token is used for this import only and is never saved. You get the usual preview
            before anything is written. Images are not downloaded.
          </p>
          <div className="rowflex">
            <input
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label="Notion integration token"
              placeholder="Integration token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={running}
              style={{ flex: '1 1 260px' }}
            />
            <button
              className="btn primary"
              onClick={() => void start()}
              disabled={running || token.trim().length < 20}
            >
              Read from Notion
            </button>
            {running && (
              <button
                className="btn ghost"
                onClick={() => void api(`/import/notion-api/${jobId}/cancel`, { method: 'POST' })}
              >
                Cancel
              </button>
            )}
          </div>
          {running && job && (
            <div role="status" className="faint">
              {PHASE[job.progress.phase] ?? ''}
              {job.progress.total > 0 && ` ${job.progress.done} of ${job.progress.total}`}
            </div>
          )}
          {job?.state === 'done' && job.stats && (
            <div className="faint">
              Read {job.stats.pages} pages from {job.stats.databases} databases
              {job.stats.skippedPages ? `; ${job.stats.skippedPages} could not be read` : ''}
              {job.stats.images ? `; ${job.stats.images} images/files were not downloaded` : ''}.
            </div>
          )}
          {(job?.state === 'failed' || job?.state === 'cancelled') && (
            <div role="alert" className="gate-error">
              {job.state === 'cancelled' ? 'Cancelled.' : job.message}
            </div>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="gate-error">
          {error}
        </div>
      )}
    </section>
  );
}
