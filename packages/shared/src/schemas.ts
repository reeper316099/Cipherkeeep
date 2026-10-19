import { z } from 'zod';

const isoDate = z.string().min(1);
const mastery = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const LinkSchema = z.object({ type: z.string(), targetId: z.string() });

/** Fields shared by every entity. */
export const CommonSchema = z.object({
  id: z.string().min(1), // ulid
  title: z.string(),
  slug: z.string(),
  category: z.string().default(''),
  tags: z.array(z.string()).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
  favorite: z.boolean().default(false),
  archived: z.boolean().default(false),
  importRef: z.string().optional(),
  links: z.array(LinkSchema).default([]),
  /** Raw/unknown source data kept when parsing is ambiguous; never dropped. */
  extras: z.record(z.unknown()).default({}),
});
export type Common = z.infer<typeof CommonSchema>;

export const PlatformSchema = z.enum(['linux', 'macos', 'windows', 'any']);
export const RiskSchema = z.enum(['safe', 'caution', 'destructive']);

export const CommandSchema = CommonSchema.extend({
  name: z.string(),
  platforms: z.array(PlatformSchema).default(['any']),
  whatItDoes: z.string().default(''),
  syntax: z.string().default(''),
  explanation: z.string().default(''),
  arguments: z.array(z.object({ name: z.string(), meaning: z.string() })).default([]),
  options: z.array(z.object({ flag: z.string(), meaning: z.string() })).default([]),
  examples: z.array(z.object({ command: z.string(), description: z.string() })).default([]),
  placeholders: z.array(z.string()).default([]),
  risk: RiskSchema.default('safe'),
  notes: z.string().default(''),
  mastery: mastery.default(0),
  lastPracticedAt: isoDate.optional(),
  practiceCount: z.number().int().nonnegative().default(0),
  srs: z
    .object({
      ease: z.number().default(2.5),
      intervalDays: z.number().default(0),
      dueAt: isoDate.optional(),
    })
    .default({}),
});
export type Command = z.infer<typeof CommandSchema>;

export const ConceptSchema = CommonSchema.extend({
  difficulty: z.string().default('Easy'),
  sections: z
    .array(z.object({ key: z.string(), title: z.string(), markdown: z.string() }))
    .default([]),
  relatedCommandIds: z.array(z.string()).default([]),
  relatedConceptIds: z.array(z.string()).default([]),
  confidence: mastery.default(0),
  questionsOpen: z.number().int().nonnegative().default(0),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const LabStatusSchema = z.enum(['Not Started', 'In Progress', 'Completed']);

export const LabSchema = CommonSchema.extend({
  platform: z.string(),
  status: LabStatusSchema.default('Not Started'),
  difficulty: z.string().default('Easy'),
  domain: z.string().optional(),
  points: z.number().optional(),
  solvedAt: isoDate.optional(),
  timeSpentMin: z.number().nonnegative().optional(),
  hintsUsed: z.number().int().nonnegative().optional(),
  commandIds: z.array(z.string()).default([]),
  conceptIds: z.array(z.string()).default([]),
  writeup: z.string().default(''),
  writeupPrivate: z.boolean().default(true),
  scriptIds: z.array(z.string()).default([]),
});
export type Lab = z.infer<typeof LabSchema>;

export const ProjectSchema = CommonSchema.extend({
  type: z.string().default('Script'),
  status: z.enum(['Not started', 'In progress', 'Done']).default('Not started'),
  skillsUsed: z.array(z.string()).default([]),
  conceptIds: z.array(z.string()).default([]),
  repoUrl: z.string().optional(),
  notes: z.string().default(''),
});
export type Project = z.infer<typeof ProjectSchema>;

export const LogEntrySchema = CommonSchema.extend({
  date: z.string(), // YYYY-MM-DD
  timeSpentMin: z.number().nonnegative().nullable().default(null),
  timeSpentRaw: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  topicsRaw: z.string().nullable().default(null),
  keyTakeaway: z.string().default(''),
  body: z.string().default(''), // learned / insight / questions / review-later sections
  conceptIds: z.array(z.string()).default([]),
  commandIds: z.array(z.string()).default([]),
  labIds: z.array(z.string()).default([]),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const NoteSchema = CommonSchema.extend({
  folder: z.string().default(''),
  markdown: z.string().default(''),
  kind: z.enum(['cheatsheet', 'guide', 'writeup-notes', 'general']).default('general'),
});
export type Note = z.infer<typeof NoteSchema>;

export const SnippetSchema = CommonSchema.extend({
  language: z.string().default('text'),
  code: z.string().nullable().default(null),
  filePath: z.string().nullable().default(null),
  description: z.string().default(''),
});
export type Snippet = z.infer<typeof SnippetSchema>;

export const SCHEMAS = {
  commands: CommandSchema,
  concepts: ConceptSchema,
  labs: LabSchema,
  projects: ProjectSchema,
  log: LogEntrySchema,
  notes: NoteSchema,
  snippets: SnippetSchema,
} as const;
