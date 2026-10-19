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

export const QUESTIONS_KEY = 'questions-i-still-have';
