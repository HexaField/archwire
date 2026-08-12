import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { ChangeModel, CodeModel, CodeNode, ConceptModel, FlowModel, FlowStep } from './lib/concepts';
import { ConceptView } from './components/ConceptView';
import { FlowView } from './components/FlowView';
import { GitGraph } from './components/GitGraph';
import { HierarchyExplorer } from './components/HierarchyExplorer';

export function App() {
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
  const [view, setView] = createSignal<ViewMode>('concepts');
  const [activeFlows, setActiveFlows] = createSignal<Set<string>>(new Set());
  const [activeDiff, setActiveDiff] = createSignal<string | null>(null);
  const [flowStepSel, setFlowStepSel] = createSignal<string | null>(null);

  async function loadJson<T>(urls: string[]): Promise<T | null> {
    for (const url of urls) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const text = await r.text();
        if (text.trimStart().startsWith('<')) continue;
        return JSON.parse(text) as T;
      } catch {
        // next
      }
    }
    return null;
  }

  onMount(async () => {
    // load all four together; set concepts LAST so the canvas mounts with the
    // code + change models already present (it indexes props.code once at init).
    const [c, codeModel, ch, fl] = await Promise.all([
      loadJson<ConceptModel>(['/concepts.json', '/concepts.sample.json']),
      loadJson<CodeModel>(['/code.json']),
      loadJson<ChangeModel>(['/changes.json']),
      loadJson<FlowModel>(['/flows.json']),
    ]);
    if (codeModel) setCode(codeModel.nodes);
    if (ch) setChanges(ch);
    if (fl) {
      setFlows(fl);
      // auto-activate all flows; auto-switch to flow view when no concept model
      setActiveFlows(new Set(fl.flows.map((f) => f.id)));
      if (!c) setView('flows');
    }
    if (c) setConcepts(c);
    if (!c && !fl) setErr('No concept model or flow data — provide public/concepts.json or public/flows.json');
  });

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
  // hovering a change previews its impact; the committed (clicked) change persists
  const overlay = () => overlayOf(hoverChange() ?? changeSel());

  // shared expand/collapse state (graph canvas + hierarchy explorer mirror it)
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
  const collapseAll = () => setExpanded(new Set<string>());
  // reveal a change on the canvas: open its touched concepts down to the changed
  // files (a deliberate button — selecting a change no longer auto-expands).
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
        // open the owning concept + every ancestor dir so the file surfaces
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

  // ── undo / redo over the view state (selection + expand) ───────────────
  type Snap = { cSel: string | null; cThr: string | null; changeSel: string | null; expanded: Set<string> };
  const snapNow = (): Snap => ({ cSel: cSel(), cThr: cThr(), changeSel: changeSel(), expanded: new Set(expanded()) });
  const snapEq = (a: Snap, b: Snap) =>
    a.cSel === b.cSel && a.cThr === b.cThr && a.changeSel === b.changeSel &&
    a.expanded.size === b.expanded.size && [...a.expanded].every((x) => b.expanded.has(x));
  const [histStack, setHistStack] = createSignal<Snap[]>([snapNow()]);
  const [histIdx, setHistIdx] = createSignal(0);
  let applying = false;
  let recordScheduled = false;
  // every selection/expand change records one history entry; sync bursts from a
  // single interaction coalesce through a microtask so one click = one undo step.
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

  // ── flow helpers ──
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
    // flowStepSel stores "flowId:stepId"
    const fm = flows();
    if (!fm) return undefined;
    for (const f of fm.flows) {
      const s = f.steps.find((st) => `${f.id}:${st.id}` === fid);
      if (s) return { flow: f.id, step: s };
    }
    return undefined;
  };

  return (
    <div class="app">
      <div id="sidebar">
        <div id="sidebar-header">
          <h1>archwire</h1>
          <div class="sub">{cm()?.system ?? '—'} · architecture planning</div>
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
          <Show when={cm() || flows()} fallback={<div class="detail-row">{err() ?? 'loading…'}</div>}>
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
                          <div class="flow-toggle">
                            <label>
                              <input type="radio" name="diff" checked={!activeDiff()} onChange={() => setActiveDiff(null)} />
                              <span class="flow-toggle-name">none</span>
                            </label>
                          </div>
                          <For each={[...new Set(fm().diffs.map((d) => d.diffSource))]}>
                            {(src) => (
                              <div class="flow-toggle">
                                <label>
                                  <input type="radio" name="diff" checked={activeDiff() === src} onChange={() => setActiveDiff(src)} />
                                  <span class="flow-toggle-name">{src}</span>
                                </label>
                              </div>
                            )}
                          </For>
                        </Show>
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
                            {(r) => <li><code class="path">{r.path}{r.line ? `:${r.line}` : ''}</code></li>}
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

        <div id="stats">
          <Show when={cm()}>
            {(m) => <>{m().concepts.length} concepts · {code().length} code nodes · {m().system}</>}
          </Show>
        </div>
      </div>

      <div id="main">
        <div class="canvas-holder">
        <Switch fallback={<div class="empty">{err() ?? 'loading…'}</div>}>
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
    </div>
  );
}
