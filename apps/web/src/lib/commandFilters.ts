import type { Command } from '@cipherkeep/shared';
import type { LibraryFilters } from './store';

export function filterCommands(
  all: Command[],
  f: Pick<LibraryFilters, 'category' | 'platform' | 'risk' | 'mastery' | 'favorite'>,
  rank?: Map<string, number>,
): Command[] {
  let out = all.filter((c) => !c.archived);
  if (rank) out = out.filter((c) => rank.has(c.id));
  if (f.category) out = out.filter((c) => c.category === f.category);
  if (f.platform)
    out = out.filter(
      (c) => c.platforms.includes(f.platform as never) || c.platforms.includes('any'),
    );
  if (f.risk) out = out.filter((c) => c.risk === f.risk);
  if (f.mastery !== '') out = out.filter((c) => String(c.mastery) === f.mastery);
  if (f.favorite) out = out.filter((c) => c.favorite);
  if (rank) out = [...out].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return out;
}

export const primaryExample = (c: Command): string => c.examples[0]?.command || c.syntax || c.name;
