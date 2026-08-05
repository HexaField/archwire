import { createEffect, createMemo, createSignal, For, Match, on, onMount, Show, Switch } from 'solid-js';
import type { ChangeModel, CodeModel, CodeNode, ConceptModel } from './lib/concepts';
import { ConceptView } from './components/ConceptView';
import { GitGraph } from './components/GitGraph';
import { HierarchyExplorer } from './components/HierarchyExplorer';

export function App() {
  const [concepts, setConcepts] = createSignal<ConceptModel | null>(null);
  const [code, setCode] = createSignal<CodeNode[]>([]);
  const [changes, setChanges] = createSignal<ChangeModel | null>(null);
  const [err, setErr] = createSignal<string | null>(null);
  const [cSel, setCSel] = createSignal<string | null>(null);
  const [cThr, setCThr] = createSignal<string | null>(null);
  const [changeSel, setChangeSel] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());

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
    // load all three together; set concepts LAST so the canvas mounts with the
    // code + change models already present (it indexes props.code once at init).
    const [c, codeModel, ch] = await Promise.all([
      loadJson<ConceptModel>(['/concepts.json', '/concepts.sample.json']),
      loadJson<CodeModel>(['/code.json']),
      loadJson<ChangeModel>(['/changes.json']),
    ]);
    if (codeModel) setCode(codeModel.nodes);
    if (ch) setChanges(ch);
    if (c) setConcepts(c);
    if (!c) setErr('No concept model — provide public/concepts.json');
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

  const overlay = () => {
    const ch = selChangeNode();
    return ch ? { concepts: new Set(ch.changedConcepts), paths: ch.changedPaths } : null;
  };

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
  // selecting a change opens the concepts it touches, so their changed code shows
  createEffect(
    on(changeSel, () => {
      const ch = selChangeNode();
      if (ch) setExpanded((prev) => {
        const next = new Set(prev);
        ch.changedConcepts.forEach((i) => next.add(i));
        return next;
      });
    }),
  );

  const laneName = (id: string) => changes()?.lanes.find((l) => l.id === id)?.name ?? id;
  const laneColor = (id: string) => changes()?.lanes.find((l) => l.id === id)?.color ?? '#8b949e';

  return (
    <div class="app">
      <div id="sidebar">
        <div id="sidebar-header">
          <h1>archwire</h1>
          <div class="sub">{cm()?.system ?? '—'} · architecture planning</div>
        </div>

        <div id="details">
          <Show when={cm()} fallback={<div class="detail-row">{err() ?? 'loading…'}</div>}>
            {(m) => (
              <Switch
                fallback={
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
                    <div class="detail-row"><span class="detail-label">Click</span> a concept → open its code + relations</div>
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
                }
              >
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
            )}
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
        <Show when={cm()} fallback={<div class="empty">{err() ?? 'loading…'}</div>}>
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
              toggleExpand={toggleExpand}
              collapseAll={collapseAll}
            />
          )}
        </Show>
        </div>
        <Show when={changes()}>
          {(ch) => <GitGraph model={ch()} selected={changeSel} onSelect={(id) => { setCSel(null); setCThr(null); setChangeSel(id); }} />}
        </Show>
      </div>
      <Show when={cm()}>
        {(m) => (
          <HierarchyExplorer
            model={m()}
            code={code()}
            expanded={expanded}
            toggleExpand={toggleExpand}
            selected={cSel}
            setSelected={(v) => { setChangeSel(null); setCSel(v); }}
          />
        )}
      </Show>
    </div>
  );
}
