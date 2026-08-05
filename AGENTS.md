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
code / thread / change detail, footer stats), a **main** canvas (the concept⇢code
graph), and a bottom **change-graph** panel. `App.tsx` owns the shared selection
+ overlay state.

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
src/components/GraphView.tsx    # (unused) structural coupling-scatter — returns as a lens
src/components/DsmView.tsx       # (unused) Design Structure Matrix — returns as a lens
```

## The canvas + change axis

- **Concept⇢code canvas** — concepts as labelled container boxes (Perspective ⊃
  Link + SubjectClass …), elkjs compound layout, aggregated orthogonal wires at
  rest. **Click a concept to open its real code** (its `implementedBy` tree nests
  inside it; click a dir to go deeper to files) and focus it (relations shown).
  Progressive disclosure on ONE surface — high-level → file. Hover for a tooltip.
- **Threads** — pick one in the sidebar; its concept path lights green with a
  numbered, code-linked walkthrough.
- **Change graph** (bottom panel) — the initiative's PRs + planned deltas as a DAG
  across lanes (planned nodes dashed). **Click a PR/plan → overlay its impact**:
  the concepts it touches glow amber, their changed code auto-expands + highlights,
  and the sidebar lists touched concepts + real code paths. Highest + lowest level
  impact of a change, at once.

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
