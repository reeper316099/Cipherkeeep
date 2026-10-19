import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, ApiError, downloadExport } from '../../lib/api';
import { useUI } from '../../lib/store';

interface Preview {
  previewId: string;
  kind: string;
  sourceName: string;
  counts: Record<string, number>;
  templates: { collection: string; name: string; sections: number }[];
  attachments: number;
  warnings: { level: string; message: string }[];
  items: {
    ref: string;
    collection: string;
    title: string;
    warnings: string[];
    skipByDefault?: string;
    alternatives?: string[];
  }[];
}
interface Report {
  id: string;
  created: Record<string, number>;
  updated: Record<string, number>;
  unchanged: Record<string, number>;
  skipped: { title: string; reason: string }[];
  itemWarnings: { collection: string; title: string; warnings: string[] }[];
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

export function ImportPage() {
  const [prev, setPrev] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [strategy, setStrategy] = useState('update-empty-only');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [collection, setCollection] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      const needs = e instanceof ApiError && e.code === 'NEEDS_COLLECTION';
      setErr(
        needs
          ? 'This CSV needs a collection: choose one below, then pick the file again.'
          : e instanceof Error
            ? e.message
            : 'Failed',
      );
    } finally {
      setBusy(false);
    }
  };

  const onFile = (f: File | undefined) =>
    f &&
    run(async () => {
      const form = new FormData();
      form.append('file', f);
      if (collection) form.append('collection', collection);
      setReport(null);
      setOverrides({});
      setPrev(await api<Preview>('/import/preview', { method: 'POST', body: form }));
    });

  const commit = () =>
    prev &&
    run(async () => {
      const r = await api<Report>('/import/commit', {
        method: 'POST',
        json: { previewId: prev.previewId, strategy, overrides },
      });
      setReport(r);
      setPrev(null);
      void qc.invalidateQueries();
      toast(`Imported ${sum(r.created)} new, ${sum(r.updated)} updated`);
    });

  const undo = () =>
    report &&
    run(async () => {
      await api(`/import/undo/${report.id}`, { method: 'POST' });
      setReport(null);
      void qc.invalidateQueries();
      toast('Import undone');
    });

  const [priv, setPriv] = useState(false);
  const exportFile = (path: string, name: string) =>
    run(async () => {
      await downloadExport(path, name);
      toast(`Exported ${name}`);
    });
  const q = priv ? '?includePrivate=true' : '';

  return (
    <div className="pad">
      <h1 className="page-title">Import & export</h1>
      <div className="settings-grid" style={{ maxWidth: 820 }}>
        <section className="card">
          <p style={{ margin: 0 }} className="muted">
            Notion export (zip), a CSV, a Markdown vault zip, or a JSON backup. Nothing is written
            until you confirm; every import takes a backup first and can be undone.
          </p>
          <div className="rowflex">
            <input
              ref={file}
              type="file"
              accept=".zip,.csv,.md,.json"
              aria-label="Choose file to import"
              onChange={(e) => onFile(e.target.files?.[0])}
              disabled={busy}
            />
            <label className="rowflex">
              CSV is for:
              <select
                className="select"
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                aria-label="Collection for plain CSV"
              >
                <option value="">(auto-detect)</option>
                {['commands', 'concepts', 'labs', 'projects', 'log', 'notes', 'snippets'].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          {err && (
            <div role="alert" style={{ color: 'var(--danger)' }}>
              {err}
            </div>
          )}
        </section>

        {prev && (
          <section className="card" aria-label="Import preview">
            <h2 style={{ margin: 0, fontSize: 15 }}>
              Preview · {prev.sourceName} <span className="chip">{prev.kind}</span>
            </h2>
            <div className="rowflex">
              {Object.entries(prev.counts).map(([k, n]) => (
                <span key={k} className="chip">
                  <b>{n}</b> {k}
                </span>
              ))}
              {prev.templates.length > 0 && (
                <span className="chip">{prev.templates.length} templates</span>
              )}
              {prev.attachments > 0 && <span className="chip">{prev.attachments} attachments</span>}
            </div>
            {prev.warnings.map((w, i) => (
              <div key={i} className="muted">
                ⚠ {w.message}
              </div>
            ))}
            {prev.items
              .filter((i) => i.skipByDefault || i.alternatives)
              .map((i) => (
                <div key={i.ref} className="rowflex">
                  <span style={{ minWidth: 220 }}>
                    {i.title} <span className="faint">({i.collection})</span>
                  </span>
                  <select
                    className="select"
                    aria-label={`How to import ${i.title}`}
                    value={overrides[i.ref] ?? ''}
                    onChange={(e) => setOverrides({ ...overrides, [i.ref]: e.target.value })}
                  >
                    <option value="">
                      {i.skipByDefault ? 'Skip (default)' : `As ${i.collection} (default)`}
                    </option>
                    {i.skipByDefault ? (
                      <option value="include">Import as note</option>
                    ) : (
                      <>
                        <option value="note">As note</option>
                        <option value="snippet">As snippet</option>
                      </>
                    )}
                    <option value="skip">Skip</option>
                  </select>
                </div>
              ))}
            <details>
              <summary className="muted">
                {prev.items.filter((i) => i.warnings.length).length} items with warnings
              </summary>
              {prev.items
                .filter((i) => i.warnings.length)
                .map((i) => (
                  <div key={i.ref} className="faint" style={{ fontSize: 12 }}>
                    {i.title}: {i.warnings.join('; ')}
                  </div>
                ))}
            </details>
            <div className="rowflex">
              <label className="rowflex">
                If it already exists:
                <select
                  className="select"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  aria-label="Duplicate strategy"
                >
                  <option value="update-empty-only">Fill empty fields only (safe)</option>
                  <option value="skip">Skip</option>
                  <option value="overwrite">Overwrite</option>
                  <option value="keep-both">Keep both</option>
                </select>
              </label>
              <button className="btn primary" onClick={commit} disabled={busy}>
                Import
              </button>
              <button className="btn" onClick={() => setPrev(null)}>
                Cancel
              </button>
            </div>
          </section>
        )}

        {report && (
          <section className="card" aria-label="Import report">
            <h2 style={{ margin: 0, fontSize: 15 }}>Done</h2>
            <div className="rowflex">
              <span className="chip">
                <b>{sum(report.created)}</b> created
              </span>
              <span className="chip">
                <b>{sum(report.updated)}</b> updated
              </span>
              <span className="chip">
                <b>{sum(report.unchanged)}</b> unchanged
              </span>
              <span className="chip">
                <b>{report.skipped.length}</b> skipped
              </span>
            </div>
            {report.skipped.map((s, i) => (
              <div key={i} className="faint" style={{ fontSize: 12 }}>
                Skipped “{s.title}”: {s.reason}
              </div>
            ))}
            {report.itemWarnings.map((w, i) => (
              <div key={i} className="muted" style={{ fontSize: 12.5 }}>
                ⚠ {w.title}: {w.warnings.join('; ')}
              </div>
            ))}
            <div className="rowflex">
              <button className="btn danger" onClick={undo} disabled={busy}>
                Undo this import
              </button>
            </div>
          </section>
        )}

        <section className="card" aria-label="Export">
          <h2 style={{ margin: 0, fontSize: 15 }}>Export</h2>
          <p className="muted" style={{ margin: 0 }}>
            Your data is already plain JSON and Markdown files in the data folder. These exports are
            for moving it elsewhere or keeping a copy.
          </p>
          <label className="rowflex" style={{ gap: 6 }}>
            <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />{' '}
            Include private lab writeups
          </label>
          <div className="rowflex">
            <button
              className="btn"
              disabled={busy}
              onClick={() => exportFile(`/export/markdown${q}`, 'cipherkeep-vault.zip')}
            >
              Markdown vault (Obsidian) .zip
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => exportFile(`/export/json${q}`, 'cipherkeep-backup.json')}
            >
              Full JSON backup
            </button>
          </div>
          <div className="rowflex" role="group" aria-label="CSV exports">
            <span className="faint" style={{ fontSize: 12 }}>
              CSV:
            </span>
            {['commands', 'concepts', 'labs', 'projects', 'log', 'notes', 'snippets'].map((c) => (
              <button
                key={c}
                className="btn"
                disabled={busy}
                onClick={() =>
                  exportFile(
                    `/export/csv?collection=${c}${priv ? '&includePrivate=true' : ''}`,
                    `${c}.csv`,
                  )
                }
              >
                {c}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
