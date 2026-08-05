import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import cytoscape from 'cytoscape';
import type { IrModel } from '../lib/ir';

// A file's top-level module: first two path segments (or the file at the root).
function moduleOf(fileId: string): string {
  const p = fileId.split('/');
  if (p.length <= 1) return fileId;
  if (p.length === 2) return p[0];
  return `${p[0]}/${p[1]}`;
}
const baseName = (id: string) => id.split('/').pop() ?? id;

const styles: unknown[] = [
  {
    selector: 'node',
    style: {
      'background-color': '#2b6cb0',
      label: 'data(label)',
      color: '#e6edf3',
      'font-size': 10,
      'text-wrap': 'wrap',
      'text-max-width': 120,
      'text-valign': 'center',
      'text-halign': 'center',
      shape: 'round-rectangle',
      width: 'data(w)',
      height: 22,
      'border-width': 1,
      'border-color': '#5486c0',
    },
  },
  {
    selector: 'node.mod',
    style: { 'font-size': 12, 'font-weight': 600, height: 30, 'background-opacity': 0.9 },
  },
  {
    selector: 'edge',
    style: {
      width: 1,
      'line-color': '#48566b',
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#48566b',
      'arrow-scale': 0.6,
      opacity: 0.05, // wires hidden at rest — position carries the meaning
    },
  },
  { selector: '.faded', style: { opacity: 0.05, 'text-opacity': 0.08 } },
  { selector: 'node.focus', style: { 'border-color': '#f2cc60', 'border-width': 2.5 } },
  // on hover: what this node depends on (blue, outgoing) vs what depends on it (amber, incoming)
  {
    selector: 'edge.dep-out',
    style: {
      'line-color': '#4aa3ff',
      'target-arrow-color': '#4aa3ff',
      opacity: 0.95,
      width: 1.6,
      'z-index': 20,
    },
  },
  {
    selector: 'edge.dep-in',
    style: {
      'line-color': '#d9a441',
      'target-arrow-color': '#d9a441',
      opacity: 0.9,
      width: 1.4,
      'z-index': 19,
    },
  },
];

export function GraphView(props: { model: IrModel }) {
  let container: HTMLDivElement | undefined;
  let cy: cytoscape.Core | undefined;
  const [drill, setDrill] = createSignal<string | null>(null);

  const files = props.model.nodes.filter((n) => n.kind === 'file').map((n) => n.id);
  const fileCount = (m: string) => files.filter((f) => moduleOf(f) === m).length;

  function elementsForLevel(): cytoscape.ElementDefinition[] {
    const d = drill();
    if (!d) {
      const mods = [...new Set(files.map(moduleOf))].sort();
      const nodes = mods.map((m) => {
        const label = `${baseName(m)}  (${fileCount(m)})`;
        return { data: { id: m, label, w: Math.max(60, label.length * 7.2) }, classes: 'mod' };
      });
      const seen = new Set<string>();
      const edges: cytoscape.ElementDefinition[] = [];
      for (const e of props.model.edges) {
        const a = moduleOf(e.source);
        const b = moduleOf(e.target);
        if (a === b) continue;
        const k = `${a}>${b}`;
        if (seen.has(k)) continue;
        seen.add(k);
        edges.push({ data: { id: `m${edges.length}`, source: a, target: b } });
      }
      return [...nodes, ...edges];
    }
    const fs = files.filter((f) => moduleOf(f) === d);
    const set = new Set(fs);
    const nodes = fs.map((f) => {
      const label = baseName(f);
      return { data: { id: f, label, w: Math.max(52, label.length * 6.6) } };
    });
    const edges: cytoscape.ElementDefinition[] = [];
    for (const e of props.model.edges) {
      if (set.has(e.source) && set.has(e.target)) {
        edges.push({ data: { id: `e${edges.length}`, source: e.source, target: e.target } });
      }
    }
    return [...nodes, ...edges];
  }

  // Position every node by its coupling profile:
  //   x = out-degree  (how much it depends on others)   left = self-contained
  //   y = in-degree   (how depended-upon it is)          bottom = foundational
  function applyLayout() {
    if (!cy) return;
    const ns = cy.nodes();
    let maxIn = 1;
    let maxOut = 1;
    ns.forEach((n) => {
      maxIn = Math.max(maxIn, n.indegree(false));
      maxOut = Math.max(maxOut, n.outdegree(false));
    });
    const W = 1000;
    const H = 620;
    const padX = 120;
    const padY = 70;
    // spread nodes that share the same coupling profile so they don't overlap
    const buckets = new Map<string, cytoscape.NodeSingular[]>();
    ns.forEach((n) => {
      const key = `${n.indegree(false)}|${n.outdegree(false)}`;
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push(n);
    });
    buckets.forEach((arr) => {
      arr.forEach((n, i) => {
        const fi = n.indegree(false);
        const fo = n.outdegree(false);
        const bx = padX + (fo / maxOut) * (W - 2 * padX);
        const by = padY + (fi / maxIn) * (H - 2 * padY);
        const off = arr.length > 1 ? (i - (arr.length - 1) / 2) * 150 : 0;
        n.position({ x: bx + off, y: by });
      });
    });
    cy.fit(undefined, 55);
  }

  function build() {
    cy?.destroy();
    if (!container) return;
    cy = cytoscape({
      container,
      elements: elementsForLevel(),
      // cytoscape's style union type churns across versions; bypass it here.
      style: styles as never,
      wheelSensitivity: 0.2,
    });
    applyLayout();
    cy.on('mouseover', 'node', (ev) => {
      const n = ev.target as cytoscape.NodeSingular;
      cy?.elements().addClass('faded').removeClass('focus dep-out dep-in');
      n.removeClass('faded').addClass('focus');
      const out = n.outgoers('edge');
      const inc = n.incomers('edge');
      out.removeClass('faded').addClass('dep-out');
      out.targets().removeClass('faded');
      inc.removeClass('faded').addClass('dep-in');
      inc.sources().removeClass('faded');
    });
    cy.on('mouseout', 'node', () => cy?.elements().removeClass('faded focus dep-out dep-in'));
    if (!drill()) {
      cy.on('tap', 'node', (ev) => setDrill((ev.target as cytoscape.NodeSingular).id()));
    }
  }

  onMount(() => {
    build();
    // rebuild when drilling in/out (defer: onMount already did the first build)
    createEffect(on(drill, () => build(), { defer: true }));
  });
  onCleanup(() => cy?.destroy());

  return (
    <div class="graph-wrap">
      <div class="graph-toolbar">
        <Show when={drill()}>
          <button onClick={() => setDrill(null)}>← modules</button>
        </Show>
        <button onClick={() => cy?.fit(undefined, 55)}>⤢ fit</button>
        <span class="hint">
          {drill() ? `${baseName(drill() ?? '')} — files` : 'modules · click one to open'} · ↕ how
          depended-upon · ↔ how much it depends · hover a node to trace
        </span>
      </div>
      <div class="graph-plot">
        <div class="axis axis-y-top">entry / leaf ↑</div>
        <div class="axis axis-y-bot">↓ foundational</div>
        <div class="axis axis-x">depends on more →</div>
        <div ref={container} class="cy" />
      </div>
    </div>
  );
}
