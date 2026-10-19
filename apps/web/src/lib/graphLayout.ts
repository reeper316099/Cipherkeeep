export interface GNode {
  id: string;
  x: number;
  y: number;
}
export interface GEdge {
  source: string;
  target: string;
}

/**
 * Fruchterman–Reingold layout. Deterministic (seeded ring start), O(n²) per iteration, so cost is
 * capped by shrinking the iteration count for big graphs.
 */
export function layoutGraph(
  ids: string[],
  edges: GEdge[],
  opts: { width?: number; height?: number; iterations?: number } = {},
): Map<string, { x: number; y: number }> {
  const W = opts.width ?? 1000;
  const H = opts.height ?? 700;
  const n = ids.length;
  const pos = new Map<string, { x: number; y: number }>();
  if (!n) return pos;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const index = new Map(ids.map((id, i) => [id, i]));
  ids.forEach((_, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = Math.min(W, H) * 0.35 * (0.6 + (0.4 * ((i * 7919) % 13)) / 13);
    px[i] = W / 2 + Math.cos(a) * r;
    py[i] = H / 2 + Math.sin(a) * r;
  });
  const iterations = Math.max(
    30,
    Math.min(opts.iterations ?? 250, Math.floor(60_000_000 / (n * n + 1))),
  );
  const k = Math.sqrt((W * H) / n) * 0.42;
  const links = edges.flatMap((e) =>
    index.has(e.source) && index.has(e.target)
      ? [[index.get(e.source)!, index.get(e.target)!] as const]
      : [],
  );
  let t = W / 8;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = px[i]! - px[j]!;
        let vy = py[i]! - py[j]!;
        let d2 = vx * vx + vy * vy;
        if (d2 < 0.01) {
          vx = (i - j) * 0.1;
          vy = 0.1;
          d2 = vx * vx + vy * vy;
        }
        const f = (k * k) / d2; // repulsion k²/d, applied along the unit vector
        dx[i]! += vx * f;
        dy[i]! += vy * f;
        dx[j]! -= vx * f;
        dy[j]! -= vy * f;
      }
    }
    for (const [a, b] of links) {
      const vx = px[a]! - px[b]!;
      const vy = py[a]! - py[b]!;
      const d = Math.sqrt(vx * vx + vy * vy) || 0.01;
      const f = d / k; // attraction d²/k, along the unit vector
      dx[a]! -= vx * f;
      dy[a]! -= vy * f;
      dx[b]! += vx * f;
      dy[b]! += vy * f;
    }
    for (let i = 0; i < n; i++) {
      // gentle pull to the centre keeps disconnected components in view
      dx[i]! += (W / 2 - px[i]!) * 0.06;
      dy[i]! += (H / 2 - py[i]!) * 0.06;
      const d = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 1;
      const s = Math.min(d, t) / d;
      px[i]! += dx[i]! * s;
      py[i]! += dy[i]! * s;
      px[i] = Math.max(20, Math.min(W - 20, px[i]!));
      py[i] = Math.max(20, Math.min(H - 20, py[i]!));
    }
    t *= 0.98;
  }
  ids.forEach((id, i) => pos.set(id, { x: px[i]!, y: py[i]! }));
  return pos;
}
