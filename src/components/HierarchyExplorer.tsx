import { For, Show } from 'solid-js';
import type { CodeNode, ConceptModel } from '../lib/concepts';

interface Item {
  id: string;
  label: string;
  kind: 'concept' | 'dir' | 'file';
  pillar?: boolean;
}

// A tree that mirrors the graph 1-1: same `expanded` state drives both, so
// opening a node here opens it on the canvas and vice-versa.
export function HierarchyExplorer(props: {
  model: ConceptModel;
  code: CodeNode[];
  expanded: () => Set<string>;
  toggleExpand: (id: string) => void;
  selected: () => string | null;
  setSelected: (v: string | null) => void;
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

  function TreeNode(p: { item: Item; depth: number }) {
    const kids = () => childrenOf(p.item.id);
    const open = () => props.expanded().has(p.item.id);
    const sel = () => props.selected() === p.item.id;
    return (
      <>
        <div
          class="tree-row"
          classList={{ sel: sel() }}
          style={{ 'padding-left': `${6 + p.depth * 13}px` }}
          onClick={() => {
            props.setSelected(p.item.id);
            if (kids().length) props.toggleExpand(p.item.id);
          }}
        >
          <span class="tree-arrow">{kids().length ? (open() ? '▾' : '▸') : '·'}</span>
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
      <div class="explorer-head">hierarchy</div>
      <div class="explorer-tree">
        <For each={roots}>{(r) => <TreeNode item={r} depth={0} />}</For>
      </div>
    </div>
  );
}
