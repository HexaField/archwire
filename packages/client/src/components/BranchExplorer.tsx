import { createMemo, createSignal, For, Show } from 'solid-js';
import type { FlowModel, FlowDiffOverlay } from '@archwire/core';
import type { Accessor } from 'solid-js';
import * as api from '../api/client';

interface BranchSummary {
  name: string;
  diffSource: string;
  overlays: FlowDiffOverlay[];
  totalSteps: number;
  added: number;
  removed: number;
  modified: number;
  files: string[];
}

interface BranchExplorerProps {
  repoId: string;
  flows: Accessor<FlowModel | null>;
  activeDiff: Accessor<string | null>;
  setActiveDiff: (v: string | null) => void;
  onDataReload: (repoId: string) => Promise<void>;
}

export function BranchExplorer(props: BranchExplorerProps) {
  const [scanning, setScanning] = createSignal(false);
  const [scanResult, setScanResult] = createSignal<{ branches: number; overlays: number; diffs: number } | null>(null);
  const [scanError, setScanError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [expandedBranch, setExpandedBranch] = createSignal<string | null>(null);

  const branches = createMemo((): BranchSummary[] => {
    const fm = props.flows();
    if (!fm || fm.diffs.length === 0) return [];
    const map = new Map<string, FlowDiffOverlay[]>();
    for (const d of fm.diffs) {
      const arr = map.get(d.diffSource) ?? [];
      arr.push(d);
      map.set(d.diffSource, arr);
    }
    const result: BranchSummary[] = [];
    for (const [src, overlays] of map.entries()) {
      let added = 0, removed = 0, modified = 0;
      const fileSet = new Set<string>();
      for (const ov of overlays) {
        for (const status of Object.values(ov.stepStatus)) {
          if (status === 'added') added++;
          else if (status === 'removed') removed++;
          else if (status === 'modified') modified++;
        }
        added += ov.addedSteps.length;
        for (const step of ov.addedSteps) {
          for (const ref of step.codeRefs) {
            fileSet.add(ref.path);
          }
        }
      }
      result.push({
        name: src.replace(/^branch:\s*/, ''),
        diffSource: src,
        overlays,
        totalSteps: added + removed + modified,
        added,
        removed,
        modified,
        files: [...fileSet].sort(),
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  });

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const res = await api.extractBranches(props.repoId);
      setScanResult(res);
      await props.onDataReload(props.repoId);
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  function toggleBranchExpand(name: string) {
    setExpandedBranch((prev) => prev === name ? null : name);
  }

  return (
    <div class="branch-explorer">
      <div class="branch-header" onClick={() => setExpanded(!expanded())}>
        <span class="branch-caret">{expanded() ? '▾' : '▸'}</span>
        <h3 class="branch-title">Branches</h3>
        <Show when={branches().length > 0}>
          <span class="branch-count">{branches().length}</span>
        </Show>
      </div>

      <Show when={expanded()}>
        <div class="branch-body">
          <button class="ctrl-btn extraction-btn" onClick={handleScan} disabled={scanning()}>
            {scanning() ? 'scanning…' : '⎇ Scan Branches'}
          </button>

          <Show when={scanResult()}>
            {(r) => (
              <div class="branch-scan-result">
                Found {r().branches} branches, {r().overlays} overlays, {r().diffs} diffs
              </div>
            )}
          </Show>

          <Show when={scanError()}>
            <div class="extraction-error">{scanError()}</div>
          </Show>

          <Show when={branches().length > 0}>
            <div class="branch-list">
              <For each={branches()}>
                {(b) => (
                  <div class="branch-item" classList={{ active: props.activeDiff() === b.diffSource }}>
                    <div class="branch-item-header">
                      <span
                        class="branch-item-expand"
                        onClick={() => toggleBranchExpand(b.name)}
                      >
                        {expandedBranch() === b.name ? '▾' : '▸'}
                      </span>
                      <span
                        class="branch-item-name"
                        onClick={() => props.setActiveDiff(props.activeDiff() === b.diffSource ? null : b.diffSource)}
                        title={`Activate diff overlay for ${b.name}`}
                      >
                        {b.name}
                      </span>
                      <span class="branch-diff-stats">
                        <Show when={b.added > 0}><span class="fds-add">+{b.added}</span></Show>
                        <Show when={b.removed > 0}><span class="fds-rem">−{b.removed}</span></Show>
                        <Show when={b.modified > 0}><span class="fds-mod">~{b.modified}</span></Show>
                      </span>
                    </div>
                    <Show when={expandedBranch() === b.name}>
                      <div class="branch-item-detail">
                        <div class="branch-touches">
                          Touches {b.totalSteps} flow step{b.totalSteps !== 1 ? 's' : ''}
                        </div>
                        <Show when={b.files.length > 0}>
                          <div class="branch-files-label">Changed files</div>
                          <ul class="branch-files">
                            <For each={b.files}>
                              {(f) => <li><code class="path">{f}</code></li>}
                            </For>
                          </ul>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
