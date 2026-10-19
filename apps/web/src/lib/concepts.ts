export interface Question {
  text: string;
  done: boolean;
  line: number;
}

const BULLET = /^(\s*[-*+]\s+)(?:\[([ xX])\]\s+)?(.*)$/;

/** Bulleted questions; `- [x]` marks one answered. Empty bullets (`-`) are ignored. */
export function parseQuestions(md: string): Question[] {
  return md.split('\n').flatMap((l, line) => {
    const m = BULLET.exec(l);
    return m && m[3]!.trim()
      ? [{ text: m[3]!.trim(), done: m[2] !== undefined && m[2] !== ' ', line }]
      : [];
  });
}

export const countOpen = (md: string) => parseQuestions(md).filter((q) => !q.done).length;

export function toggleQuestion(md: string, line: number): string {
  const lines = md.split('\n');
  const m = BULLET.exec(lines[line] ?? '');
  if (!m) return md;
  const done = m[2] !== undefined && m[2] !== ' ';
  lines[line] = `${m[1]}[${done ? ' ' : 'x'}] ${m[3]}`;
  return lines.join('\n');
}

export const INTUITION_KEY = 'intuition-very-important';
export const QUESTIONS_KEY = 'questions-i-still-have';

export interface TemplateSection {
  key: string;
  title: string;
  hint?: string;
}

/** Template sections the concept does not have yet, in template order. */
export function missingSections(
  have: { key: string }[],
  template: TemplateSection[],
): TemplateSection[] {
  const keys = new Set(have.map((s) => s.key));
  return template.filter((t) => !keys.has(t.key));
}

/** True for sections holding only whitespace or empty bullets (`- `), as left by a fresh template. */
export const isBlank = (md: string) => md.replace(/^\s*(?:[-*+]|\d+\.)\s*$/gm, '').trim() === '';
