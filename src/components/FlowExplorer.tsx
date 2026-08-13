import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import type { FlowModel, FlowStep } from '../lib/concepts';

interface TreeItem {
  id: string;
  label: string;
  kind: 'flow' | 'step' | 'coderef';
  stepKind?: FlowStep['kind'];
  /** ID passed to setSelected when clicked (steps + code refs → parent step) */
  selectId?: string;
  /** raw file path for code ref items (diff modal) */
  codeRefPath?: string;
}

const STEP_ICON: Record<string, string> = {
  start: '●',
  end: '◉',
  action: '○',
  decision: '◇',
  parallel: '⫘',
  error: '△',
};

export function FlowExplorer(props: {
  model: FlowModel;
  activeFlows: () => Set<string>;
  expanded: () => Set<string>;
  toggleExpand: (id: string) => void;
  selected: () => string | null;
  setSelected: (v: string | null) => void;
  onCodeRefClick?: (path: string) => void;
}) {
  // ── static indexes ──
  const stepsByFlow = new Map<string, FlowStep[]>();
  const childSteps = new Map<string, FlowStep[]>();
  for (const flow of props.model.flows) {
    stepsByFlow.set(flow.id, flow.steps);
    for (const step of flow.steps) {
      if (step.parentId) {
        const key = `${flow.id}:${step.parentId}`;
        const arr = childSteps.get(key) ?? [];
        arr.push(step);
        childSteps.set(key, arr);
      }
    }
  }

  const childrenOf = (id: string): TreeItem[] => {
    // flow root → top-level steps
    if (id.startsWith('flow:')) {
      const flowId = id.slice(5);
      const steps = stepsByFlow.get(flowId) ?? [];
      return steps
        .filter((s) => !s.parentId)
        .map((s) => ({
          id: `${flowId}:${s.id}`,
          label: s.label,
          kind: 'step' as const,
          stepKind: s.kind,
          selectId: `${flowId}:${s.id}`,
        }));
    }

    // code ref → leaf
    if (id.includes(':ref:')) return [];

    // step → sub-steps + code refs
    const colonIdx = id.indexOf(':');
    if (colonIdx < 0) return [];
    const flowId = id.slice(0, colonIdx);
    const stepId = id.slice(colonIdx + 1);
    const flow = props.model.flows.find((f) => f.id === flowId);
    if (!flow) return [];
    const step = flow.steps.find((s) => s.id === stepId);
    if (!step) return [];

    const kids: TreeItem[] = [];
    for (const s of (childSteps.get(`${flowId}:${stepId}`) ?? [])) {
      kids.push({
        id: `${flowId}:${s.id}`,
        label: s.label,
        kind: 'step',
        stepKind: s.kind,
        selectId: `${flowId}:${s.id}`,
      });
    }
    step.codeRefs.forEach((ref, i) => {
      kids.push({
        id: `${flowId}:${stepId}:ref:${i}`,
        label: `${ref.path}${ref.line ? `:${ref.line}` : ''}`,
        kind: 'coderef',
        selectId: `${flowId}:${stepId}`,
        codeRefPath: ref.path,
      });
    });
    return kids;
  };

  const roots = createMemo((): TreeItem[] =>
    props.model.flows
      .filter((f) => props.activeFlows().has(f.id))
      .map((f) => ({ id: `flow:${f.id}`, label: f.name, kind: 'flow' as const })),
  );

  // ── keyboard nav ──
  const [focusId, setFocusId] = createSignal<string | null>(null);
  let treeEl: HTMLDivElement | undefined;

  const flat = createMemo(() => {
    const out: { id: string; depth: number; hasKids: boolean }[] = [];
    const exp = props.expanded();
    const walk = (items: TreeItem[], depth: number) => {
      for (const it of items) {
        const kids = childrenOf(it.id);
        out.push({ id: it.id, depth, hasKids: kids.length > 0 });
        if (exp.has(it.id) && kids.length) walk(kids, depth + 1);
      }
    };
    walk(roots(), 0);
    return out;
  });

  const seedFocus = () => {
    if (focusId()) return;
    const rows = flat();
    const sel = props.selected();
    setFocusId(sel && rows.some((r) => r.id === sel) ? sel : (rows[0]?.id ?? null));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const rows = flat();
    if (!rows.length) return;
    const fid = focusId() && rows.some((r) => r.id === focusId()) ? (focusId() as string) : rows[0].id;
    const i = rows.findIndex((r) => r.id === fid);
    const cur = rows[i];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusId(rows[Math.min(i + 1, rows.length - 1)].id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusId(rows[Math.max(i - 1, 0)].id);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (cur.hasKids && !props.expanded().has(cur.id)) props.toggleExpand(cur.id);
        else if (cur.hasKids && rows[i + 1] && rows[i + 1].depth > cur.depth) setFocusId(rows[i + 1].id);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (cur.hasKids && props.expanded().has(cur.id)) props.toggleExpand(cur.id);
        else {
          for (let j = i - 1; j >= 0; j--) {
            if (rows[j].depth < cur.depth) { setFocusId(rows[j].id); break; }
          }
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setFocusId(cur.id);
        // select the step (code refs select their parent step)
        const item = flat()[i];
        if (item) {
          // look up the TreeItem to get selectId
          const treeItem = findItem(cur.id);
          if (treeItem?.selectId) props.setSelected(treeItem.selectId);
        }
        break;
    }
  };

  /** Walk tree to find an item by id */
  function findItem(id: string): TreeItem | undefined {
    const walk = (items: TreeItem[]): TreeItem | undefined => {
      for (const it of items) {
        if (it.id === id) return it;
        const found = walk(childrenOf(it.id));
        if (found) return found;
      }
      return undefined;
    };
    return walk(roots());
  }

  createEffect(
    on(focusId, (fid) => {
      if (!fid || !treeEl) return;
      const el = treeEl.querySelector(`[data-id="${CSS.escape(fid)}"]`);
      (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    }),
  );

  function TreeNode(p: { item: TreeItem; depth: number }) {
    const kids = () => childrenOf(p.item.id);
    const open = () => props.expanded().has(p.item.id);
    const sel = () => props.selected() === p.item.id || props.selected() === p.item.selectId;
    const foc = () => focusId() === p.item.id;

    return (
      <>
        <div
          class="tree-row"
          classList={{ sel: sel(), foc: foc() }}
          data-id={p.item.id}
          style={{ 'padding-left': `${6 + p.depth * 13}px` }}
          onClick={() => {
            setFocusId(p.item.id);
            if (p.item.selectId) props.setSelected(p.item.selectId);
            if (p.item.codeRefPath && props.onCodeRefClick) props.onCodeRefClick(p.item.codeRefPath);
          }}
        >
          <span
            class="tree-arrow"
            classList={{ leaf: !kids().length }}
            onClick={(e) => {
              if (!kids().length) return;
              e.stopPropagation();
              props.toggleExpand(p.item.id);
            }}
          >
            {kids().length ? (open() ? '▾' : '▸') : ''}
          </span>
          <Show when={p.item.kind === 'step' && p.item.stepKind}>
            <span class="flow-tree-icon">{STEP_ICON[p.item.stepKind!] ?? '○'}</span>
          </Show>
          <span
            class={`tree-label ${
              p.item.kind === 'flow' ? 'concept pillar' : p.item.kind === 'coderef' ? 'file' : 'concept'
            }`}
          >
            {p.item.label}
          </span>
        </div>
        <Show when={open()}>
          <For each={kids()}>{(ch) => <TreeNode item={ch} depth={p.depth + 1} />}</For>
        </Show>
      </>
    );
  }

  return (
    <div id="explorer">
      <div class="explorer-head">
        <span>flow hierarchy</span>
        <span class="explorer-keys">↑↓ move · ←→ open/close · ⏎ select</span>
      </div>
      <div class="explorer-tree" tabindex="0" ref={treeEl} onKeyDown={onKeyDown} onFocus={seedFocus}>
        <For each={roots()}>{(r) => <TreeNode item={r} depth={0} />}</For>
      </div>
    </div>
  );
}
