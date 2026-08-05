import { createSignal, For, Show } from 'solid-js';
import type { ChangeModel, ChangeNode } from '../lib/concepts';

export function GitGraph(props: {
  model: ChangeModel;
  selected: () => string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = createSignal(true);

  const lanes = props.model.lanes;
  const laneIdx = new Map(lanes.map((l, i) => [l.id, i]));
  const laneColor = (id: string) => lanes.find((l) => l.id === id)?.color ?? '#8b949e';
  const nodes = props.model.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const maxOrder = Math.max(1, ...nodes.map((n) => n.order));
  const laneH = 56;
  const padX = 130;
  const padY = 26;
  const xStep = 116;
  const width = padX + (maxOrder + 1) * xStep + 30;
  const height = padY * 2 + lanes.length * laneH;

  const nx = (n: ChangeNode) => padX + n.order * xStep;
  const ny = (n: ChangeNode) => padY + (laneIdx.get(n.lane) ?? 0) * laneH + laneH / 2;
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
            <For each={lanes}>
              {(l, i) => (
                <>
                  <line
                    x1={padX - 24}
                    y1={padY + i() * laneH + laneH / 2}
                    x2={width - 20}
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
            <For each={nodes}>
              {(n) => (
                <For each={n.parents}>
                  {(pid) => {
                    const p = byId.get(pid);
                    if (!p) return null;
                    return <path d={edgePath(nx(p), ny(p), nx(n), ny(n))} stroke="#3d4b5f" stroke-width="1.5" fill="none" opacity="0.8" />;
                  }}
                </For>
              )}
            </For>
            <For each={nodes}>
              {(n) => {
                const sel = () => props.selected() === n.id;
                const color = laneColor(n.lane);
                return (
                  <g transform={`translate(${nx(n)},${ny(n)})`} style={{ cursor: 'pointer' }} onClick={() => props.onSelect(n.id)}>
                    <circle
                      r={sel() ? 9 : 7}
                      fill={n.status === 'planned' ? '#0d1117' : color}
                      stroke={color}
                      stroke-width={sel() ? 3 : 1.6}
                      stroke-dasharray={n.status === 'planned' ? '3 2' : ''}
                    />
                    <text x={0} y={-13} text-anchor="middle" fill={sel() ? '#f0f6fc' : '#adbac7'} font-size="9" font-family="monospace">
                      {n.ref ?? shortTitle(n.title)}
                    </text>
                    <text x={0} y={20} text-anchor="middle" fill="#6e7681" font-size="8" font-family="monospace">
                      {n.ref ? shortTitle(n.title) : ''}
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
