import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { useSettings } from './queries';

export interface Threat {
  level: 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH';
  score: number;
  daysSinceActivity: number | null;
  streak: number;
  overdue: number;
  explanation: string;
}
export interface DomainRow {
  name: string;
  weight: number;
  score: number;
  trend: number | null;
  parts: { concepts: number; commands: number; labs: number; recency: number };
  counts: { concepts: number; commands: number; labs: number };
}
export interface Recommendation {
  id: string;
  kind: string;
  title: string;
  why: string;
  route: string;
  priority: number;
}
export interface Overview {
  banner: { name: string; status: string; mode: string; threat: Threat };
  counts: Record<string, number>;
  kpis: {
    commandsMastered: number;
    commandsTotal: number;
    conceptsStudied: number;
    conceptsConfident: number;
    labsCompleted: number;
    labsTotal: number;
    activeProjects: number;
  };
  mastery: number[];
  labs: {
    byPlatform: Record<string, { total: number; completed: number }>;
    byStatus: Record<string, number>;
    byDifficulty: Record<string, number>;
  };
  timePerWeek: { week: string; minutes: number }[];
  streak: { current: number; longest: number };
  heatmap: { from: string; to: string; days: Record<string, number> };
  study: {
    due: number;
    overdue: number;
    newAvailable: number;
    newToday: number;
    reviewedToday: number;
    reviews30d: number;
    retention30d: number | null;
    newPerDay: number;
  };
  skillMap: DomainRow[];
  skillTrend: { day: string; scores: Record<string, number> }[];
  recommendations: Recommendation[];
  recent: { ts: string; type: string; collection?: string; id?: string; title?: string }[];
}

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>(`/stats/overview?tzOffset=${new Date().getTimezoneOffset()}`),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/** Chart colours read from the live CSS tokens so charts follow theme and accent. */
export function useTokens() {
  const { data } = useSettings();
  const read = () => {
    const css = getComputedStyle(document.documentElement);
    const g = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
    return {
      accent: g('--accent', '#38e8c6'),
      secondary: g('--secondary', '#8b5cf6'),
      text: g('--text', '#e8edf6'),
      muted: g('--text-muted', '#94a1b8'),
      border: g('--border', '#243044'),
      surface: g('--surface', '#0f141d'),
      success: g('--success', '#4ade80'),
      warning: g('--warning', '#fbbf24'),
      danger: g('--danger', '#fb7185'),
    };
  };
  const [t, setT] = useState(read);
  useEffect(() => setT(read()), [data?.theme, data?.accent]);
  return t;
}
