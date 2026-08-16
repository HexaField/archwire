import { batch, createEffect, createMemo, createSignal, For, lazy, Match, on, onCleanup, onMount, Show, Suspense, Switch } from 'solid-js';
import type { ChangeModel, CodeNode, ConceptModel, FlowModel, FlowStep, RepoInfo } from '@archwire/core';
import type { DiffFile } from './components/DiffModal';
import { ConceptView } from './components/ConceptView';
import { FlowView } from './components/FlowView';
import { FlowExplorer } from './components/FlowExplorer';
import { GitGraph } from './components/GitGraph';
import { HierarchyExplorer } from './components/HierarchyExplorer';
import { SettingsPanel } from './components/SettingsPanel';
import { ExtractionPanel } from './components/ExtractionPanel';
import { BranchExplorer } from './components/BranchExplorer';
import * as api from './api/client';

const DiffModal = lazy(() => import('./components/DiffModal'));

const STORE_KEY = 'archwire';
function saveSet(key: string, set: Set<string>) {
  try { localStorage.setItem(`${STORE_KEY}:${key}`, JSON.stringify([...set])); } catch { /* quota */ }
}
function loadSet(key: string): Set<string> | null {
  try {
    const v = localStorage.getItem(`${STORE_KEY}:${key}`);
    if (v) return new Set(JSON.parse(v) as string[]);
  } catch { /* corrupt */ }
  return null;
}
function saveStr(key: string, v: string | null) {
  try { localStorage.setItem(`${STORE_KEY}:${key}`, v ?? ''); } catch { /* quota */ }
}
function loadStr(key: string): string | null {
  try { return localStorage.getItem(`${STORE_KEY}:${key}`); } catch { return null; }
}

export function App() {
  // ── repo management ──
  const [repos, setRepos] = createSignal<RepoInfo[]>([]);
  const [activeRepo, setActiveRepo] = createSignal<string | null>(null);
  const [repoLoading, setRepoLoading] = createSignal(false);
  const [showRepoPicker, setShowRepoPicker] = createSignal(false);
  const [repoInput, setRepoInput] = createSignal('');
  const [addingRepo, setAddingRepo] = createSignal(false);

  // ── chat ──
  const [chatInput, setChatInput] = createSignal('');
  const [chatMessages, setChatMessages] = createSignal<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [chatLoading, setChatLoading] = createSignal(false);

  // ── data ──
  const [concepts, setConcepts] = createSignal<ConceptModel | null>(null);
  const [code, setCode] = createSignal<CodeNode[]>([]);
  const [changes, setChanges] = createSignal<ChangeModel | null>(null);
  const [flows, setFlows] = createSignal<FlowModel | null>(null);
  const [err, setErr] = createSignal<string | null>(null);
  const [cSel, setCSel] = createSignal<string | null>(null);
  const [cThr, setCThr] = createSignal<string | null>(null);
  const [changeSel, setChangeSel] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [hoverChange, setHoverChange] = createSignal<string | null>(null);

  // flow view state
  type ViewMode = 'concepts' | 'flows';
  const urlView = new URLSearchParams(window.location.search).get('view');
  const [view, setView] = createSignal<ViewMode>(
    urlView === 'flows' || urlView === 'concepts' ? urlView : 'concepts',
  );
  const [activeFlows, setActiveFlows] = createSignal<Set<string>>(new Set());
  const [activeDiff, setActiveDiff] = createSignal<string | null>(null);
  const [flowStepSel, setFlowStepSel] = createSignal<string | null>(null);
  const [flowExpanded, setFlowExpanded] = createSignal<Set<string>>(new Set());
  const [diffFilter, setDiffFilter] = createSignal('');
  const [diffModal, setDiffModal] = createSignal<{ files: DiffFile[]; codeRefPath: string; branch: string } | null>(null);

  // settings panel
  const [showSettings, setShowSettings] = createSignal(false);

  // ── load repo data from server ──
  async function loadRepoData(repoId: string) {
    setRepoLoading(true);
    setErr(null);
    // clear previous data
    batch(() => {
      setConcepts(null);
      setCode([]);
      setChanges(null);
      setFlows(null);
      setCSel(null);
      setCThr(null);
      setChangeSel(null);
      setFlowStepSel(null);
      setChatMessages([]);
    });

    const [c, codeModel, ch, fl] = await Promise.all([
      api.getConcepts(repoId),
      api.getCode(repoId),
      api.getChanges(repoId),
      api.getFlows(repoId),
    ]);

    batch(() => {
      if (codeModel) setCode(codeModel.nodes);
      if (ch) setChanges(ch);
      if (fl) {
        setFlows(fl);
        const validIds = new Set(fl.flows.map((f) => f.id));
        const savedAF = loadSet(`active-flows:${repoId}`);
        if (savedAF) {
          setActiveFlows(new Set([...savedAF].filter((id) => validIds.has(id))));
        } else {
          setActiveFlows(validIds);
        }
        const savedFE = loadSet(`flow-expanded:${repoId}`);
        setFlowExpanded(savedFE ?? new Set(fl.flows.map((f) => `flow:${f.id}`)));
        const savedDiff = loadStr(`active-diff:${repoId}`);
        if (savedDiff) setActiveDiff(savedDiff || null);
        if (!c && view() === 'concepts') setView('flows');
      }
      const savedCE = loadSet(`concept-expanded:${repoId}`);
      if (savedCE) setExpanded(savedCE);
      if (c) setConcepts(c);
      if (!c && !fl) setErr('No extracted data yet — run extraction from the sidebar.');
      setRepoLoading(false);
    });
  }

  // ── repo actions ──
  async function refreshRepos() {
    const list = await api.listRepos();
    setRepos(list);
    return list;
  }

  async function addRepo() {
    const input = repoInput().trim();
    if (!input) return;
    setAddingRepo(true);
    try {
      const source = input.startsWith('http') || input.includes('github.com')
        ? { url: input }
        : { path: input };
      const repo = await api.addRepo(source);
      setRepoInput('');
      await refreshRepos();
      selectRepo(repo.id);
    } catch (e) {
      setErr(`Failed to add repo: ${(e as Error).message}`);
    } finally {
      setAddingRepo(false);
    }
  }

  async function removeRepo(id: string) {
    await api.removeRepo(id);
    await refreshRepos();
    if (activeRepo() === id) {
      setActiveRepo(null);
      batch(() => {
        setConcepts(null);
        setCode([]);
        setChanges(null);
        setFlows(null);
      });
    }
  }

  function selectRepo(id: string) {
    setActiveRepo(id);
    saveStr('active-repo', id);
    setShowRepoPicker(false);
    loadRepoData(id);
  }

  // ── chat ──
  async function sendChat() {
    const q = chatInput().trim();
    const repo = activeRepo();
    if (!q || !repo) return;
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', text: q }]);
    setChatLoading(true);
    try {
      const res = await api.askRepo(repo, q);
      setChatMessages((prev) => [...prev, { role: 'assistant', text: res.answer }]);
    } catch (e) {
      setChatMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${(e as Error).message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  // ── init ──
  onMount(async () => {
    const list = await refreshRepos();
    const saved = loadStr('active-repo');
    const match = saved ? list.find((r) => r.id === saved) : null;
    if (match) {
      selectRepo(match.id);
    } else if (list.length > 0) {
      selectRepo(list[0].id);
    } else {
      setShowRepoPicker(true);
    }
  });

  // ── concept model helpers (unchanged) ──
  const cm = () => concepts();
  const cbId = () => new Map((cm()?.concepts ?? []).map((c) => [c.id, c]));
  const nameOf = (id: string) => cbId().get(id)?.name ?? id;
  const selConcept = () => (cSel() ? cbId().get(cSel() as string) : undefined);
  const selThread = () => cm()?.threads.find((t) => t.id === cThr());
  const childrenOf = (id: string) => cm()?.concepts.filter((c) => c.parent === id) ?? [];
  const codeById = () => new Map(code().map((n) => [n.id, n]));
  const selCode = () => {
    const id = cSel();
    return id && id.startsWith('code:') ? codeById().get(id) : undefined;
  };
  const conceptOfCode = (id: string): string | undefined => {
    let n = codeById().get(id);
    while (n) {
      if (n.concept) return n.concept;
      n = n.parent ? codeById().get(n.parent) : undefined;
    }
    return undefined;
  };
  const selChangeNode = () => changes()?.nodes.find((n) => n.id === changeSel());

  const overlayOf = (id: string | null) => {
    const ch = id ? changes()?.nodes.find((n) => n.id === id) : undefined;
    return ch ? { concepts: new Set(ch.changedConcepts), paths: ch.changedPaths } : null;
  };
  const overlay = () => overlayOf(hoverChange() ?? changeSel());

  // ── expand / collapse (unchanged) ──
  const idx = createMemo(() => {
    const cids = new Set((cm()?.concepts ?? []).map((c) => c.id));
    const sub = new Map<string, string[]>();
    (cm()?.concepts ?? []).forEach((c) => {
      if (c.parent) {
        const a = sub.get(c.parent) ?? [];
        a.push(c.id);
        sub.set(c.parent, a);
      }
    });
    const cCode = new Map<string, string[]>();
    const kids = new Map<string, string[]>();
    code().forEach((n) => {
      if (n.concept) {
        const a = cCode.get(n.concept) ?? [];
        a.push(n.id);
        cCode.set(n.concept, a);
      }
      if (n.parent) {
        const a = kids.get(n.parent) ?? [];
        a.push(n.id);
        kids.set(n.parent, a);
      }
    });
    return { cids, sub, cCode, kids };
  });
  const childIds = (id: string): string[] => {
    const { cids, sub, cCode, kids } = idx();
    if (cids.has(id)) return [...(sub.get(id) ?? []), ...(cCode.get(id) ?? [])];
    return kids.get(id) ?? [];
  };
  const collapseDesc = (id: string, set: Set<string>) => {
    for (const k of childIds(id)) {
      set.delete(k);
      collapseDesc(k, set);
    }
  };
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        collapseDesc(id, next);
      } else next.add(id);
      return next;
    });
  const collapseAll = () => {
    if (view() === 'flows') setFlowExpanded(new Set<string>());
    else setExpanded(new Set<string>());
  };
  const revealChange = () => {
    const ch = selChangeNode();
    if (!ch) return;
    const cById = codeById();
    const matches = (p: string) =>
      ch.changedPaths.some((cp) => p === cp || p.startsWith(`${cp}/`) || cp.startsWith(`${p}/`));
    setExpanded((prev) => {
      const next = new Set(prev);
      ch.changedConcepts.forEach((c) => next.add(c));
      code().forEach((n) => {
        if (n.kind !== 'file' || !matches(n.path)) return;
        let cur: CodeNode | undefined = n;
        while (cur) {
          if (cur.concept) next.add(cur.concept);
          const par: string | null = cur.parent;
          if (par) next.add(par);
          cur = par ? cById.get(par) : undefined;
        }
      });
      return next;
    });
  };

  // ── undo / redo (unchanged) ──
  type Snap = { cSel: string | null; cThr: string | null; changeSel: string | null; expanded: Set<string> };
  const snapNow = (): Snap => ({ cSel: cSel(), cThr: cThr(), changeSel: changeSel(), expanded: new Set(expanded()) });
  const snapEq = (a: Snap, b: Snap) =>
    a.cSel === b.cSel && a.cThr === b.cThr && a.changeSel === b.changeSel &&
    a.expanded.size === b.expanded.size && [...a.expanded].every((x) => b.expanded.has(x));
  const [histStack, setHistStack] = createSignal<Snap[]>([snapNow()]);
  const [histIdx, setHistIdx] = createSignal(0);
  let applying = false;
  let recordScheduled = false;
  createEffect(
    on([cSel, cThr, changeSel, expanded], () => {
      if (applying) { applying = false; return; }
      if (recordScheduled) return;
      recordScheduled = true;
      queueMicrotask(() => {
        recordScheduled = false;
        const s = snapNow();
        const stack = histStack();
        const i = histIdx();
        if (snapEq(s, stack[i])) return;
        const next = stack.slice(0, i + 1);
        next.push(s);
        batch(() => { setHistStack(next); setHistIdx(next.length - 1); });
      });
    }, { defer: true }),
  );
  const applySnap = (s: Snap) => {
    applying = true;
    batch(() => {
      setCThr(s.cThr);
      setChangeSel(s.changeSel);
      setCSel(s.cSel);
      setExpanded(new Set(s.expanded));
    });
  };
  const canUndo = () => histIdx() > 0;
  const canRedo = () => histIdx() < histStack().length - 1;
  const undo = () => { if (canUndo()) { const i = histIdx() - 1; setHistIdx(i); applySnap(histStack()[i]); } };
  const redo = () => { if (canRedo()) { const i = histIdx() + 1; setHistIdx(i); applySnap(histStack()[i]); } };
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const laneName = (id: string) => changes()?.lanes.find((l) => l.id === id)?.name ?? id;
  const laneColor = (id: string) => changes()?.lanes.find((l) => l.id === id)?.color ?? '#8b949e';

  const flowToggleExpand = (id: string) =>
    setFlowExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── persistence (per-repo keys) ──
  createEffect(on(view, (v) => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', v);
    window.history.replaceState({}, '', `?${params.toString()}`);
  }, { defer: true }));
  createEffect(on(expanded, (s) => { const r = activeRepo(); if (r) saveSet(`concept-expanded:${r}`, s); }, { defer: true }));
  createEffect(on(flowExpanded, (s) => { const r = activeRepo(); if (r) saveSet(`flow-expanded:${r}`, s); }, { defer: true }));
  createEffect(on(activeFlows, (s) => { const r = activeRepo(); if (r) saveSet(`active-flows:${r}`, s); }, { defer: true }));
  createEffect(on(activeDiff, (v) => { const r = activeRepo(); if (r) saveStr(`active-diff:${r}`, v); }, { defer: true }));

  // ── flow helpers (unchanged) ──
  const diffSources = (): [string, number][] => {
    const fm = flows();
    if (!fm) return [];
    const map = new Map<string, number>();
    for (const d of fm.diffs) {
      const count = Object.keys(d.stepStatus).length + d.addedSteps.length;
      map.set(d.diffSource, (map.get(d.diffSource) ?? 0) + count);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const filteredDiffSources = () => {
    const q = diffFilter().toLowerCase();
    return diffSources().filter(([src]) => !q || src.toLowerCase().includes(q));
  };

  // ── diff modal — now fetches from server API ──
  function branchSlug(name: string): string {
    return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }
  const diffDataCache = new Map<string, Record<string, { original: string; modified: string }> | null>();
  async function handleCodeRefClick(codeRefPath: string) {
    const diff = activeDiff();
    const repo = activeRepo();
    if (!diff || !diff.startsWith('branch: ') || !repo) return;
    const branchName = diff.slice(8);
    const slug = branchSlug(branchName);
    if (!diffDataCache.has(slug)) {
      const data = await api.getDiff(repo, slug);
      diffDataCache.set(slug, data?.files ?? null);
    }
    const files = diffDataCache.get(slug);
    if (!files) return;
    const norm = codeRefPath.replace(/^\.\//, '');
    const dot = norm.lastIndexOf('.');
    const stem = dot > 0 ? norm.slice(0, dot) : norm;
    const matched: DiffFile[] = [];
    for (const [fp, content] of Object.entries(files)) {
      if (fp === norm || fp.startsWith(stem + '/')) {
        matched.push({ path: fp, original: content.original, modified: content.modified });
      }
    }
    if (matched.length) setDiffModal({ files: matched, codeRefPath: norm, branch: branchName });
  }

  const toggleFlow = (flowId: string) =>
    setActiveFlows((prev) => {
      const next = new Set(prev);
      if (next.has(flowId)) next.delete(flowId);
      else next.add(flowId);
      return next;
    });
  const selFlowStep = (): { flow: string; step: FlowStep } | undefined => {
    const fid = flowStepSel();
    if (!fid) return undefined;
    const fm = flows();
    if (!fm) return undefined;
    for (const f of fm.flows) {
      const s = f.steps.find((st) => `${f.id}:${st.id}` === fid);
      if (s) return { flow: f.id, step: s };
    }
    return undefined;
  };

  const currentRepoName = () => {
    const id = activeRepo();
    return id ? repos().find((r) => r.id === id)?.name ?? id : 'no repo selected';
  };

  return (
    <div class="app">
      <div id="sidebar">
        <div id="sidebar-header">
          <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between' }}>
            <h1>archwire</h1>
            <button class="settings-gear" onClick={() => setShowSettings(!showSettings())} title="LLM Settings">⚙</button>
          </div>
          <div class="repo-selector">
            <button class="repo-btn" onClick={() => setShowRepoPicker(!showRepoPicker())}>
              <span class="repo-name">{currentRepoName()}</span>
              <span class="repo-caret">{showRepoPicker() ? '▲' : '▼'}</span>
            </button>
            <Show when={showRepoPicker()}>
              <div class="repo-dropdown">
                <div class="repo-add">
                  <input
                    type="text"
                    placeholder="local path or GitHub URL…"
                    value={repoInput()}
                    onInput={(e) => setRepoInput(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addRepo(); }}
                    disabled={addingRepo()}
                  />
                  <button onClick={addRepo} disabled={addingRepo() || !repoInput().trim()}>
                    {addingRepo() ? '…' : '+'}
                  </button>
                </div>
                <For each={repos()}>
                  {(r) => (
                    <div class="repo-item" classList={{ active: activeRepo() === r.id }}>
                      <span class="repo-item-name" onClick={() => selectRepo(r.id)}>
                        {r.name}
                        <span class="repo-item-source">{r.source}</span>
                      </span>
                      <button class="repo-item-remove" onClick={(e) => { e.stopPropagation(); removeRepo(r.id); }} title="remove">×</button>
                    </div>
                  )}
                </For>
                <Show when={repos().length === 0}>
                  <div class="repo-empty">Add a repository to start.</div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
        <div id="controls">
          <button class="ctrl-btn" disabled={!canUndo()} onClick={undo} title="undo (Ctrl+Z)">↶ undo</button>
          <button class="ctrl-btn" disabled={!canRedo()} onClick={redo} title="redo (Ctrl+Shift+Z)">↷ redo</button>
          <button class="ctrl-btn" onClick={collapseAll} title="collapse everything">▤ collapse all</button>
          <Show when={flows() && concepts()}>
            <span class="ctrl-sep" />
            <button class="ctrl-btn" classList={{ active: view() === 'concepts' }} onClick={() => setView('concepts')}>◈ concepts</button>
            <button class="ctrl-btn" classList={{ active: view() === 'flows' }} onClick={() => setView('flows')}>⇢ flows</button>
          </Show>
        </div>

        <div id="details">
          <Show when={repoLoading()}>
            <div class="detail-row">Loading repo data…</div>
          </Show>
          <Show when={!repoLoading() && !activeRepo()}>
            <div class="detail-row">Select or add a repository to begin.</div>
          </Show>
          <Show when={!repoLoading() && activeRepo() && (cm() || flows())} fallback={
            <Show when={!repoLoading() && activeRepo()}>
              <div class="detail-row">{err() ?? 'loading…'}</div>
              <ExtractionPanel
                repoId={activeRepo()!}
                concepts={concepts}
                flows={flows}
                onDataReload={loadRepoData}
              />
            </Show>
          }>
            <Switch
              fallback={
                <Switch fallback={<div class="detail-row">loading…</div>}>
                  <Match when={view() === 'flows' && flows()}>
                    {(fm) => (
                      <>
                        <h2>Flows</h2>
                        <p class="panel-sum">Execution-path diagrams — toggle each flow on/off.</p>
                        <h3>Active flows</h3>
                        <For each={fm().flows}>
                          {(f) => (
                            <label class="flow-toggle">
                              <input
                                type="checkbox"
                                checked={activeFlows().has(f.id)}
                                onChange={() => toggleFlow(f.id)}
                              />
                              <span class="flow-toggle-name">{f.name}</span>
                              <span class="flow-toggle-src">{f.source}</span>
                            </label>
                          )}
                        </For>
                        <Show when={fm().diffs.length}>
                          <h3>Diff overlays</h3>
                          <Show when={diffSources().length > 5}>
                            <input
                              type="text"
                              class="diff-filter"
                              placeholder="filter branches…"
                              value={diffFilter()}
                              onInput={(e) => setDiffFilter(e.currentTarget.value)}
                            />
                          </Show>
                          <div class="diff-list">
                            <div class="flow-toggle">
                              <label>
                                <input type="radio" name="diff" checked={!activeDiff()} onChange={() => setActiveDiff(null)} />
                                <span class="flow-toggle-name">none</span>
                              </label>
                            </div>
                            <For each={filteredDiffSources()}>
                              {([src, count]) => (
                                <div class="flow-toggle">
                                  <label>
                                    <input type="radio" name="diff" checked={activeDiff() === src} onChange={() => setActiveDiff(src)} />
                                    <span class="flow-toggle-name">{src}</span>
                                    <span class="diff-step-count">{count}</span>
                                  </label>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                        <BranchExplorer
                          repoId={activeRepo()!}
                          flows={flows}
                          activeDiff={activeDiff}
                          setActiveDiff={setActiveDiff}
                          onDataReload={loadRepoData}
                        />
                        <h3>How to use</h3>
                        <div class="detail-row"><span class="detail-label">Toggle</span> flows on/off above</div>
                        <div class="detail-row"><span class="detail-label">Click</span> a step → see detail + code refs</div>
                        <div class="detail-row"><span class="detail-label">Double-click</span> → expand sub-steps or frame</div>
                        <div class="detail-row"><span class="detail-label">Diff</span> → red removed, green added, amber modified</div>
                      </>
                    )}
                  </Match>
                  <Match when={cm()}>
                    {(m) => (
                      <>
                        <h2>Overview</h2>
                        <p class="panel-sum">{m().summary}</p>
                        <div class="stat-grid">
                          <div class="stat-card"><div class="stat-number">{m().concepts.length}</div><div class="stat-label">concepts</div></div>
                          <div class="stat-card"><div class="stat-number">{m().concepts.filter((c) => c.pillar).length}</div><div class="stat-label">pillars</div></div>
                          <div class="stat-card"><div class="stat-number">{m().threads.length}</div><div class="stat-label">threads</div></div>
                          <div class="stat-card"><div class="stat-number">{changes()?.nodes.length ?? 0}</div><div class="stat-label">changes</div></div>
                        </div>
                        <Show when={!flows()}>
                          <ExtractionPanel
                            repoId={activeRepo()!}
                            concepts={concepts}
                            flows={flows}
                            onDataReload={loadRepoData}
                          />
                        </Show>
                        <h3>How to use</h3>
                        <div class="detail-row"><span class="detail-label">Click</span> a node → select it + see relations</div>
                        <div class="detail-row"><span class="detail-label">Tree →</span> open / close nodes (↑↓ ←→ ⏎)</div>
                        <div class="detail-row"><span class="detail-label">Thread</span> → follow a flow across concepts</div>
                        <div class="detail-row"><span class="detail-label">Change</span> → overlay a PR's impact on the map</div>
                        <h3>Threads</h3>
                        <For each={m().threads}>
                          {(t) => (
                            <div class="thread-item" onClick={() => { setCSel(null); setChangeSel(null); setCThr(t.id); }}>
                              {t.name}
                            </div>
                          )}
                        </For>
                        <Show when={changes()}>
                          {(ch) => (
                            <>
                              <h3>{ch().initiative} — changes</h3>
                              <p class="panel-sum small">{ch().summary}</p>
                            </>
                          )}
                        </Show>
                      </>
                    )}
                  </Match>
                </Switch>
              }
            >
                <Match when={selFlowStep()}>
                  {(fs) => (
                    <>
                      <span class="back-link" onClick={() => setFlowStepSel(null)}>‹ flows</span>
                      <h2>{fs().step.label}</h2>
                      <div class="meta-line">{fs().step.kind}{fs().step.detail ? ` · ${fs().step.detail}` : ''}</div>
                      <Show when={fs().step.codeRefs.length}>
                        <h3>Code references</h3>
                        <ul class="paths">
                          <For each={fs().step.codeRefs}>
                            {(r) => <li class={activeDiff()?.startsWith('branch: ') ? 'clickable' : ''} onClick={() => handleCodeRefClick(r.path)}><code class="path">{r.path}{r.line ? `:${r.line}` : ''}</code></li>}
                          </For>
                        </ul>
                      </Show>
                      <Show when={fs().step.conceptIds?.length}>
                        <h3>Linked concepts</h3>
                        <ul class="chips">
                          <For each={fs().step.conceptIds ?? []}>
                            {(cid) => <li onClick={() => { setView('concepts'); setFlowStepSel(null); setCSel(cid); }}>{nameOf(cid)}</li>}
                          </For>
                        </ul>
                      </Show>
                    </>
                  )}
                </Match>
                <Match when={selChangeNode()}>
                  {(ch) => (
                    <>
                      <span class="back-link" onClick={() => setChangeSel(null)}>‹ overview</span>
                      <h2>{ch().title}</h2>
                      <div class="meta-line">
                        <span class="tag" style={{ 'border-color': laneColor(ch().lane), color: laneColor(ch().lane) }}>{laneName(ch().lane)}</span>
                        {ch().ref ? <span class="tag">{ch().ref}</span> : null}
                        <span class="tag">{ch().status}</span>
                      </div>
                      <p class="panel-sum">{ch().summary}</p>
                      <button class="ctrl-btn reveal-btn" onClick={revealChange}>⊕ reveal on canvas</button>
                      <Show when={ch().changedConcepts.length}>
                        <h3>Touches concepts</h3>
                        <ul class="chips"><For each={ch().changedConcepts}>{(id) => <li onClick={() => { setChangeSel(null); setCSel(id); }}>{nameOf(id)}</li>}</For></ul>
                      </Show>
                      <Show when={ch().changedPaths.length}>
                        <h3>Touches code</h3>
                        <ul class="paths"><For each={ch().changedPaths}>{(p) => <li><code class="path">{p}</code></li>}</For></ul>
                      </Show>
                    </>
                  )}
                </Match>
                <Match when={selThread()}>
                  {(t) => (
                    <>
                      <span class="back-link" onClick={() => { setCThr(null); setCSel(null); }}>‹ overview</span>
                      <h2>{t().name}</h2>
                      <p class="panel-sum">{t().summary}</p>
                      <h3>Steps</h3>
                      <ol class="thread-steps">
                        <For each={t().steps}>{(s) => <li><b>{nameOf(s.concept)}</b><span class="note">{s.note}</span><code>{s.code}</code></li>}</For>
                      </ol>
                    </>
                  )}
                </Match>
                <Match when={selCode()}>
                  {(n) => (
                    <>
                      <span class="back-link" onClick={() => setCSel(null)}>‹ overview</span>
                      <h2>{n().label}</h2>
                      <div class="meta-line">{n().kind}{conceptOfCode(n().id) ? ` · ${nameOf(conceptOfCode(n().id) as string)}` : ''}</div>
                      <h3>Path</h3>
                      <div class="detail-row"><code class="path">{n().path}</code></div>
                    </>
                  )}
                </Match>
                <Match when={selConcept()}>
                  {(c) => (
                    <>
                      <span class="back-link" onClick={() => setCSel(null)}>‹ overview</span>
                      <h2>{c().name}</h2>
                      <div class="meta-line">layer {c().layer}{c().pillar ? ' · pillar' : ''}</div>
                      <p class="panel-sum">{c().summary}</p>
                      <Show when={childrenOf(c().id).length}>
                        <h3>Breaks down into</h3>
                        <ul class="chips"><For each={childrenOf(c().id)}>{(k) => <li onClick={() => setCSel(k.id)}>{k.name}</li>}</For></ul>
                      </Show>
                      <Show when={c().relations.length}>
                        <h3>Relates to</h3>
                        <For each={c().relations}>{(r) => <div class="conn-item" onClick={() => setCSel(r.to)}><span class="rel-label">{r.label}</span> → {nameOf(r.to)}</div>}</For>
                      </Show>
                      <h3>Implemented by</h3>
                      <ul class="paths"><For each={c().implementedBy}>{(p) => <li><code class="path">{p}</code></li>}</For></ul>
                    </>
                  )}
                </Match>
              </Switch>
          </Show>
        </div>

        {/* chat panel at the bottom of the sidebar */}
        <Show when={activeRepo()}>
          <div id="chat-panel">
            <h3>Ask about this repo</h3>
            <div class="chat-messages">
              <For each={chatMessages()}>
                {(msg) => (
                  <div class={`chat-msg chat-${msg.role}`}>
                    <span class="chat-role">{msg.role === 'user' ? 'you' : 'llm'}</span>
                    <span class="chat-text">{msg.text}</span>
                  </div>
                )}
              </For>
              <Show when={chatLoading()}>
                <div class="chat-msg chat-assistant"><span class="chat-role">llm</span><span class="chat-text thinking">thinking…</span></div>
              </Show>
            </div>
            <div class="chat-input">
              <input
                type="text"
                placeholder="Ask a question…"
                value={chatInput()}
                onInput={(e) => setChatInput(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) sendChat(); }}
                disabled={chatLoading()}
              />
              <button onClick={sendChat} disabled={chatLoading() || !chatInput().trim()}>↵</button>
            </div>
          </div>
        </Show>

        <div id="stats">
          <Show when={cm()}>
            {(m) => <>{m().concepts.length} concepts · {code().length} code nodes · {m().system}</>}
          </Show>
        </div>
      </div>

      <div id="main">
        <div class="canvas-holder">
        <Switch fallback={<div class="empty">{err() ?? (activeRepo() ? 'loading…' : 'select a repository')}</div>}>
          <Match when={view() === 'concepts' && cm()}>
            {(m) => (
              <ConceptView
                model={m()}
                code={code()}
                selected={cSel}
                setSelected={(v) => { setChangeSel(null); setCSel(v); }}
                thread={cThr}
                setThread={setCThr}
                overlay={overlay}
                expanded={expanded}
                collapseAll={collapseAll}
                hovered={hovered}
                setHovered={setHovered}
              />
            )}
          </Match>
          <Match when={view() === 'flows' && flows()}>
            {(fm) => (
              <FlowView
                model={fm()}
                activeFlows={activeFlows}
                activeDiff={activeDiff}
                selected={flowStepSel}
                setSelected={setFlowStepSel}
                expanded={flowExpanded}
                toggleExpand={flowToggleExpand}
                onCodeRefClick={handleCodeRefClick}
              />
            )}
          </Match>
        </Switch>
        </div>
        <Show when={view() === 'concepts' && changes()}>
          {(ch) => (
            <GitGraph
              model={ch()}
              selected={changeSel}
              onSelect={(id) => { setCSel(null); setCThr(null); setChangeSel(id); }}
              onHover={setHoverChange}
              conceptName={nameOf}
            />
          )}
        </Show>
      </div>
      <Show when={view() === 'concepts' && cm()}>
        {(m) => (
          <HierarchyExplorer
            model={m()}
            code={code()}
            expanded={expanded}
            toggleExpand={toggleExpand}
            selected={cSel}
            setSelected={(v) => { setChangeSel(null); setCSel(v); }}
            hovered={hovered}
            setHovered={setHovered}
          />
        )}
      </Show>
      <Show when={view() === 'flows' && flows()}>
        {(fm) => (
          <FlowExplorer
            model={fm()}
            activeFlows={activeFlows}
            expanded={flowExpanded}
            toggleExpand={flowToggleExpand}
            selected={flowStepSel}
            setSelected={setFlowStepSel}
            onCodeRefClick={handleCodeRefClick}
          />
        )}
      </Show>
      <Show when={diffModal()}>
        {(dm) => (
          <Suspense fallback={
            <div class="diff-overlay"><div class="diff-modal"><div class="diff-loading">loading diff viewer…</div></div></div>
          }>
            <DiffModal {...dm()} onClose={() => setDiffModal(null)} />
          </Suspense>
        )}
      </Show>
      <Show when={showSettings()}>
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </Show>
    </div>
  );
}
