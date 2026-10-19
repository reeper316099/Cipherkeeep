import type { Settings } from './api';

export const ACCENT_PRESETS = [
  { name: 'Mint', value: '#38e8c6' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Amber', value: '#fbbf24' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Green', value: '#4ade80' },
];

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Text colour that stays readable on a solid accent background. */
export function onAccent(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb && luminance(rgb) > 0.4 ? '#04110e' : '#ffffff';
}

export function resolveTheme(theme: Settings['theme'], systemDark: boolean): 'dark' | 'light' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

export function applyTheme(
  s: Pick<Settings, 'theme' | 'accent' | 'density' | 'blurSensitive'>,
  root = document.documentElement,
): void {
  const dark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = resolveTheme(s.theme, dark);
  root.dataset.density = s.density;
  const rgb = hexToRgb(s.accent) ?? hexToRgb('#38e8c6')!;
  root.style.setProperty('--accent', `rgb(${rgb.join(' ')})`);
  root.style.setProperty('--accent-rgb', rgb.join(' '));
  root.style.setProperty('--on-accent', onAccent(s.accent));
  root.classList.toggle('blur-sensitive', s.blurSensitive);
}
