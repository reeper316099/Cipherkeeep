import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind?: 'info' | 'error';
  action?: { label: string; run: () => void };
}

const SENSITIVE_NAME = /pass|pwd|token|secret|key|cred|hash|cookie|session/i;
export const isSensitiveName = (n: string) => SENSITIVE_NAME.test(n);

const SS_KEY = 'ck.placeholders';
function loadSession(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(SS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

interface UI {
  /** Lab timer: survives navigation inside the app. */
  timer: { labId: string; startedAt: number } | null;
  startTimer(labId: string): void;
  stopTimer(): number;
  paletteOpen: boolean;
  helpOpen: boolean;
  editor: { mode: 'create' } | { mode: 'edit'; id: string } | null;
  setPalette(v: boolean): void;
  setHelp(v: boolean): void;
  setEditor(v: UI['editor']): void;

  toasts: Toast[];
  toast(text: string, opts?: Partial<Omit<Toast, 'id' | 'text'>>): void;
  dismiss(id: number): void;

  /** Placeholder fill-in values. Sensitive ones live in memory only; the rest survive in sessionStorage. */
  values: Record<string, string>;
  sensitive: Record<string, boolean>;
  setValue(name: string, v: string): void;
  setSensitive(name: string, v: boolean): void;
  clearValues(): void;
}

let nextToast = 1;

export const useUI = create<UI>((set, get) => ({
  timer: null,
  startTimer: (labId) => set({ timer: { labId, startedAt: Date.now() } }),
  stopTimer() {
    const t = get().timer;
    set({ timer: null });
    return t ? Math.max(0, Math.round((Date.now() - t.startedAt) / 60_000)) : 0;
  },
  paletteOpen: false,
  helpOpen: false,
  editor: null,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setHelp: (helpOpen) => set({ helpOpen }),
  setEditor: (editor) => set({ editor }),

  toasts: [],
  toast(text, opts = {}) {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts, { id, text, ...opts }] }));
    setTimeout(() => get().dismiss(id), opts.action ? 7000 : 2600);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  values: loadSession(),
  sensitive: {},
  setValue(name, v) {
    const values = { ...get().values, [name]: v };
    set({ values });
    const persistable = Object.fromEntries(
      Object.entries(values).filter(([k]) => !(get().sensitive[k] ?? isSensitiveName(k))),
    );
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify(persistable));
    } catch {
      /* storage unavailable: memory only */
    }
  },
  setSensitive(name, v) {
    set({ sensitive: { ...get().sensitive, [name]: v } });
    get().setValue(name, get().values[name] ?? ''); // re-evaluate what is persisted
  },
  clearValues() {
    set({ values: {} });
    try {
      sessionStorage.removeItem(SS_KEY);
    } catch {
      /* ignore */
    }
  },
}));

export interface LibraryFilters {
  q: string;
  category: string;
  platform: string;
  risk: string;
  mastery: string;
  favorite: boolean;
  view: 'table' | 'cards';
}

export const useLibrary = create<{
  f: LibraryFilters;
  set(p: Partial<LibraryFilters>): void;
  reset(): void;
}>((set) => ({
  f: { q: '', category: '', platform: '', risk: '', mastery: '', favorite: false, view: 'table' },
  set: (p) => set((s) => ({ f: { ...s.f, ...p } })),
  reset: () =>
    set((s) => ({
      f: { ...s.f, q: '', category: '', platform: '', risk: '', mastery: '', favorite: false },
    })),
}));
