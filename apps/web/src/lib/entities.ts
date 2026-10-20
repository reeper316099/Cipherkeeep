import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  COLLECTIONS,
  buildTitleIndex,
  type CollectionName,
  type Command,
  type Concept,
  type Lab,
  type LogEntry,
  type Note,
  type Project,
  type Snippet,
} from '@cipherkeep/shared';
import { api, listAll } from './api';

export interface EntityMap {
  commands: Command;
  concepts: Concept;
  labs: Lab;
  projects: Project;
  log: LogEntry;
  notes: Note;
  snippets: Snippet;
}
export type EntityName = CollectionName;

/** Note bodies dominate list size at 10k notes; the editor fetches the full note on demand. */
const LIST_OMIT: Partial<Record<EntityName, string[]>> = { notes: ['markdown'] };

export function useEntities<K extends EntityName>(name: K) {
  return useQuery({
    queryKey: ['coll', name],
    queryFn: () => listAll<EntityMap[K]>(name, LIST_OMIT[name]),
    staleTime: 30_000,
  });
}

/** Title index over every collection, for [[wiki-link]] resolution and pickers. */
export function useTitleIndex() {
  const results = useQueries({
    queries: COLLECTIONS.map((c) => ({
      queryKey: ['coll', c],
      queryFn: () =>
        listAll<{ id: string; title: string; name?: string; archived: boolean }>(c, LIST_OMIT[c]),
      staleTime: 30_000,
    })),
  });
  const sig = results.map((r) => r.dataUpdatedAt).join(',');
  return useMemo(
    () =>
      buildTitleIndex(
        results.flatMap((r, i) =>
          (r.data ?? [])
            .filter((e) => !e.archived)
            .map((e) => ({
              type: COLLECTIONS[i]!,
              id: e.id,
              title: e.title,
              name: COLLECTIONS[i] === 'commands' ? e.name : undefined,
            })),
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
}

export function useEntityMutations<K extends EntityName>(name: K) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['coll', name] });
    void qc.invalidateQueries({ queryKey: ['meta'] });
    void qc.invalidateQueries({ queryKey: ['search'] });
    void qc.invalidateQueries({ queryKey: ['links'] });
    void qc.invalidateQueries({ queryKey: ['graph'] });
    void qc.invalidateQueries({ queryKey: ['overview'] });
  };
  return {
    create: useMutation({
      mutationFn: (payload: Record<string, unknown>) =>
        api<EntityMap[K]>(`/${name}`, { method: 'POST', json: payload }),
      onSuccess: refresh,
    }),
    patch: useMutation({
      mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
        api<EntityMap[K]>(`/${name}/${id}`, { method: 'PATCH', json: payload }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/${name}/${id}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

/** One full entity (list responses may omit bulky fields). */
export function useEntity<K extends EntityName>(name: K, id: string | undefined) {
  return useQuery({
    queryKey: ['coll', name, 'item', id],
    queryFn: () => api<EntityMap[K]>(`/${name}/${id}`),
    enabled: !!id,
  });
}

export interface LinkRef {
  id: string;
  type: EntityName;
  title: string;
  kind: 'relation' | 'wikilink';
}
export const useBacklinks = (id: string | undefined) =>
  useQuery({
    queryKey: ['links', 'back', id],
    queryFn: () => api<LinkRef[]>(`/entities/${id}/backlinks`),
    enabled: !!id,
  });
export const useOutgoing = (id: string | undefined) =>
  useQuery({
    queryKey: ['links', 'out', id],
    queryFn: () => api<LinkRef[]>(`/entities/${id}/links`),
    enabled: !!id,
  });
