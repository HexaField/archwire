import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import type { CodeNode, ConceptModel } from '@archwire/core';

interface Item {
  id: string;
  label: string;
  kind: 'concept' | 'dir' | 'file';
  pillar?: boolean;
}

// A tree that mirrors the graph 1-1: same `expanded` state drives both, so
// opening a node here opens it on the canvas and vice-versa. A tree-local focus
// cursor drives keyboard nav (↑↓ move · ←→ open/close · ⏎ select) without
// touching selection until the user commits — so arrowing never spams the canvas.
export function HierarchyExplorer(props: {
  model: ConceptModel;
  code: CodeNode[];
  expanded: () => Set<string>;
  toggleExpand: (id: string) => void;
  selected: () => string | null;
  setSelected: (v: string | null) => void;
  hovered: () => string | null;
  setHovered: (v: string | null) => void;
}) {
  const conceptIds = new Set(props.model.concepts.map((c) => c.id));
  const subConcepts = new Map<string, Item[]>();
  for (const c of props.model.concepts) {
    if (c.parent) {
      const a = subConcepts.get(c.parent) ?? [];
      a.push({ id: c.id, label: c.name, kind: 'concept', pillar: c.pillar });
      subConcepts.set(c.parent, a);
    }
  }
  const conceptCode = new Map<string, Item[]>();
  const codeKids = new Map<string, Item[]>();
  for (const n of props.code) {
    const item: Item = { id: n.id, label: n.label, kind: n.kind === 'dir' ? 'dir' : 'file' };
    if (n.concept) {
      const a = conceptCode.get(n.concept) ?? [];
      a.push(item);
      conceptCode.set(n.concept, a);
    }
    if (n.parent) {
      const a = codeKids.get(n.parent) ?? [];
      a.push(item);
      codeKids.set(n.parent, a);
    }
  }

  const childrenOf = (id: string): Item[] => {
    if (conceptIds.has(id)) return [...(subConcepts.get(id) ?? []), ...(conceptCode.get(id) ?? [])];
    return codeKids.get(id) ?? [];
  };

  const roots: Item[] = props.model.concepts
    .filter((c) => !c.parent)
    .map((c) => ({ id: c.id, label: c.name, kind: 'concept', pillar: c.pillar }));

  const [focusId, setFocusId] = createSignal<string | null>(null);
  let treeEl: HTMLDivElement | undefined;

  // the flat list of currently-visible rows, in display order — the axis ↑↓ move
  const flat = createMemo(() => {
    const out: { id: string; depth: number; hasKids: boolean }[] = [];
    const exp = props.expanded();
    const walk = (items: Item[], depth: number) => {
      for (const it of items) {
        const kids = childrenOf(it.id);
        out.push({ id: it.id, depth, hasKids: kids.length > 0 });
        if (exp.has(it.id) && kids.length) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
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
        else setFocusId(cur.id);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (cur.hasKids && props.expanded().has(cur.id)) props.toggleExpand(cur.id);
        else {
          for (let j = i - 1; j >= 0; j--) {
            if (rows[j].depth < cur.depth) {
              setFocusId(rows[j].id);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setFocusId(cur.id);
        props.setSelected(cur.id);
        break;
      default:
        return;
    }
    if (!focusId()) setFocusId(cur.id);
  };

  // keep the focused row in view while arrowing through a long tree
  createEffect(
    on(focusId, (fid) => {
      if (!fid || !treeEl) return;
      const el = treeEl.querySelector(`[data-id="${fid}"]`);
      (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    }),
  );

  function TreeNode(p: { item: Item; depth: number }) {
    const kids = () => childrenOf(p.item.id);
    const open = () => props.expanded().has(p.item.id);
    const sel = () => props.selected() === p.item.id;
    const hov = () => props.hovered() === p.item.id;
    const foc = () => focusId() === p.item.id;
    return (
      <>
        <div
          class="tree-row"
          classList={{ sel: sel(), hov: hov(), foc: foc() }}
          data-id={p.item.id}
          style={{ 'padding-left': `${6 + p.depth * 13}px` }}
          onClick={() => {
            setFocusId(p.item.id);
            props.setSelected(p.item.id);
          }}
          onMouseEnter={() => props.setHovered(p.item.id)}
          onMouseLeave={() => props.setHovered(null)}
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
          <span class={`tree-label ${p.item.kind}${p.item.pillar ? ' pillar' : ''}`}>{p.item.label}</span>
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
        <span>hierarchy</span>
        <span class="explorer-keys">↑↓ move · ←→ open/close · ⏎ select</span>
      </div>
      <div class="explorer-tree" tabindex="0" ref={treeEl} onKeyDown={onKeyDown} onFocus={seedFocus}>
        <For each={roots}>{(r) => <TreeNode item={r} depth={0} />}</For>
      </div>
    </div>
  );
}
