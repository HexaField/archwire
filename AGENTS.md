# archwire

An **architecture-planning canvas** for humans + agents. One continuous surface
drills from a codebase's high-level **concepts** down to the **code** that
implements them; a **change axis** (a git/plan graph) then overlays each PR or
planned change onto that architecture, showing a change's impact at the highest
(concept) and lowest (file) levels at once. Two jobs: **learn** a system, and
**plan** changes to it. Pilot target = AD4M's Holograph initiative.

The guiding principle: **one model, many overlays.** The concept model gets
extracted once and stays stable; the code grounding hangs off it; git/plan changes
project *up* onto it (a changed file lights its concept). Nothing is hand-drawn.

The UI: a GitHub-dark, monospace shell — a left **sidebar** (overview / concept /
code / thread / change detail), a **main** canvas (the concept⇢code graph), a
bottom **change-graph** panel, and a right **hierarchy explorer** (a tree that
mirrors the canvas 1-1). `App.tsx` owns the shared selection + **expand** + overlay
state; the canvas and the tree both read/write the one expand set. A sidebar
controls row gives **undo / redo** (Ctrl+Z / Ctrl+Shift+Z) over that state, plus
**collapse all**.

## Stack

- **Concept model** (`public/concepts.json`, schema `src/lib/concepts.ts`) —
  concepts (domain ideas with abstraction `layer`, `pillar`, breakdown `parent`,
  `implementedBy` paths, relations) + threads. An LLM/agent extracts it from the
  repo's docs + code (static analysis cannot recover it).
- **Code grounding** (`public/code.json`) — `extract/ground.mjs` walks the target
  repo's filesystem under each concept's `implementedBy` paths → a nested file tree
  attached to its concept. Language-agnostic (TS + Rust). The concept→code bridge
  the canvas drills through.
- **Change model** (`public/changes.json`) — a curated git/plan DAG for an
  initiative: PRs + planned deltas, each mapped to the concepts + code paths it
  touches (`changedConcepts` = git diffs projected through `implementedBy`).
- **Render:** a bespoke SolidJS + Vite app; Cytoscape.js draws the canvas, elkjs
  the compound layout, an SVG panel the change graph.

(A structural extractor `extract/extract.mjs` + `GraphView` / `DsmView` — a
dependency graph + coupling matrix — survive from the earlier phase but are NOT
wired into the current shell; they return as a code-level *lens*.)

Everything runs free and open-source, on private code, at no cost.

## Commands

```bash
pnpm install                       # approves esbuild's build script (pnpm-workspace.yaml)
pnpm extract <path-to-target-repo> # writes public/model.json from the target
pnpm dev                           # Vite dev server on http://localhost:4300
pnpm build                         # production build to dist/
pnpm preview                       # serve the built dist/
pnpm check                         # tsc --noEmit
```

Data pipeline (per target): (1) an LLM/agent extracts `public/concepts.json`;
(2) `node extract/ground.mjs <repo>` grounds it → `public/code.json`; (3) an
agent/curator builds `public/changes.json` for the initiative's PRs + plans. The
app loads all three at start — concepts LAST, so the canvas indexes the code model
at mount.

## Layout

```
extract/ground.mjs       # concepts.json + repo → public/code.json (concept→code file tree)
extract/extract.mjs      # (unused) dependency-cruiser → public/model.json
public/concepts.json     # extracted concept model (git-ignored; concepts.sample.json = fallback)
public/code.json         # concept→code grounding (git-ignored; regenerate per target)
public/changes.json      # curated git/plan change model (git-ignored)
src/index.tsx            # Solid entry
src/App.tsx              # sidebar shell + canvas + change panel; owns selection/overlay state
src/lib/concepts.ts      # concept / code / change model types
src/components/ConceptView.tsx # the continuous concept⇢code canvas (elkjs compound, progressive disclosure, overlay)
src/components/GitGraph.tsx     # bottom change-graph panel (SVG DAG of PRs/plans; click → overlay)
src/components/HierarchyExplorer.tsx # right tree explorer — shares the expand state with the canvas 1-1
src/components/GraphView.tsx    # (unused) structural coupling-scatter — returns as a lens
src/components/DsmView.tsx       # (unused) Design Structure Matrix — returns as a lens
```

## The canvas + change axis

- **Concept⇢code canvas** — concepts as labelled container boxes (Perspective ⊃
  Link + SubjectClass …) laid out in **rows by abstraction `layer`** (elk
  partitioning; foundational at the bottom, higher-level at the top — see the axis
  labels), one **undirected** orthogonal wire per related pair at rest. **Click a
  node to select it** (relations + sidebar detail); the canvas
  never opens/closes on click and never moves the camera. **Double-click frames**
  a node (the toolbar `fit` button frames everything). Open/close a concept from
  the **tree** (arrow icons / keyboard) — the canvas mirrors it 1-1, nesting the
  real `implementedBy` code inside. Progressive disclosure high-level → file; hover
  for a tooltip. The landing shows the six top concepts collapsed.
- **Hierarchy explorer** (right) — the concept→code tree, sharing the canvas's
  expand state 1-1: open/close a node here or on the canvas and the other follows;
  selection stays in sync, and **hovering a node or a row highlights its twin** in
  the other panel. **Keyboard** (focus the tree first): ↑↓ move a focus cursor
  through the visible rows, → opens (or steps into the first child if already
  open), ← closes (or steps to the parent if already closed), Enter selects the
  focused row. The focus cursor is tree-local and distinct from selection, so
  arrowing never re-marks the canvas or records undo history.
- **Threads** — pick one in the sidebar; its concept path lights green with a
  numbered, code-linked walkthrough.
- **Change graph** (bottom panel) — the initiative's PRs + planned deltas as a DAG
  across lanes (planned nodes dashed). **Hover a node to preview** its impact — a
  tooltip (touched concepts + path count) plus the touched concepts glow amber, no
  state change. **Click to select** it: the amber marks persist and the sidebar
  lists touched concepts + real code paths. Selecting never auto-expands — the
  sidebar's **‘reveal on canvas’** button opens the touched concepts down to their
  changed files on demand (the camera stays put; frame with double-click / fit).

## Gotchas

- **pnpm build-script approval.** pnpm 11 blocks native postinstalls and ignores
  the `pnpm` field in `package.json`. `esbuild` needs its script; the repo
  approves it in `pnpm-workspace.yaml`. If a fresh install reports "Ignored build
  scripts", run `pnpm rebuild esbuild`.
- **`pnpm build` skips type-checking** (esbuild transpiles). Run `pnpm check`
  before every commit.
- **Extractor resolution.** dependency-cruiser reads the target's `tsconfig.json`
  for path aliases. A monorepo with per-package tsconfigs needs a richer config
  than the MVP default — the current pass targets a single tsconfig at the repo
  root.
- **Canvas load order.** `App` loads concepts + code + changes in parallel and
  sets concepts LAST, so `ConceptView` indexes the code model at mount. Concepts
  first races the canvas (empty code index → concepts won't open into code).
- **Relation edges need both endpoints present.** `applySelect` / `applyThread`
  add extra Cytoscape edges between concept nodes. A relation whose other end sits
  inside a still-collapsed group has no node to attach to — adding an edge with a
  missing source or target THROWS, and the throw aborts Solid's reactive flush, so
  a later effect (e.g. `rebuild`) silently never runs (the symptom: clicking a
  concept selects it but never opens). Always guard BOTH endpoints before `cy.add`.
- **Layout = semantic layers, not edge topology.** Vertical position means
  abstraction: rows come from each concept's `layer` via elk partitioning
  (`partitionOf`, low layer → bottom). Only CROSS-layer relations feed elk's
  layering, so same-layer concepts share one row; every relation still renders,
  deduped to one undirected wire per pair with no at-rest arrowheads. Change a
  concept's `layer` and its row moves — position is never arbitrary.
- **Edges: straight cytoscape wires between spread ports.** Every wire (at-rest
  relations, selection, thread) is `curve-style: straight`, so they look identical
  and follow node moves. cytoscape can't channel-separate ORTHOGONAL edges — we
  tried and dropped, in order: reproducing elk's routes via `segments` (skewed
  stubs), a static SVG overlay of elk's routes (broke on drag, differed from
  selection edges), and `round-taxi` + per-edge `taxi-turn` stagger + ports (the
  router tangled the offset endpoints). Straight wins because with spread ports it's
  clean. `layout()` spreads each node's connection points: cross-layer wires leave
  the source's BOTTOM and enter the target's TOP at offset x-positions
  (`source-endpoint` / `target-endpoint`, ordered by the other end's x to keep the
  fan crossing-free), so lines cross at a point instead of piling onto one
  node-centre stub or sharing a corridor. Same-layer wires stay centre-to-centre.
  Each wire's arrowheads come from the REAL relation directions (`aggDirs`, applied
  per-edge in `layout()`): both ends for a bidirectional pair (e.g. runtime hosts
  language / language hosted by runtime), one end for a one-way pair. elk still lays
  out the nodes; its edge routes go unused. (True orthogonal channels would need elk
  routing + locked node positions — heavier.)
- **Selection highlights the SAME wires, one SHORT label each.** `applySelect`
  does NOT draw new edges — it adds `.sel-rel` (amber) to the existing aggregated
  wires touching the concept, so connections never jump on select. Each wire's
  `data(label)` is a single short relation (the selected concept's own relation to
  that neighbour, else the pair's first) — not the full combined string — so labels
  on the fanned-out wires don't overlap. `aggLabel` (all a pair's relations joined)
  is only the fallback source. The arrowheads (from `aggDirs`, so both heads show on
  a bidirectional wire) just recolour amber under `.sel-rel` — the shapes stay put.
  `clearMarks` drops the `.sel-rel` class and the label data (recolouring the arrows
  back to grey); it does NOT delete the wires or their arrow shapes — only thread
  `.__te` edges get added/removed.
- **The camera is the user's.** Open/close/select never move the viewport —
  `rebuild` snapshots zoom+pan and restores them *exactly* after the elk re-layout
  (no counter-pan, no fit), so the interacted node opens in place while unrelated
  nodes may re-flow around it. Only double-click (frame a node), the `fit` button,
  and thread framing move the camera; change hover/click/reveal do not. Note: elk
  re-lays-out the whole compound graph on every open/close, so a truly stable
  layout (persisted positions) remains a separate, larger change.
- **History is coalesced.** Undo/redo snapshots `{selection, thread, change,
  expanded}`. A single interaction fires several signal writes, so the recorder
  debounces through a microtask — one click = one undo step. Applying a snapshot
  sets an `applying` guard so it never records itself, and dedupes by value so a
  no-op never lands on the stack.
- **Change model is curated.** `changes.json` comes from a git/spec research pass
  (real PR file lists via `gh` + planned deltas from the `.specs`), not a live git
  read. A changed file lights a concept when it sits under one of that concept's
  `implementedBy` paths — so a change touching net-new code no concept covers
  overlays nothing (a real signal: the concept model has a gap).

## Roadmap

- **Now:** concept⇢code canvas + change overlay (Holograph PRs + planned deltas).
- **Next:** commit-level scrubbing (per-commit deltas, not just per-PR); the
  coupling **matrix lens** at the code level; add the missing sync-substrate
  concept (Holograph #843–#845 touch a `HolographSyncModule` no concept covers);
  a live git source (git + `gh`) beyond the curated model; agent-authored proposal
  overlays.
- **Deeper grounding:** imports / calls under the file tree need a Rust extractor
  (Joern needs a JVM, absent here) — rust-analyzer SCIP + guppy per the plan.
