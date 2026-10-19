import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../components/Dialog';
import { api, ApiError } from '../../lib/api';
import { draftFrom, draftToPayload, emptyDraft, type CommandDraft } from '../../lib/commandForm';
import { keys, useCommands, useSaveCommand } from '../../lib/queries';
import { useUI } from '../../lib/store';

const PLATFORMS = ['linux', 'macos', 'windows', 'any'] as const;

export function CommandEditor({
  editor,
  onClose,
}: {
  editor: NonNullable<ReturnType<typeof useUI.getState>['editor']>;
  onClose: () => void;
}) {
  const commands = useCommands();
  const save = useSaveCommand();
  const nav = useNavigate();
  const toast = useUI((s) => s.toast);
  const qc = useQueryClient();
  const existing =
    editor.mode === 'edit' ? commands.data?.find((c) => c.id === editor.id) : undefined;
  const [d, setD] = useState<CommandDraft>(emptyDraft());
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (existing) setD(draftFrom(existing));
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const categories = [
    ...new Set((commands.data ?? []).map((c) => c.category).filter(Boolean)),
  ].sort();
  const set = <K extends keyof CommandDraft>(k: K, v: CommandDraft[K]) =>
    setD((x) => ({ ...x, [k]: v }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!d.name.trim()) return setErr('Name is required');
    setErr('');
    try {
      const saved = await save.mutateAsync({ id: existing?.id, payload: draftToPayload(d) });
      toast(`${existing ? 'Saved' : 'Created'} ${saved.name}`);
      onClose();
      nav(`/commands/${saved.id}`);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save');
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirmDelete) return setConfirmDelete(true);
    await api(`/commands/${existing.id}`, { method: 'DELETE' });
    void qc.invalidateQueries({ queryKey: keys.all('commands') });
    void qc.invalidateQueries({ queryKey: keys.meta });
    toast(`Deleted ${existing.name}`);
    onClose();
    nav('/commands');
  };

  return (
    <Dialog
      title={existing ? `Edit ${existing.name}` : 'New command'}
      onClose={onClose}
      wide
      footer={
        <>
          {existing && (
            <button
              type="button"
              className="btn danger"
              style={{ marginRight: 'auto' }}
              onClick={remove}
            >
              {confirmDelete ? 'Click again to delete forever' : 'Delete'}
            </button>
          )}
          {err && (
            <span style={{ color: 'var(--danger)', alignSelf: 'center' }} role="alert">
              {err}
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="cmd-form" className="btn primary" disabled={save.isPending}>
            Save
          </button>
        </>
      }
    >
      <form id="cmd-form" className="dialog-body" onSubmit={submit}>
        <div className="grid2">
          <label className="field">
            <span>NAME</span>
            <input
              className="input mono"
              value={d.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>CATEGORY</span>
            <input
              className="input"
              list="cmd-cats"
              value={d.category}
              onChange={(e) => set('category', e.target.value)}
            />
            <datalist id="cmd-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="grid2">
          <label className="field">
            <span>SYNTAX</span>
            <input
              className="input mono"
              value={d.syntax}
              onChange={(e) => set('syntax', e.target.value)}
              placeholder="ls [flags] [directory]"
            />
          </label>
          <label className="field">
            <span>ONE-LINER</span>
            <input
              className="input"
              value={d.explanation}
              onChange={(e) => set('explanation', e.target.value)}
            />
          </label>
        </div>
        <div className="rowflex">
          <div className="field">
            <span>RISK</span>
            <div className="seg" role="group" aria-label="Risk">
              {(['safe', 'caution', 'destructive'] as const).map((r) => (
                <button
                  type="button"
                  key={r}
                  aria-pressed={d.risk === r}
                  onClick={() => set('risk', r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>PLATFORMS</span>
            <div className="seg" role="group" aria-label="Platforms">
              {PLATFORMS.map((p) => (
                <button
                  type="button"
                  key={p}
                  aria-pressed={d.platforms.includes(p)}
                  onClick={() =>
                    set(
                      'platforms',
                      d.platforms.includes(p)
                        ? d.platforms.filter((x) => x !== p).length
                          ? d.platforms.filter((x) => x !== p)
                          : ['any']
                        : [...d.platforms.filter((x) => x !== 'any' || p === 'any'), p],
                    )
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <label className="field" style={{ flex: 1 }}>
            <span>TAGS (comma separated)</span>
            <input className="input" value={d.tags} onChange={(e) => set('tags', e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>WHAT IT DOES</span>
          <textarea
            className="textarea"
            style={{ fontFamily: 'var(--sans)' }}
            value={d.whatItDoes}
            onChange={(e) => set('whatItDoes', e.target.value)}
          />
        </label>
        <div className="grid2">
          <label className="field">
            <span>EXAMPLES — one per line: command = "description"</span>
            <textarea
              className="textarea"
              rows={5}
              value={d.examples}
              onChange={(e) => set('examples', e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>OPTIONS — one per line: flag | meaning</span>
            <textarea
              className="textarea"
              rows={5}
              value={d.options}
              onChange={(e) => set('options', e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <label className="field">
          <span>ARGUMENTS — one per line: name → meaning</span>
          <textarea
            className="textarea"
            rows={2}
            value={d.arguments}
            onChange={(e) => set('arguments', e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>NOTES</span>
          <textarea
            className="textarea"
            style={{ fontFamily: 'var(--sans)' }}
            value={d.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </form>
    </Dialog>
  );
}
