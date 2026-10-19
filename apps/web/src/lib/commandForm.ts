import {
  splitExampleLine,
  detectPlaceholders,
  classifyRisk,
  type Command,
} from '@cipherkeep/shared';

/** Editor text areas ⇄ structured fields. */
export const examplesToText = (c: Command['examples']) =>
  c.map((e) => (e.description ? `${e.command} = "${e.description}"` : e.command)).join('\n');
export const textToExamples = (t: string): Command['examples'] =>
  t.split('\n').flatMap((l) => {
    const x = splitExampleLine(l);
    return x ? [x] : [];
  });

export const optionsToText = (o: Command['options']) =>
  o.map((x) => `${x.flag} | ${x.meaning}`).join('\n');
export const textToOptions = (t: string): Command['options'] =>
  t.split('\n').flatMap((l) => {
    const i = l.indexOf('|');
    const flag = (i < 0 ? l : l.slice(0, i)).trim();
    return flag ? [{ flag, meaning: i < 0 ? '' : l.slice(i + 1).trim() }] : [];
  });

export const argsToText = (a: Command['arguments']) =>
  a.map((x) => `${x.name} → ${x.meaning}`).join('\n');
export const textToArgs = (t: string): Command['arguments'] =>
  t.split('\n').flatMap((l) => {
    const m = /^(.*?)\s*(?:→|->)\s*(.*)$/.exec(l.trim());
    const name = (m ? m[1]! : l.trim()).trim();
    return name ? [{ name, meaning: m ? m[2]!.trim() : '' }] : [];
  });

export interface CommandDraft {
  name: string;
  category: string;
  platforms: Command['platforms'];
  risk: Command['risk'];
  syntax: string;
  explanation: string;
  whatItDoes: string;
  examples: string;
  options: string;
  arguments: string;
  notes: string;
  tags: string;
}

export const emptyDraft = (): CommandDraft => ({
  name: '',
  category: '',
  platforms: ['any'],
  risk: 'safe',
  syntax: '',
  explanation: '',
  whatItDoes: '',
  examples: '',
  options: '',
  arguments: '',
  notes: '',
  tags: '',
});

export const draftFrom = (c: Command): CommandDraft => ({
  name: c.name,
  category: c.category,
  platforms: c.platforms,
  risk: c.risk,
  syntax: c.syntax,
  explanation: c.explanation,
  whatItDoes: c.whatItDoes,
  examples: examplesToText(c.examples),
  options: optionsToText(c.options),
  arguments: argsToText(c.arguments),
  notes: c.notes,
  tags: c.tags.join(', '),
});

/** Payload for POST/PATCH. Risk is auto-derived only when the user left it at the default. */
export function draftToPayload(d: CommandDraft) {
  const examples = textToExamples(d.examples);
  return {
    name: d.name.trim(),
    title: d.name.trim(),
    category: d.category.trim(),
    platforms: d.platforms,
    risk:
      d.risk === 'safe'
        ? classifyRisk(
            d.name,
            examples.map((e) => e.command),
          )
        : d.risk,
    syntax: d.syntax,
    explanation: d.explanation,
    whatItDoes: d.whatItDoes,
    examples,
    options: textToOptions(d.options),
    arguments: textToArgs(d.arguments),
    placeholders: detectPlaceholders(d.syntax, ...examples.map((e) => e.command)),
    notes: d.notes,
    tags: d.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
}
