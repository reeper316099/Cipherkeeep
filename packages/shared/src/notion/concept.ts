import { headingKey, normalizeTitle } from './names.ts';
import { splitSections } from './markdown.ts';

const DIFFICULTY_MAP: Record<string, string> = {
  beginner: 'Easy',
  easy: 'Easy',
  intermediate: 'Medium',
  medium: 'Medium',
  advanced: 'Hard',
  hard: 'Hard',
};

export function mapDifficulty(raw: string | undefined): string {
  const k = (raw ?? '').trim().toLowerCase();
  return DIFFICULTY_MAP[k] ?? (raw?.trim() || 'Easy');
}

/** Real bullets only: skips empty `-` items and unfilled template stubs. */
export function bulletItems(md: string): string[] {
  return md
    .split('\n')
    .map((l) => /^\s*(?:[-*+]|\d+\.)\s*(.*)$/.exec(l)?.[1]?.trim() ?? '')
    .filter((t) => t && !/^(component|step) \d$/i.test(t));
}

export interface ParsedConcept {
  input: Record<string, unknown>;
  /** Titles mentioned in the "Tools / Commands Related" section, for relation resolution. */
  commandMentions: string[];
  conceptMentions: string[];
  warnings: string[];
}

export function parseConceptPage(src: {
  name: string;
  category?: string;
  difficulty?: string;
  tags?: string[];
  body: string;
}): ParsedConcept {
  const { sections, preamble } = splitSections(src.body);
  const warnings: string[] = [];
  const out = sections.map((s) => ({ key: s.key, title: s.title, markdown: s.markdown }));
  if (preamble) out.unshift({ key: 'intro', title: 'Intro', markdown: preamble });
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const questions = byKey.get(headingKey('Questions I still have'));
  const tools = byKey.get('tools-commands-related');
  const related = byKey.get('related-concepts');
  const diffSection = byKey.get('difficulty-level')?.markdown.trim();
  const difficulty = mapDifficulty(src.difficulty || diffSection);
  return {
    warnings,
    commandMentions: tools ? bulletItems(tools.markdown) : [],
    conceptMentions: related ? bulletItems(related.markdown) : [],
    input: {
      title: src.name,
      category: src.category ?? '',
      tags: src.tags ?? [],
      difficulty,
      sections: out,
      questionsOpen: questions ? bulletItems(questions.markdown).length : 0,
    },
  };
}

export const titleKey = normalizeTitle;
