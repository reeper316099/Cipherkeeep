/** The single place the product name lives. */
export const APP_NAME = 'Cipherkeep';

/** Env var that overrides the data directory. */
export const DATA_DIR_ENV = 'CIPHERKEEP_DATA_DIR';

export const COLLECTIONS = [
  'commands',
  'concepts',
  'labs',
  'projects',
  'log',
  'notes',
  'snippets',
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];
