import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useUI } from './store';

export interface VaultStatus {
  enabled: boolean;
  locked: boolean;
  busy: boolean;
}

export const vaultKey = ['vault'] as const;

export function useVaultStatus() {
  return useQuery({
    queryKey: vaultKey,
    queryFn: () => api<VaultStatus>('/vault'),
    staleTime: 5_000,
    retry: false,
  });
}

/** Forget everything decrypted in this window (cached lists, typed placeholder values) after a lock. */
/** Drops every cached query except the vault status (observers stay attached to that one). */
export function dropCached(qc: QueryClient): void {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== vaultKey[0] });
}

export function useForgetEverything() {
  const qc = useQueryClient();
  const clearValues = useUI((s) => s.clearValues);
  return (locked: boolean) => {
    dropCached(qc);
    clearValues();
    qc.setQueryData<VaultStatus>(vaultKey, { enabled: locked, locked, busy: false });
  };
}

export const useLockNow = () => {
  const forget = useForgetEverything();
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/vault/lock', { method: 'POST' }),
    onSuccess: () => forget(true),
  });
};
