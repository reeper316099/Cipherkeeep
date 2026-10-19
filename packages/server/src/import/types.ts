import type { CollectionName } from '@cipherkeep/shared';

export type Strategy = 'skip' | 'update-empty-only' | 'overwrite' | 'keep-both';
export type SourceKind = 'notion' | 'csv' | 'markdown' | 'json-backup';

/** Target of a relation: either another item in this plan, or an entity already in the store. */
export type RelTarget = { ref: string } | { id: string };

export interface PlanItem {
  collection: CollectionName;
  /** Stable identity for idempotent re-import: Notion page id, or `csv:`/`md:` + normalised title. */
  ref: string;
  title: string;
  /** Fields to create/merge. Only keys we actually derived (no schema defaults). */
  input: Record<string, unknown>;
  relations: { field: string; targets: RelTarget[] }[];
  source: string;
  warnings: string[];
  /** Alternative classifications for loose pages (note ⇄ snippet). */
  alternatives?: Partial<Record<CollectionName, Record<string, unknown>>>;
  skipByDefault?: string;
  /** Preserve this id (JSON backup restore) so cross-references stay valid. */
  fixedId?: string;
}

export interface PlanWarning {
  level: 'info' | 'warning';
  code: string;
  message: string;
  source?: string;
}

export interface PlanDatabase {
  csv: string;
  title: string;
  collection: CollectionName | null;
  rows: number;
  headers: string[];
}

export interface PlanTemplate {
  collection: CollectionName;
  template: { name: string; sections: { key: string; title: string; hint?: string }[] };
  source: string;
}

export interface PlanAttachment {
  from: string; // path inside the source
  to: string; // path under <dataDir>/attachments
  bytes: number;
}

export interface Plan {
  kind: SourceKind;
  sourceName: string;
  items: PlanItem[];
  templates: PlanTemplate[];
  attachments: PlanAttachment[];
  databases: PlanDatabase[];
  warnings: PlanWarning[];
}

export interface ImportOptions {
  strategy: Strategy;
  /** Per-ref reclassification of loose pages: 'note' | 'snippet' | 'skip' | 'include'. */
  overrides?: Record<string, string>;
}

export interface ImportReport {
  id: string;
  kind: SourceKind;
  sourceName: string;
  strategy: Strategy;
  createdAt: string;
  created: Record<string, number>;
  updated: Record<string, number>;
  unchanged: Record<string, number>;
  skipped: { ref: string; title: string; reason: string }[];
  templates: string[];
  attachments: number;
  warnings: PlanWarning[];
  itemWarnings: { collection: string; title: string; warnings: string[] }[];
  snapshot: string | null;
}

export interface ImportManifest {
  id: string;
  createdAt: string;
  created: { collection: CollectionName; id: string }[];
  updated: { collection: CollectionName; id: string; before: unknown }[];
  templates: { collection: CollectionName; before: string | null }[];
  attachments: string[];
  undone?: string;
}
