import { createEffect, on, onCleanup, onMount } from 'solid-js';
import cytoscape from 'cytoscape';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { CodeNode, Concept, ConceptModel } from '../lib/concepts';

const elk = new ELK();
const MONO = "'SF Mono','Cascadia Code',ui-monospace,monospace";

const styles: unknown[] = [
  {
    selector: 'node.concept',
    style: {
      'background-color': '#21262d',
      'border-color': '#3d4b5f',
      'border-width': 1,
      label: 'data(name)',
      color: '#adbac7',
      'font-family': MONO,
      'font-size': 10,
      'text-wrap': 'wrap',
      'text-max-width': 130,
      'text-valign': 'center',
      'text-halign': 'center',
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: 9,
    },
  },
  {
    selector: 'node.concept.pillar',
    style: { 'background-color': '#1f6feb', 'border-color': '#58a6ff', color: '#f0f6fc', 'font-size': 12, 'font-weight': 600 },
  },
  {
    selector: 'node.concept:parent',
    style: {
      'background-color': '#1f6feb',
      'background-opacity': 0.05,
      'border-color': '#3d4b5f',
      'border-width': 1.5,
      label: 'data(name)',
      color: '#8b949e',
      'font-size': 11,
      'font-weight': 600,
      'text-valign': 'top',
      'text-halign': 'center',
      'text-margin-y': 6,
      padding: 14,
    },
  },
  { selector: 'node.concept.pillar:parent', style: { 'border-color': '#58a6ff', color: '#c9d6e5' } },
  {
    selector: 'node.codedir',
    style: {
      'background-color': '#0d1117',
      'background-opacity': 0.6,
      'border-color': '#2f3742',
      'border-width': 1,
      label: 'data(name)',
      color: '#7d8fa3',
      'font-family': MONO,
      'font-size': 9,
      'text-valign': 'top',
      'text-halign': 'center',
      'text-margin-y': 3,
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: 8,
    },
  },
  {
    selector: 'node.codefile',
    style: {
      'background-color': '#12161c',
      'border-color': '#2f3742',
      'border-width': 1,
      label: 'data(name)',
      color: '#6e7681',
      'font-family': MONO,
      'font-size': 8,
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: 5,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.4,
      'line-color': '#3d4b5f',
      'curve-style': 'taxi',
      'taxi-direction': 'auto',
      'taxi-turn': '50%',
      'taxi-turn-min-distance': 12,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#3d4b5f',
      'arrow-scale': 0.8,
      opacity: 0.5,
    },
  },
  { selector: '.dim', style: { opacity: 0.05, 'text-opacity': 0.06 } },
  { selector: 'node.hov', style: { opacity: 1, 'text-opacity': 1, 'overlay-color': '#58a6ff', 'overlay-opacity': 0.28, 'overlay-padding': 3 } },
  { selector: 'node.sel', style: { 'border-color': '#e3b341', 'border-width': 3 } },
  {
    selector: 'edge.sel-rel',
    style: {
      'line-color': '#e3b341',
      'target-arrow-color': '#e3b341',
      opacity: 0.95,
      width: 1.8,
      label: 'data(label)',
      'font-family': MONO,
      'font-size': 9,
      color: '#e3b341',
      'text-background-color': '#0d1117',
      'text-background-opacity': 0.85,
      'text-background-padding': 2,
      'z-index': 20,
    },
  },
  { selector: 'node.thread-step', style: { 'background-color': '#238636', 'border-color': '#3fb950', 'border-width': 2.5, color: '#f0f6fc', 'z-index': 21 } },
  { selector: 'edge.thread', style: { 'line-color': '#3fb950', 'target-arrow-color': '#3fb950', width: 2.6, opacity: 0.95, 'z-index': 22 } },
  { selector: 'node.changed', style: { 'border-color': '#d29922', 'border-width': 3, 'z-index': 15 } },
  { selector: 'node.codefile.changed', style: { 'background-color': '#3a2d10', color: '#e3b341', 'border-color': '#d29922' } },
];

export function ConceptView(props: {
  model: ConceptModel;
  code: CodeNode[];
  selected: () => string | null;
  setSelected: (v: string | null) => void;
  thread: () => string | null;
  setThread: (v: string | null) => void;
  overlay: () => { concepts: Set<string>; paths: string[] } | null;
  expanded: () => Set<string>;
  toggleExpand: (id: string) => void;
  collapseAll: () => void;
  hovered: () => string | null;
  setHovered: (v: string | null) => void;
}) {
  let container: HTMLDivElement | undefined;
  let tip: HTMLDivElement | undefined;
  let cy: cytoscape.Core | undefined;
  let tipOn = false;

  const byId = new Map(props.model.concepts.map((c) => [c.id, c]));
  const threadById = new Map(props.model.threads.map((t) => [t.id, t]));
  const subConcepts = new Map<string, Concept[]>();
  for (const c of props.model.concepts) {
    if (c.parent) {
      const a = subConcepts.get(c.parent) ?? [];
      a.push(c);
      subConcepts.set(c.parent, a);
    }
  }
  const codeById = new Map(props.code.map((n) => [n.id, n]));
  const codeKids = new Map<string, CodeNode[]>();
  const conceptCode = new Map<string, CodeNode[]>();
  for (const n of props.code) {
    if (n.concept) {
      const a = conceptCode.get(n.concept) ?? [];
      a.push(n);
      conceptCode.set(n.concept, a);
    }
    if (n.parent) {
      const a = codeKids.get(n.parent) ?? [];
      a.push(n);
      codeKids.set(n.parent, a);
    }
  }
  const hasChildren = (id: string) => {
    if (byId.has(id)) return (subConcepts.get(id)?.length ?? 0) + (conceptCode.get(id)?.length ?? 0) > 0;
    return (codeKids.get(id)?.length ?? 0) > 0;
  };

  // relations aggregated to top-level groups → a few clean wires
  const topOf = (id: string) => {
    let c = byId.get(id);
    while (c && c.parent) c = byId.get(c.parent);
    return c?.id ?? id;
  };
  const aggEdges: { id: string; source: string; target: string }[] = [];
  {
    const seen = new Set<string>();
    for (const c of props.model.concepts) {
      for (const r of c.relations) {
        if (!byId.has(r.to)) continue;
        const a = topOf(c.id);
        const b = topOf(r.to);
        if (a === b) continue;
        const k = `${a}>${b}`;
        if (seen.has(k)) continue;
        seen.add(k);
        aggEdges.push({ id: `agg__${a}__${b}`, source: a, target: b });
      }
    }
  }

  function computeElements(): cytoscape.ElementDefinition[] {
    const exp = props.expanded();
    const visible = new Set<string>();
    const revealCode = (n: CodeNode) => {
      visible.add(n.id);
      if (exp.has(n.id)) (codeKids.get(n.id) ?? []).forEach(revealCode);
    };
    const revealConcept = (c: Concept) => {
      visible.add(c.id);
      if (exp.has(c.id)) {
        (subConcepts.get(c.id) ?? []).forEach(revealConcept);
        (conceptCode.get(c.id) ?? []).forEach(revealCode);
      }
    };
    props.model.concepts.filter((c) => !c.parent).forEach(revealConcept);

    const els: cytoscape.ElementDefinition[] = [];
    for (const c of props.model.concepts) {
      if (visible.has(c.id)) els.push({ data: { id: c.id, name: c.name, parent: c.parent ?? undefined }, classes: `concept${c.pillar ? ' pillar' : ''}` });
    }
    for (const n of props.code) {
      if (visible.has(n.id)) els.push({ data: { id: n.id, name: n.label, parent: n.concept ?? n.parent ?? undefined, path: n.path }, classes: `code ${n.kind === 'dir' ? 'codedir' : 'codefile'}` });
    }
    for (const e of aggEdges) els.push({ data: { id: e.id, source: e.source, target: e.target } });
    return els;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function elkTree(id: string, sizes: Map<string, { w: number; h: number }>): any {
    const kidIds = cy?.getElementById(id).children().map((n) => n.id()) ?? [];
    if (kidIds.length) {
      return { id, children: kidIds.map((k) => elkTree(k, sizes)), layoutOptions: { 'elk.padding': '[top=30,left=12,bottom=12,right=12]' } };
    }
    const s = sizes.get(id) ?? { w: 90, h: 26 };
    return { id, width: s.w, height: s.h };
  }

  async function layout() {
    if (!cy) return;
    const sizes = new Map<string, { w: number; h: number }>();
    cy.nodes().forEach((n) => {
      if (n.isChildless()) sizes.set(n.id(), { w: Math.max(64, n.width()), h: Math.max(22, n.height()) });
    });
    const roots = cy.nodes().orphans().map((n) => n.id());
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.spacing.nodeNode': '32',
        'elk.layered.spacing.nodeNodeBetweenLayers': '64',
        'elk.spacing.edgeNode': '26',
      },
      children: roots.map((r) => elkTree(r, sizes)),
      edges: aggEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };
    const res = await elk.layout(graph);
    if (!cy) return;
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any, ox: number, oy: number) => {
      const ax = ox + (node.x ?? 0);
      const ay = oy + (node.y ?? 0);
      if (node.id !== 'root') pos.set(node.id, { x: ax, y: ay, w: node.width, h: node.height });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node.children ?? []).forEach((ch: any) => walk(ch, ax, ay));
    };
    walk(res, 0, 0);
    pos.forEach((p, id) => {
      const n = cy?.getElementById(id);
      if (n && n.nonempty() && n.isChildless()) n.position({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
    });
  }

  async function rebuild() {
    if (!cy) return;
    // keep the user's camera put; only counter-pan so the interacted (selected)
    // node holds the same screen point while its subtree grows or shrinks.
    const anchorId = props.selected();
    const before = anchorId ? cy.getElementById(anchorId) : undefined;
    const rpBefore = before && before.nonempty() ? { ...before.renderedPosition() } : null;
    const zoom = cy.zoom();
    const pan = { ...cy.pan() };
    cy.elements().remove();
    cy.add(computeElements());
    await layout();
    if (!cy) return;
    cy.viewport({ zoom, pan });
    const after = anchorId ? cy.getElementById(anchorId) : undefined;
    if (rpBefore && after && after.nonempty()) {
      const rpAfter = after.renderedPosition();
      cy.panBy({ x: rpBefore.x - rpAfter.x, y: rpBefore.y - rpAfter.y });
    }
    reapply();
  }

  function clearMarks() {
    cy?.edges('.__sel, .__te').remove();
    cy?.elements().removeClass('dim sel sel-rel thread-step thread changed');
  }
  function applySelect() {
    if (!cy) return;
    clearMarks();
    const id = props.selected();
    if (!id) return;
    const n = cy.getElementById(id);
    if (n.empty()) return;
    cy.elements().addClass('dim');
    n.removeClass('dim').addClass('sel');
    n.ancestors().removeClass('dim');
    n.descendants().removeClass('dim');
    if (!byId.has(id)) return; // code node: spotlight only
    let idx = 0;
    const link = (a: string, b: string, label: string) => {
      // both endpoints must be on the canvas — a relation whose other end sits
      // inside a still-collapsed group has no node to attach to. Adding an edge
      // with a missing source/target throws and aborts the render.
      const an = cy?.getElementById(a);
      const bn = cy?.getElementById(b);
      if (!an || an.empty() || !bn || bn.empty()) return;
      an.removeClass('dim');
      an.ancestors().removeClass('dim');
      bn.removeClass('dim');
      bn.ancestors().removeClass('dim');
      cy?.add({ group: 'edges', data: { id: `__sel${idx++}`, source: a, target: b, label }, classes: '__sel sel-rel' } as cytoscape.ElementDefinition);
    };
    byId.get(id)?.relations.filter((r) => byId.has(r.to)).forEach((r) => link(id, r.to, r.label));
    props.model.concepts.forEach((o) => o.relations.forEach((r) => { if (r.to === id) link(o.id, id, r.label); }));
  }
  function applyThread() {
    if (!cy) return;
    clearMarks();
    const t = props.thread() ? threadById.get(props.thread() as string) : undefined;
    if (!t) return;
    cy.elements().addClass('dim');
    let steps = cy.collection();
    t.steps.forEach((s) => {
      const nd = cy?.getElementById(s.concept);
      if (nd && nd.nonempty()) {
        nd.removeClass('dim').addClass('thread-step');
        steps = steps.union(nd);
      }
    });
    steps.ancestors().removeClass('dim');
    for (let i = 0; i < t.steps.length - 1; i++) {
      const a = t.steps[i].concept;
      const b = t.steps[i + 1].concept;
      if (a === b) continue;
      if (cy.getElementById(a).nonempty() && cy.getElementById(b).nonempty()) {
        cy.add({ group: 'edges', data: { id: `__te${i}`, source: a, target: b }, classes: '__te thread' } as cytoscape.ElementDefinition);
      }
    }
    cy.fit(steps.union(steps.ancestors()).union(cy.elements('.__te')), 80);
  }
  function applyOverlay() {
    if (!cy) return;
    const o = props.overlay();
    clearMarks();
    if (!o) return;
    o.concepts.forEach((cid) => cy?.getElementById(cid).addClass('changed'));
    cy.nodes('.code').forEach((n) => {
      const p = n.data('path') as string;
      if (o.paths.some((cp) => p === cp || p.startsWith(`${cp}/`) || cp.startsWith(`${p}/`))) n.addClass('changed');
    });
    // the camera stays put — the sidebar 'reveal on canvas' button opens the
    // touched code, and double-click / fit frame it on demand.
  }
  function reapply() {
    if (props.overlay()) applyOverlay();
    else if (props.thread()) applyThread();
    else if (props.selected()) applySelect();
    else clearMarks();
  }

  function showTip(node: cytoscape.NodeSingular, rp: { x: number; y: number }) {
    if (!tip) return;
    const cc = byId.get(node.id());
    const cn = codeById.get(node.id());
    const title = cc ? cc.name : cn ? cn.label : '';
    const body = cc ? cc.summary : cn ? cn.path : '';
    if (!title) return;
    (tip.querySelector('.tt') as HTMLElement).textContent = title;
    (tip.querySelector('.td') as HTMLElement).textContent = body;
    tip.style.display = 'block';
    moveTip(rp);
  }
  function moveTip(rp: { x: number; y: number }) {
    if (tip) {
      tip.style.left = `${rp.x + 14}px`;
      tip.style.top = `${rp.y + 14}px`;
    }
  }
  function hideTip() {
    if (tip) tip.style.display = 'none';
  }

  onMount(() => {
    if (!container) return;
    cy = cytoscape({ container, style: styles as never, wheelSensitivity: 0.2, layout: { name: 'preset' } });
    cy.add(computeElements());
    void layout().then(() => cy?.fit(undefined, 38));

    // single tap = select + open/close, snappy and with the camera left alone;
    // double tap = frame it (the dedicated camera action).
    const focusNode = (n: cytoscape.NodeCollection) =>
      cy?.animate({ fit: { eles: n.closedNeighborhood().union(n.descendants()), padding: 55 }, duration: 240 });
    let lastTapId: string | null = null;
    let lastTapAt = 0;
    cy.on('tap', 'node', (ev) => {
      const node = ev.target as cytoscape.NodeSingular;
      const id = node.id();
      const now = performance.now();
      // a second tap inside the window = double-click → frame the FIRST tapped
      // node; the first tap's expand may have shifted what sits under the cursor.
      const dblOf = now - lastTapAt < 320 ? lastTapId : null;
      lastTapId = id;
      lastTapAt = now;
      if (dblOf) {
        const target = cy?.getElementById(dblOf);
        if (target && target.nonempty()) {
          props.setSelected(dblOf);
          focusNode(target);
        }
        return;
      }
      if (byId.has(id)) {
        props.setThread(null);
        props.setSelected(id);
        if (hasChildren(id)) props.toggleExpand(id);
      } else if (node.hasClass('codedir')) {
        props.setSelected(id);
        props.toggleExpand(id);
      } else {
        props.setSelected(props.selected() === id ? null : id);
      }
    });
    cy.on('tap', (ev) => {
      if (ev.target === cy) {
        if (performance.now() - lastTapAt < 320) return; // tail of a double-click
        props.setSelected(null);
        props.setThread(null);
      }
    });
    cy.on('mouseover', 'node', (ev) => {
      tipOn = true;
      props.setHovered((ev.target as cytoscape.NodeSingular).id());
      showTip(ev.target as cytoscape.NodeSingular, ev.renderedPosition);
    });
    cy.on('mousemove', (ev) => {
      if (tipOn) moveTip(ev.renderedPosition);
    });
    cy.on('mouseout', 'node', () => {
      tipOn = false;
      props.setHovered(null);
      hideTip();
    });

    createEffect(on(props.expanded, () => void rebuild(), { defer: true }));
    // one reconciler; precedence overlay > thread > selection. Routing all three
    // through it means a hover-preview reverts to the committed marks on mouseout.
    createEffect(on(props.selected, () => reapply(), { defer: true }));
    createEffect(on(props.thread, () => reapply(), { defer: true }));
    createEffect(on(props.overlay, () => reapply(), { defer: true }));
    // mirror the hovered node from the tree (and self) onto the canvas
    createEffect(
      on(props.hovered, (h) => {
        if (!cy) return;
        cy.nodes('.hov').removeClass('hov');
        if (h) {
          const n = cy.getElementById(h);
          if (n.nonempty()) n.addClass('hov');
        }
      }),
    );
  });
  onCleanup(() => cy?.destroy());

  return (
    <div class="concept-map">
      <div class="canvas-toolbar">
        <button onClick={() => cy?.fit(undefined, 38)} title="fit to view">⤢ fit</button>
        <button onClick={() => props.collapseAll()} title="collapse everything">▤ collapse</button>
        <span class="hint">click to open · again to close · double-click to focus</span>
      </div>
      <div ref={container} class="cy" />
      <div id="tip" ref={tip}>
        <div class="tt" />
        <div class="td" />
      </div>
      <div id="legend">
        <b>Concept ⇢ code</b>
        <div class="lrow"><div class="lsw" style={{ background: '#1f6feb' }} /> pillar concept</div>
        <div class="lrow"><div class="lsw" style={{ background: '#21262d', border: '1px solid #3d4b5f' }} /> concept</div>
        <div class="lrow"><div class="lsw" style={{ background: '#0d1117', border: '1px solid #2f3742' }} /> code (dir / file)</div>
        <div class="lrow"><div class="lsw" style={{ background: 'transparent', border: '1px solid #d29922' }} /> changed by PR</div>
        <div class="lrow"><div class="lsw" style={{ background: '#238636' }} /> thread step</div>
      </div>
    </div>
  );
}
