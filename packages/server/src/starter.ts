import {
  countOpen,
  detectPlaceholders,
  QUESTIONS_KEY,
  type CollectionName,
} from '@cipherkeep/shared';
import commandsData from '../../../starter-pack/commands.json';
import conceptsData from '../../../starter-pack/concepts.json';
import labsData from '../../../starter-pack/labs.json';
import notesData from '../../../starter-pack/notes.json';
import type { Plan, PlanItem, RelTarget } from './import/types.ts';
import { slugify } from './util.ts';

/** The starter pack ships inside the app (the JSON files are bundled at build time). */
export const STARTER_TAG = 'starter';
export const STARTER_REF_PREFIX = 'starter:';

interface RawCommand {
  name: string;
  category: string;
  platforms: string[];
  risk: string;
  syntax: string;
  explanation: string;
  whatItDoes: string;
  arguments: [string, string][];
  options: [string, string][];
  examples: [string, string][];
  notes: string;
}
interface RawConcept {
  title: string;
  category: string;
  difficulty: string;
  tags: string[];
  relatedCommands: string[];
  relatedConcepts: string[];
  sections: { key: string; title: string; markdown: string }[];
}
interface RawNote {
  title: string;
  folder: string;
  kind: string;
  tags: string[];
  markdown: string;
}
interface RawLab {
  title: string;
  platform: string;
  difficulty: string;
  domain: string;
  commands: string[];
  concepts: string[];
  writeup: string;
}

export const starterCounts = () => ({
  commands: commandsData.length,
  concepts: conceptsData.length,
  notes: notesData.length,
  labs: labsData.length,
});

const ref = (c: CollectionName, key: string) => `${STARTER_REF_PREFIX}${c}:${key}`;

export function planStarter(): Plan {
  const items: PlanItem[] = [];
  const cmdRefs = new Map<string, string>();
  const conceptRefs = new Map<string, string>();

  for (const c of commandsData as unknown as RawCommand[]) {
    const r = ref('commands', c.name);
    cmdRefs.set(c.name, r);
    items.push({
      collection: 'commands',
      ref: r,
      title: c.name,
      source: 'starter-pack/commands.json',
      warnings: [],
      relations: [],
      input: {
        name: c.name,
        title: c.name,
        category: c.category,
        platforms: c.platforms,
        risk: c.risk,
        syntax: c.syntax,
        explanation: c.explanation,
        whatItDoes: c.whatItDoes,
        arguments: c.arguments.map(([name, meaning]) => ({ name, meaning })),
        options: c.options.map(([flag, meaning]) => ({ flag, meaning })),
        examples: c.examples.map(([command, description]) => ({ command, description })),
        placeholders: detectPlaceholders(c.syntax, ...c.examples.map((e) => e[0])),
        notes: c.notes,
        tags: [STARTER_TAG],
        extras: { source: 'starter-pack' },
      },
    });
  }

  const targets = (names: string[], map: Map<string, string>): RelTarget[] =>
    names.flatMap((n) => (map.has(n) ? [{ ref: map.get(n)! }] : []));

  for (const k of conceptsData as unknown as RawConcept[])
    conceptRefs.set(k.title, ref('concepts', k.title));
  for (const k of conceptsData as unknown as RawConcept[]) {
    const q = k.sections.find((s) => s.key === QUESTIONS_KEY)?.markdown ?? '';
    items.push({
      collection: 'concepts',
      ref: conceptRefs.get(k.title)!,
      title: k.title,
      source: 'starter-pack/concepts.json',
      warnings: [],
      input: {
        title: k.title,
        category: k.category,
        difficulty: k.difficulty,
        tags: [STARTER_TAG, ...k.tags],
        sections: k.sections,
        questionsOpen: countOpen(q),
        extras: { source: 'starter-pack' },
      },
      relations: [
        { field: 'relatedCommandIds', targets: targets(k.relatedCommands, cmdRefs) },
        { field: 'relatedConceptIds', targets: targets(k.relatedConcepts, conceptRefs) },
      ].filter((r) => r.targets.length),
    });
  }

  for (const n of notesData as unknown as RawNote[]) {
    items.push({
      collection: 'notes',
      ref: ref('notes', n.title),
      title: n.title,
      source: 'starter-pack/notes.json',
      warnings: [],
      relations: [],
      input: {
        title: n.title,
        folder: n.folder.split('/').map(slugify).join('/'),
        kind: n.kind,
        tags: [STARTER_TAG, ...n.tags.filter((t) => t !== STARTER_TAG)],
        markdown: n.markdown,
      },
    });
  }

  for (const l of labsData as unknown as RawLab[]) {
    items.push({
      collection: 'labs',
      ref: ref('labs', l.title),
      title: l.title,
      source: 'starter-pack/labs.json',
      warnings: [],
      input: {
        title: l.title,
        platform: l.platform,
        category: l.platform,
        difficulty: l.difficulty,
        domain: l.domain,
        status: 'Not Started',
        writeup: l.writeup,
        tags: [STARTER_TAG],
      },
      relations: [
        { field: 'commandIds', targets: targets(l.commands, cmdRefs) },
        { field: 'conceptIds', targets: targets(l.concepts, conceptRefs) },
      ].filter((r) => r.targets.length),
    });
  }

  return {
    kind: 'json-backup',
    sourceName: 'Cipherkeep starter pack',
    items,
    templates: [],
    attachments: [],
    databases: [],
    warnings: [],
  };
}
