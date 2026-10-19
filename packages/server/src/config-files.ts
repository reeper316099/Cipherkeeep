import { z } from 'zod';
import type { CollectionName } from '@cipherkeep/shared';

export const SettingsSchema = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).default('dark'),
    accent: z.string().default('#38e8c6'),
    density: z.enum(['comfortable', 'compact']).default('comfortable'),
    storeFlagsInLabs: z.boolean().default(false),
    blurSensitive: z.boolean().default(false),
    vimMode: z.boolean().default(false),
    backupKeep: z.number().int().min(1).max(200).default(20),
    backupIntervalHours: z.number().min(1).max(168).default(6),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;

const OptionSchema = z.object({ name: z.string().min(1), color: z.string().optional() });
export const CategoriesSchema = z.record(z.array(OptionSchema));
export type Categories = z.infer<typeof CategoriesSchema>;

/** Seed option names come from the user's Notion databases (the export carries no colors). */
export const DEFAULT_CATEGORIES: Categories = {
  commands: ['File System', 'Networking', 'Permissions', 'Text Processing', 'General'].map(
    (name) => ({ name }),
  ),
  concepts: ['Linux', 'Bash', 'Networking', 'Web Security'].map((name) => ({ name })),
  labs: ['picoCTF', 'TryHackMe', 'Bandit'].map((name) => ({ name })),
  projects: ['Website', 'Tool', 'Script'].map((name) => ({ name })),
};

export const SkillsSchema = z.array(
  z.object({ name: z.string().min(1), weight: z.number().min(0).max(10).default(1) }),
);
export const DEFAULT_SKILLS = [
  'Linux',
  'Bash',
  'Networking',
  'Web Security',
  'Windows',
  'Cryptography',
  'Forensics',
  'OSINT',
  'Log Analysis',
  'Scanning & Recon',
  'Password Cracking',
  'Reverse Engineering',
  'Binary Exploitation',
].map((name) => ({ name, weight: 1 }));

export const TemplateSchema = z.object({
  name: z.string(),
  sections: z.array(z.object({ key: z.string(), title: z.string(), hint: z.string().optional() })),
});
export type Template = z.infer<typeof TemplateSchema>;

const t = (name: string, titles: string[]): Template => ({
  name,
  sections: titles.map((title) => ({
    key: title
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-$/, ''),
    title,
  })),
});

export const DEFAULT_TEMPLATES: Partial<Record<CollectionName, Template>> = {
  commands: t('Command', [
    '📌 What it does',
    '⚙️ Basic Syntax',
    '🧩 Arguments',
    '🔧 Common Options (Flags)',
    '💡 Examples',
  ]),
  concepts: t('Cyber Concept', [
    '🧠 What is it?',
    '⚙️ How it works (Step-by-step)',
    '🧩 Key Components',
    '🔁 Example / Walkthrough',
    '💡 Why it matters',
    '⚔️ Security Relevance',
    '🛠️ Tools / Commands Related',
    '🔗 Related Concepts',
    '⚠️ Common Mistakes / Misconceptions',
    '🧠 Intuition (VERY IMPORTANT)',
    '📚 Source / Where I learned this',
    '🔥 Difficulty Level',
    '❓ Questions I still have',
  ]),
  labs: t('Lab', ['🎯 Goal', '🔍 Process', '💥 Solution', '🧠 What I learned', '🛠️ Commands Used']),
  log: t('Learning Log', [
    '📚 What I learned',
    '⚡ Key insight',
    '❓ Questions',
    '🔁 Review later',
  ]),
};
