export class JsonStoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly file?: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = 'JsonStoreError';
  }
}

/** Best-effort 1-based line number for a JSON.parse failure. */
export function jsonErrorLine(text: string, err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  const lc = /line (\d+)/.exec(msg);
  if (lc) return Number(lc[1]);
  const pos = /position (\d+)/.exec(msg);
  if (pos) return text.slice(0, Number(pos[1])).split('\n').length;
  return undefined;
}
