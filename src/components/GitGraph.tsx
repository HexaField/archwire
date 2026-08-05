import { createSignal, For, Show } from 'solid-js';
import type { ChangeModel, ChangeNode } from '../lib/concepts';

export function GitGraph(props: {
  model: ChangeModel;
  selected: () => string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = createSignal(true);

  // only the two real lanes get a row; "converged" nodes sit on the right, centred
  const laneRows = props.model.lanes.filter((l) => l.id !== 'converged');
  const laneIdx = new Map(laneRows.map((l, i) => [l.id, i]));
  const rows = Math.max(1, laneRows.length);
  const laneColor = (id: string) => props.model.lanes.find((l) => l.id === id)?.color ?? '#8b949e';
  const isConverged = (n: ChangeNode) => n.lane === 'converged' || n.kind === 'merge';

  const nodes = props.model.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxLaneOrder = Math.max(1, ...nodes.filter((n) => !isConverged(n)).map((n) => n.order));

  const laneH = 58;
  const padX = 132;
  const padY = 28;
  const xStep = 118;
  const width = padX + (maxLaneOrder + 2) * xStep + 30;
  const height = padY * 2 + rows * laneH;
  const centerY = padY + (rows * laneH) / 2;

  const nx = (n: ChangeNode) =>
    isConverged(n) ? padX + Math.max(n.order, maxLaneOrder + 1) * xStep : padX + n.order * xStep;
  const ny = (n: ChangeNode) =>
    isConverged(n) ? centerY : padY + (laneIdx.get(n.lane) ?? 0) * laneH + laneH / 2;

  const edgePath = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };
  const shortTitle = (t: string) => (t.length > 14 ? `${t.slice(0, 13)}…` : t);

  return (
    <div class="gitgraph" classList={{ collapsed: !open() }}>
      <div class="gg-head">
        <button class="gg-toggle" onClick={() => setOpen(!open())}>
          {open() ? '▾' : '▸'} {props.model.initiative} — change graph
        </button>
        <span class="gg-hint">click a PR / plan to overlay its impact on the canvas</span>
      </div>
      <Show when={open()}>
        <div class="gg-scroll">
          <svg width={width} height={height}>
            <For each={laneRows}>
              {(l, i) => (
                <>
                  <line
                    x1={padX - 24}
                    y1={padY + i() * laneH + laneH / 2}
                    x2={width - 24}
                    y2={padY + i() * laneH + laneH / 2}
                    stroke="#21262d"
                    stroke-width="1"
                  />
                  <text x={8} y={padY + i() * laneH + laneH / 2 + 3} fill={l.color} font-size="10" font-family="monospace">
                    {l.name}
                  </text>
                </>
              )}
            </For>
            {/* edges (parent → node); merges curve both lanes into the right-centre node */}
            <For each={nodes}>
              {(n) => (
                <For each={n.parents}>
                  {(pid) => {
                    const p = byId.get(pid);
                    if (!p) return null;
                    const merge = isConverged(n);
                    return (
                      <path
                        d={edgePath(nx(p), ny(p), nx(n), ny(n))}
                        stroke={merge ? laneColor('converged') : '#3d4b5f'}
                        stroke-width={merge ? 2 : 1.5}
                        fill="none"
                        opacity={merge ? 0.85 : 0.8}
                      />
                    );
                  }}
                </For>
              )}
            </For>
            <For each={nodes}>
              {(n) => {
                const sel = () => props.selected() === n.id;
                const color = laneColor(n.lane);
                const merge = isConverged(n);
                const r = () => (merge ? (sel() ? 11 : 9) : sel() ? 9 : 7);
                return (
                  <g transform={`translate(${nx(n)},${ny(n)})`} style={{ cursor: 'pointer' }} onClick={() => props.onSelect(n.id)}>
                    <Show when={merge}>
                      <circle r={r() + 4} fill="none" stroke={color} stroke-width="1" opacity="0.4" />
                    </Show>
                    <circle
                      r={r()}
                      fill={n.status === 'planned' ? '#0d1117' : color}
                      stroke={color}
                      stroke-width={sel() ? 3 : 1.6}
                      stroke-dasharray={n.status === 'planned' ? '3 2' : ''}
                    />
                    <text x={0} y={merge ? -16 : -13} text-anchor="middle" fill={sel() ? '#f0f6fc' : '#adbac7'} font-size="9" font-family="monospace">
                      {n.ref ?? shortTitle(n.title)}
                    </text>
                    <text x={0} y={merge ? 22 : 20} text-anchor="middle" fill={merge ? color : '#6e7681'} font-size="8" font-family="monospace">
                      {merge ? 'converged' : n.ref ? shortTitle(n.title) : ''}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>
        </div>
      </Show>
    </div>
  );
}
