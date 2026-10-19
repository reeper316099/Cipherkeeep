import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COLLECTIONS } from '@cipherkeep/shared';
import { api } from '../../lib/api';
import { layoutGraph } from '../../lib/graphLayout';

interface GNodeData {
  id: string;
  type: string;
  title: string;
  category: string;
  degree: number;
}
interface Graph {
  nodes: GNodeData[];
  edges: { source: string; target: string; kind: string }[];
}

const COLORS: Record<string, string> = {
  commands: '#38e8c6',
  concepts: '#8b5cf6',
  labs: '#fb7185',
  projects: '#fbbf24',
  log: '#22d3ee',
  notes: '#4ade80',
  snippets: '#f472b6',
};

export function GraphPage() {
  const nav = useNavigate();
  const [types, setTypes] = useState<string[]>([...COLLECTIONS]);
  const [orphans, setOrphans] = useState(false);
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<GNodeData | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });

  const { data, isLoading } = useQuery({
    queryKey: ['graph', types.join(','), orphans],
    queryFn: () => api<Graph>(`/graph?types=${types.join(',')}&includeOrphans=${orphans}`),
    enabled: types.length > 0,
  });
  const pos = useMemo(
    () =>
      data
        ? layoutGraph(
            data.nodes.map((n) => n.id),
            data.edges,
            { width: 1000, height: 700 },
          )
        : new Map(),
    [data],
  );
  const match = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n && data
      ? new Set(data.nodes.filter((x) => x.title.toLowerCase().includes(n)).map((x) => x.id))
      : null;
  }, [q, data]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: Math.max(360, el.clientHeight) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toScreen = (p: { x: number; y: number }) => ({
    x: ((p.x * size.w) / 1000) * view.k + view.x,
    y: ((p.y * size.h) / 700) * view.k + view.y,
  });

  useEffect(() => {
    const c = canvas.current;
    if (!c || !data) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, size.w, size.h);
    const css = getComputedStyle(document.documentElement);
    g.lineWidth = 1;
    for (const e of data.edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const A = toScreen(a);
      const B = toScreen(b);
      g.strokeStyle =
        e.kind === 'wikilink'
          ? css.getPropertyValue('--text-faint')
          : css.getPropertyValue('--border');
      g.setLineDash(e.kind === 'wikilink' ? [3, 3] : []);
      g.globalAlpha = match && !(match.has(e.source) || match.has(e.target)) ? 0.15 : 0.9;
      g.beginPath();
      g.moveTo(A.x, A.y);
      g.lineTo(B.x, B.y);
      g.stroke();
    }
    g.setLineDash([]);
    for (const n of data.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const P = toScreen(p);
      const r = 4 + Math.min(10, Math.sqrt(n.degree) * 2.2);
      g.globalAlpha = match && !match.has(n.id) ? 0.2 : 1;
      g.fillStyle = COLORS[n.type] ?? '#888';
      g.beginPath();
      g.arc(P.x, P.y, r, 0, Math.PI * 2);
      g.fill();
      if (hover?.id === n.id || match?.has(n.id) || view.k > 1.6) {
        g.globalAlpha = 1;
        g.fillStyle = css.getPropertyValue('--text');
        g.font = '12px Inter Variable, system-ui, sans-serif';
        g.fillText(n.title, P.x + r + 4, P.y + 4);
      }
    }
    g.globalAlpha = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pos, size, view, hover, match]);

  const hit = (cx: number, cy: number) => {
    if (!data) return null;
    let best: GNodeData | null = null;
    let bd = 14;
    for (const n of data.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const P = toScreen(p);
      const d = Math.hypot(P.x - cx, P.y - cy);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  const rel = (e: React.PointerEvent | React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div
      className="pad"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
    >
      <div className="rowflex">
        <h1 className="page-title" style={{ margin: 0 }}>
          Knowledge graph
        </h1>
        <span style={{ flex: 1 }} />
        <input
          className="input"
          style={{ width: 220 }}
          type="search"
          aria-label="Highlight nodes"
          placeholder="Highlight by title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="rowflex" style={{ gap: 6 }}>
          <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />{' '}
          show unlinked
        </label>
        <button className="btn ghost" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
          Reset view
        </button>
      </div>
      <div className="rowflex" role="group" aria-label="Filter by type">
        {COLLECTIONS.map((c) => (
          <button
            key={c}
            className="chip"
            style={{
              borderColor: types.includes(c) ? COLORS[c] : undefined,
              opacity: types.includes(c) ? 1 : 0.5,
            }}
            aria-pressed={types.includes(c)}
            onClick={() =>
              setTypes(types.includes(c) ? types.filter((x) => x !== c) : [...types, c])
            }
          >
            <i
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: COLORS[c],
                display: 'inline-block',
              }}
            />{' '}
            {c}
          </button>
        ))}
        <span className="faint" style={{ fontSize: 12 }}>
          solid line = relation · dashed = [[wiki link]] · scroll to zoom, drag to pan, click a node
          to open
        </span>
      </div>
      <div
        ref={wrap}
        className="card"
        style={{ flex: 1, minHeight: 420, position: 'relative', overflow: 'hidden' }}
      >
        {isLoading && <div className="empty">Loading…</div>}
        {data && data.nodes.length === 0 && (
          <div className="empty">
            <h3>Nothing linked yet</h3>
            <span>
              Relate commands to concepts or labs, or write [[wiki links]]. Turn on “show unlinked”
              to see every item.
            </span>
          </div>
        )}
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Knowledge graph with ${data?.nodes.length ?? 0} nodes and ${data?.edges.length ?? 0} links. A table of the same data follows.`}
          style={{
            width: size.w,
            height: size.h,
            display: 'block',
            cursor: hover ? 'pointer' : 'grab',
            touchAction: 'none',
          }}
          onWheel={(e) => {
            e.preventDefault();
            const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            const m = rel(e);
            setView((v) => {
              const k = Math.max(0.4, Math.min(6, v.k * f));
              return { k, x: m.x - ((m.x - v.x) / v.k) * k, y: m.y - ((m.y - v.y) / v.k) * k };
            });
          }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) {
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
              if (d.moved) {
                setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
                d.x = e.clientX;
                d.y = e.clientY;
              }
            } else {
              const m = rel(e);
              setHover(hit(m.x, m.y));
            }
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved) {
              const m = rel(e);
              const n = hit(m.x, m.y);
              if (n) nav(`/${n.type}/${n.id}`);
            }
          }}
          onPointerLeave={() => setHover(null)}
        />
        {hover && (
          <div className="graph-tip">
            {hover.title}{' '}
            <span className="faint">
              · {hover.type} · {hover.degree} links
            </span>
          </div>
        )}
      </div>
      <details>
        <summary className="muted">Graph data as a list (accessible alternative)</summary>
        <ul>
          {data?.nodes.map((n) => (
            <li key={n.id}>
              <a href={`#/${n.type}/${n.id}`}>{n.title}</a>{' '}
              <span className="faint">
                ({n.type}, {n.degree} links)
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
