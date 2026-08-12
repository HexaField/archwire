import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import cytoscape from 'cytoscape';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { FlowModel, FlowStep } from '../lib/concepts';

const elk = new ELK();
const MONO = "'SF Mono','Cascadia Code',ui-monospace,monospace";

// Grayscale base — colour reserved exclusively for diff overlay (red/green/amber).
// Node types distinguished by shape, border weight, fill brightness, and border style.

const baseStyles: unknown[] = [
  // ── nodes (grayscale) ──
  {
    selector: 'node.fstep',
    style: {
      'background-color': '#161b22',
      'border-color': '#4b5563',
      'border-width': 1.5,
      label: 'data(label)',
      color: '#c9d1d9',
      'font-family': MONO,
      'font-size': 10,
      'text-wrap': 'wrap',
      'text-max-width': 150,
      'text-valign': 'center',
      'text-halign': 'center',
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: 10,
    },
  },
  {
    selector: 'node.fstep.decision',
    style: {
      shape: 'diamond',
      'border-color': '#6b7280',
      'font-size': 9,
      padding: 16,
    },
  },
  {
    selector: 'node.fstep.flow-start',
    style: {
      'background-color': '#1e2530',
      'border-color': '#9ca3af',
      'border-width': 2,
      color: '#e5e7eb',
      'font-weight': '600',
    },
  },
  {
    selector: 'node.fstep.flow-end',
    style: {
      'border-color': '#6b7280',
      color: '#6b7280',
      'border-width': 2.5,
    },
  },
  {
    selector: 'node.fstep.error',
    style: { 'border-color': '#6b7280', 'border-style': 'dashed', color: '#9ca3af' },
  },
  {
    selector: 'node.fstep.parallel-step',
    style: { 'border-color': '#6b7280', color: '#9ca3af' },
  },
  // compound parent (progressive disclosure)
  {
    selector: 'node.fstep:parent',
    style: {
      'background-color': '#0d1117',
      'background-opacity': 0.5,
      'border-color': '#30363d',
      'border-width': 1.5,
      label: 'data(label)',
      color: '#6b7280',
      'font-size': 11,
      'font-weight': '600',
      'text-valign': 'top',
      'text-halign': 'center',
      'text-margin-y': 6,
      padding: 14,
    },
  },
  // flow group wrapper (one per active flow)
  {
    selector: 'node.flow-group',
    style: {
      'background-color': '#0d1117',
      'background-opacity': 0.25,
      'border-color': '#21262d',
      'border-width': 1,
      label: 'data(label)',
      color: '#4b5563',
      'font-family': MONO,
      'font-size': 11,
      'font-weight': '600',
      'text-valign': 'top',
      'text-halign': 'center',
      'text-margin-y': 8,
      padding: 20,
      shape: 'round-rectangle',
    },
  },
  // ── edges (grayscale) ──
  {
    selector: 'edge.fedge',
    style: {
      width: 1.8,
      'line-color': '#4b5563',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#4b5563',
      'curve-style': 'bezier',
      'arrow-scale': 0.8,
      opacity: 0.7,
    },
  },
  {
    selector: 'edge.fedge.conditional',
    style: {
      'line-style': 'dashed',
    },
  },
  {
    selector: 'edge.fedge.error-edge',
    style: { 'line-style': 'dashed' },
  },
  {
    selector: 'edge.fedge.async-edge',
    style: { 'line-style': 'dotted' },
  },
  {
    selector: 'edge.fedge[label]',
    style: {
      label: 'data(label)',
      'font-family': MONO,
      'font-size': 8,
      color: '#6b7280',
      'text-background-color': '#0d1117',
      'text-background-opacity': 0.85,
      'text-background-padding': '2',
      'text-rotation': 'autorotate',
    },
  },
  // ── diff overlay (the ONLY colour) ──
  {
    selector: '.diff-added',
    style: { 'border-color': '#3fb950', 'border-width': 3 },
  },
  {
    selector: 'node.diff-added',
    style: { 'background-color': '#0e4429' },
  },
  {
    selector: '.diff-removed',
    style: { 'border-color': '#f85149', 'border-width': 3, opacity: 0.4 },
  },
  {
    selector: 'node.diff-removed',
    style: { 'border-style': 'dashed' },
  },
  {
    selector: '.diff-modified',
    style: { 'border-color': '#d29922', 'border-width': 3 },
  },
  {
    selector: 'edge.diff-added',
    style: { 'line-color': '#3fb950', 'target-arrow-color': '#3fb950', width: 2.5 },
  },
  {
    selector: 'edge.diff-removed',
    style: { 'line-color': '#f85149', 'target-arrow-color': '#f85149', 'line-style': 'dashed', opacity: 0.35 },
  },
  {
    selector: 'edge.diff-modified',
    style: { 'line-color': '#d29922', 'target-arrow-color': '#d29922' },
  },
  // ── interaction (neutral) ──
  { selector: '.dim', style: { opacity: 0.06, 'text-opacity': 0.06 } },
  { selector: 'node.sel', style: { 'border-color': '#f0f6fc', 'border-width': 2.5 } },
  { selector: 'node.hov', style: { 'overlay-color': '#9ca3af', 'overlay-opacity': 0.2, 'overlay-padding': 3 } },
];

export function FlowView(props: {
  model: FlowModel;
  activeFlows: () => Set<string>;
  activeDiff: () => string | null;
  selected: () => string | null;
  setSelected: (v: string | null) => void;
}) {
  let container: HTMLDivElement | undefined;
  let tip: HTMLDivElement | undefined;
  let cy: cytoscape.Core | undefined;
  let tipOn = false;
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

  const flowById = new Map(props.model.flows.map((f) => [f.id, f]));
  const diffByKey = new Map(
    props.model.diffs.map((d) => [`${d.flowId}::${d.diffSource}`, d]),
  );
  // resolve a step to its flow
  const stepFlowMap = new Map<string, string>();
  for (const f of props.model.flows) {
    for (const s of f.steps) stepFlowMap.set(`${f.id}:${s.id}`, f.id);
  }

  function nodeId(flowId: string, stepId: string) {
    return `${flowId}:${stepId}`;
  }
  function edgeId(flowId: string, from: string, to: string) {
    return `${flowId}:${from}->${to}`;
  }

  function kindClass(kind: string): string {
    switch (kind) {
      case 'decision': return 'decision';
      case 'start': return 'flow-start';
      case 'end': return 'flow-end';
      case 'error': return 'error';
      case 'parallel': return 'parallel-step';
      default: return '';
    }
  }

  function computeElements(): cytoscape.ElementDefinition[] {
    const active = props.activeFlows();
    const exp = expanded();
    const els: cytoscape.ElementDefinition[] = [];

    for (const flowId of active) {
      const flow = flowById.get(flowId);
      if (!flow) continue;

      // flow group wrapper
      els.push({
        data: { id: `grp:${flowId}`, label: flow.name },
        classes: 'flow-group',
      });

      // determine visible steps (root + expanded children)
      const topSteps = flow.steps.filter((s) => !s.parentId);
      const childMap = new Map<string, FlowStep[]>();
      for (const s of flow.steps) {
        if (s.parentId) {
          const arr = childMap.get(s.parentId) ?? [];
          arr.push(s);
          childMap.set(s.parentId, arr);
        }
      }
      const visible = new Set<string>();
      const addVisible = (step: FlowStep) => {
        visible.add(step.id);
        if (exp.has(nodeId(flowId, step.id))) {
          (childMap.get(step.id) ?? []).forEach(addVisible);
        }
      };
      topSteps.forEach(addVisible);

      // nodes
      for (const step of flow.steps) {
        if (!visible.has(step.id)) continue;
        const nid = nodeId(flowId, step.id);
        const parentNid = step.parentId && visible.has(step.parentId)
          ? nodeId(flowId, step.parentId)
          : `grp:${flowId}`;
        const kc = kindClass(step.kind);
        els.push({
          data: {
            id: nid,
            label: step.label,
            parent: parentNid,
            flowId,
            stepId: step.id,
            detail: step.detail ?? '',
          },
          classes: `fstep ${kc}`.trim(),
        });
      }

      // edges — only between visible steps; skip edges to/from hidden children
      for (const t of flow.transitions) {
        if (!visible.has(t.from) || !visible.has(t.to)) continue;
        const eid = edgeId(flowId, t.from, t.to);
        let classes = 'fedge';
        if (t.kind === 'conditional') classes += ' conditional';
        else if (t.kind === 'error') classes += ' error-edge';
        else if (t.kind === 'async') classes += ' async-edge';
        els.push({
          data: {
            id: eid,
            source: nodeId(flowId, t.from),
            target: nodeId(flowId, t.to),
            label: t.label ?? '',
            flowId,
          },
          classes,
        });
      }
    }

    return els;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function elkChildren(id: string): any {
    const kids = cy?.getElementById(id).children().map((n) => n.id()) ?? [];
    if (kids.length) {
      return {
        id,
        children: kids.map((k) => elkChildren(k)),
        layoutOptions: { 'elk.padding': '[top=32,left=14,bottom=14,right=14]' },
      };
    }
    const node = cy?.getElementById(id);
    const w = node ? Math.max(70, node.width()) : 90;
    const h = node ? Math.max(26, node.height()) : 30;
    return { id, width: w, height: h };
  }

  async function layout() {
    if (!cy) return;

    const roots = cy.nodes().orphans().map((n) => n.id());
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.spacing.nodeNode': '32',
        'elk.layered.spacing.nodeNodeBetweenLayers': '60',
        'elk.spacing.edgeNode': '20',
        'elk.spacing.edgeEdge': '12',
        'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
        'elk.layered.spacing.edgeNodeBetweenLayers': '24',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: roots.map((r) => elkChildren(r)),
      edges: cy.edges().map((e) => ({
        id: e.id(),
        sources: [e.source().id()],
        targets: [e.target().id()],
      })),
    };

    const res = await elk.layout(graph);
    if (!cy) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any, ox: number, oy: number) => {
      const ax = ox + (node.x ?? 0);
      const ay = oy + (node.y ?? 0);
      if (node.id !== 'root') {
        const n = cy?.getElementById(node.id);
        if (n && n.nonempty() && n.isChildless()) {
          n.position({ x: ax + node.width / 2, y: ay + node.height / 2 });
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node.children ?? []).forEach((ch: any) => walk(ch, ax, ay));
    };
    walk(res, 0, 0);
  }

  function applyDiff() {
    if (!cy) return;
    const diffId = props.activeDiff();
    if (!diffId) return;

    // find the matching overlay for each active flow
    for (const flowId of props.activeFlows()) {
      const key = `${flowId}::${diffId}`;
      const diff = diffByKey.get(key);
      if (!diff) continue;

      // mark existing steps
      for (const [stepId, status] of Object.entries(diff.stepStatus)) {
        const n = cy.getElementById(nodeId(flowId, stepId));
        if (n.nonempty()) n.addClass(`diff-${status}`);
      }

      // mark existing transitions
      for (const [transKey, status] of Object.entries(diff.transitionStatus)) {
        const [from, to] = transKey.split('->');
        const e = cy.getElementById(edgeId(flowId, from, to));
        if (e.nonempty()) e.addClass(`diff-${status}`);
      }

      // add new steps from the diff
      for (const step of diff.addedSteps) {
        const nid = nodeId(flowId, step.id);
        if (cy.getElementById(nid).nonempty()) continue;
        const kc = kindClass(step.kind);
        cy.add({
          data: {
            id: nid,
            label: step.label,
            parent: step.parentId ? nodeId(flowId, step.parentId) : `grp:${flowId}`,
            flowId,
            stepId: step.id,
            detail: step.detail ?? '',
          },
          classes: `fstep ${kc} diff-added`.trim(),
        });
      }

      // add new transitions from the diff
      for (const t of diff.addedTransitions) {
        const eid = edgeId(flowId, t.from, t.to);
        if (cy.getElementById(eid).nonempty()) continue;
        let classes = 'fedge diff-added';
        if (t.kind === 'conditional') classes += ' conditional';
        else if (t.kind === 'error') classes += ' error-edge';
        cy.add({
          data: {
            id: eid,
            source: nodeId(flowId, t.from),
            target: nodeId(flowId, t.to),
            label: t.label ?? '',
            flowId,
          },
          classes,
        });
      }
    }
  }

  function applySelect() {
    if (!cy) return;
    cy.elements().removeClass('dim sel');
    const id = props.selected();
    if (!id) return;
    const n = cy.getElementById(id);
    if (n.empty()) return;
    cy.elements().addClass('dim');
    n.removeClass('dim').addClass('sel');
    n.ancestors().removeClass('dim');
    n.descendants().removeClass('dim');
    // show connected edges and their targets
    n.connectedEdges().forEach((e) => {
      e.removeClass('dim');
      e.connectedNodes().forEach((cn) => {
        cn.removeClass('dim');
        cn.ancestors().removeClass('dim');
      });
    });
  }

  async function rebuild() {
    if (!cy) return;
    const zoom = cy.zoom();
    const pan = { ...cy.pan() };
    cy.elements().remove();
    cy.add(computeElements());
    await layout();
    if (!cy) return;
    if (props.activeDiff()) applyDiff();
    if (props.selected()) applySelect();
    cy.viewport({ zoom, pan });
  }

  async function fullRebuild() {
    if (!cy) return;
    cy.elements().remove();
    cy.add(computeElements());
    await layout();
    if (!cy) return;
    if (props.activeDiff()) applyDiff();
    cy.fit(undefined, 38);
  }

  // ── tooltip ──
  function showTip(node: cytoscape.NodeSingular, rp: { x: number; y: number }) {
    if (!tip) return;
    const label = node.data('label') as string;
    const detail = node.data('detail') as string;
    if (!label) return;
    (tip.querySelector('.tt') as HTMLElement).textContent = label;
    (tip.querySelector('.td') as HTMLElement).textContent = detail || '';
    tip.style.display = 'block';
    moveTip(rp);
  }
  function moveTip(rp: { x: number; y: number }) {
    if (tip) { tip.style.left = `${rp.x + 14}px`; tip.style.top = `${rp.y + 14}px`; }
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  // ── expand / collapse ──
  const toggleExpand = (flowId: string, stepId: string) => {
    const nid = nodeId(flowId, stepId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nid)) next.delete(nid);
      else next.add(nid);
      return next;
    });
  };

  onMount(() => {
    if (!container) return;
    cy = cytoscape({
      container,
      style: baseStyles as never,
      wheelSensitivity: 0.2,
      layout: { name: 'preset' },
    });
    cy.add(computeElements());
    void layout().then(() => {
      if (!cy) return;
      cy.fit(undefined, 38);
    });

    // interaction
    let lastTapId: string | null = null;
    let lastTapAt = 0;
    cy.on('tap', 'node.fstep', (ev) => {
      const node = ev.target as cytoscape.NodeSingular;
      const id = node.id();
      const now = performance.now();
      const isDbl = now - lastTapAt < 320 && lastTapId === id;
      lastTapId = id;
      lastTapAt = now;

      if (isDbl) {
        // double-click: expand/collapse if compound, or frame it
        const flowId = node.data('flowId') as string;
        const stepId = node.data('stepId') as string;
        const flow = flowById.get(flowId);
        const hasChildren = flow?.steps.some((s) => s.parentId === stepId);
        if (hasChildren) {
          toggleExpand(flowId, stepId);
        } else {
          cy?.animate({ fit: { eles: node.closedNeighborhood(), padding: 55 }, duration: 240 });
        }
        return;
      }
      props.setSelected(id);
    });
    cy.on('tap', (ev) => {
      if (ev.target === cy) {
        if (performance.now() - lastTapAt < 320) return;
        props.setSelected(null);
      }
    });
    cy.on('mouseover', 'node.fstep', (ev) => {
      tipOn = true;
      showTip(ev.target as cytoscape.NodeSingular, ev.renderedPosition);
      (ev.target as cytoscape.NodeSingular).addClass('hov');
    });
    cy.on('mousemove', (ev) => { if (tipOn) moveTip(ev.renderedPosition); });
    cy.on('mouseout', 'node.fstep', (ev) => {
      tipOn = false;
      hideTip();
      (ev.target as cytoscape.NodeSingular).removeClass('hov');
    });

    // reactivity
    createEffect(on(props.activeFlows, () => void fullRebuild(), { defer: true }));
    createEffect(on(expanded, () => void rebuild(), { defer: true }));
    createEffect(on(props.activeDiff, () => void rebuild(), { defer: true }));
    createEffect(on(props.selected, () => applySelect(), { defer: true }));
  });

  onCleanup(() => cy?.destroy());

  // count diff stats
  const diffStats = () => {
    const diffId = props.activeDiff();
    if (!diffId) return null;
    let added = 0, removed = 0, modified = 0;
    for (const flowId of props.activeFlows()) {
      const d = diffByKey.get(`${flowId}::${diffId}`);
      if (!d) continue;
      for (const v of Object.values(d.stepStatus)) {
        if (v === 'added') added++;
        else if (v === 'removed') removed++;
        else modified++;
      }
      added += d.addedSteps.length;
    }
    return { added, removed, modified };
  };

  return (
    <div class="concept-map">
      <div class="canvas-toolbar">
        <button onClick={() => cy?.fit(undefined, 38)} title="fit to view">⤢ fit</button>
        <span class="hint">click to select · double-click to expand/frame</span>
        <Show when={diffStats()}>
          {(s) => (
            <span class="flow-diff-stats">
              <span class="fds-add">+{s().added}</span>
              <span class="fds-rem">−{s().removed}</span>
              <span class="fds-mod">~{s().modified}</span>
            </span>
          )}
        </Show>
      </div>
      <div ref={container} class="cy" />
      <div id="tip" ref={tip}>
        <div class="tt" />
        <div class="td" />
      </div>
      <div id="legend">
        <b>Flow diagram</b>
        <div class="lrow"><div class="lsw" style={{ background: '#1e2530', border: '2px solid #9ca3af' }} /> start</div>
        <div class="lrow"><div class="lsw" style={{ background: '#161b22', border: '1.5px solid #4b5563' }} /> action</div>
        <div class="lrow"><div class="lsw" style={{ background: '#161b22', border: '1.5px solid #6b7280', 'border-radius': '0' }} /> decision</div>
        <div class="lrow"><div class="lsw" style={{ background: '#161b22', border: '1.5px dashed #6b7280' }} /> error</div>
        <Show when={props.activeDiff()}>
          <div style={{ 'border-top': '1px solid #30363d', 'margin-top': '6px', 'padding-top': '6px' }}>
            <div class="lrow"><div class="lsw" style={{ border: '2px solid #3fb950' }} /> added</div>
            <div class="lrow"><div class="lsw" style={{ border: '2px dashed #f85149', opacity: 0.5 }} /> removed</div>
            <div class="lrow"><div class="lsw" style={{ border: '2px solid #d29922' }} /> modified</div>
          </div>
        </Show>
      </div>
    </div>
  );
}
