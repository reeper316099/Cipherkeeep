import { splitSections } from './markdown.ts';
import { parseNotionDate, parseTimeSpent } from './time.ts';
import { bulletItems } from './concept.ts';

export interface ParsedLog {
  input: Record<string, unknown>;
  /** Bullet titles under "What I learned", for command/concept resolution. */
  learned: string[];
  warnings: string[];
}

export function parseLogEntry(src: {
  name: string;
  date?: string;
  timeSpent?: string;
  topics?: string;
  keyTakeaway?: string;
  body: string;
}): ParsedLog {
  const warnings: string[] = [];
  const date = parseNotionDate(src.date) ?? parseNotionDate(src.name);
  if (!date) warnings.push(`could not parse date "${src.date ?? src.name}"`);
  const minutes = parseTimeSpent(src.timeSpent);
  if (src.timeSpent && minutes === null)
    warnings.push(`could not parse time spent "${src.timeSpent}" (raw kept)`);
  const { sections } = splitSections(src.body);
  const learned = sections.find((s) => s.key === 'what-i-learned');
  return {
    warnings,
    learned: learned ? bulletItems(learned.markdown) : [],
    input: {
      title: src.name,
      date: date ?? '1970-01-01',
      timeSpentMin: minutes,
      timeSpentRaw: src.timeSpent || null,
      topics: (src.topics ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      topicsRaw: src.topics || null,
      keyTakeaway: src.keyTakeaway ?? '',
      body: src.body,
    },
  };
}
