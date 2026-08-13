# Archwire

Interactive architecture explorer. Visualise a codebase as a concept map, execution flow diagrams, and branch-level diffs — all in the browser.

Built with SolidJS + Cytoscape.js + elkjs. One model, many overlays.

## Quick start

```bash
pnpm install
pnpm dev            # development server with HMR
pnpm build          # production build → dist/
pnpm preview        # serve the production build
```

## Data pipeline

All extraction scripts live in `extract/`. They analyse a target repo and produce JSON files consumed by the frontend.

```
concepts.json → code.json → changes.json → flows.json → public/diffs/*.json
```

| Script | Purpose |
|--------|---------|
| `extract/concepts.mjs` | Build the concept model (nodes + layers) |
| `extract/code.mjs` | Map code files to concepts |
| `extract/changes.mjs` | Map git changes to concepts |
| `extract/flow.mjs` | Extract execution-flow diagrams (LLM-driven) |
| `extract/branches.mjs` | Scan branches for overlays + generate diff files |
| `extract/scan.mjs` | Batch runner: extract all flows + branch overlays |

### LLM-driven flow extraction

`flow.mjs` calls any OpenAI-compatible endpoint to trace execution paths through source code and produce structured flow diagrams.

```bash
# Extract a single flow
node extract/flow.mjs ~/path/to/repo --scope "join a neighbourhood"

# Extract from a PR
node extract/flow.mjs ~/path/to/repo --pr 778 --diff

# Batch: extract all scopes + branch overlays
node extract/scan.mjs ~/path/to/repo
```

#### LLM configuration

The endpoint and model persist in `extract/config.json` (gitignored):

```bash
# Save your preferred endpoint
node extract/flow.mjs --save-config --llm-url http://localhost:11434/v1/chat/completions --model llama3

# Config values serve as defaults; CLI flags override per-run
node extract/flow.mjs ~/repo --scope "..." --llm-url http://other:9090/v1/chat/completions
```

Default endpoint: Ollama at `http://localhost:11434/v1/chat/completions`.

Any OpenAI-compatible API works — llama.cpp, Ollama, vLLM, OpenAI, etc.

#### Scopes file

`extract/scopes.json` (gitignored, target-specific) defines the flows to extract. Copy `scopes.sample.json` to get started. Each entry can specify source files to include in the LLM prompt:

```json
[
  "simple scope as a string",
  {
    "scope": "join a neighbourhood from a URL",
    "files": [
      "rust-executor/src/neighbourhoods.rs",
      "core/src/neighbourhood/NeighbourhoodClient.ts"
    ]
  }
]
```

When `files` are provided, those exact files get included (up to `--context-budget` chars). Without `files`, the script auto-discovers relevant source files by keyword-matching the scope against the repo's file tree.

#### Options

| Flag | Purpose | Default |
|------|---------|---------|
| `--scope "text"` | Free-text scope description | — |
| `--pr N` | PR number (fetches diff via `gh`) | — |
| `--llm-url URL` | OpenAI-compatible endpoint | config or Ollama |
| `--model NAME` | Model name | whatever the endpoint serves |
| `--context-budget N` | Max chars of source code in prompt | 80000 |
| `--files a,b,c` | Specific source files to include | auto-discovered |
| `--merge` | Append to existing flows.json | overwrite |
| `--save-config` | Persist endpoint+model to config.json | — |
| `--prompt-only` | Print the prompt, skip LLM call | — |
| `--diff` | Generate diff overlay (PR mode) | — |

## Keeping flows current

When the codebase changes — new features, refactored paths, merged PRs:

1. **Update scopes.json** if new execution paths appeared or existing ones changed significantly.

2. **Re-run the scan:**
   ```bash
   node extract/scan.mjs ~/path/to/repo
   ```
   This re-extracts all flows and regenerates branch overlays.

3. **Rebuild:**
   ```bash
   pnpm build
   ```

For PR-specific overlays (how a PR changes an existing flow):
```bash
node extract/flow.mjs ~/path/to/repo --pr 842 --diff --merge
```

### Branch overlays

`branches.mjs` scans the target repo for branches with names matching concept model entries. Each matching branch produces:
- A diff overlay in `flows.json`
- A file-level diff in `public/diffs/<slug>.json` (for the Monaco diff viewer)

```bash
node extract/branches.mjs ~/path/to/repo --no-fetch
```

## Architecture

```
src/
├── App.tsx              # main app shell, overlay + diff controls
├── app.css              # global styles
├── components/
│   ├── ConceptGraph.tsx  # Cytoscape.js concept map (compound layout)
│   ├── FlowView.tsx      # Cytoscape.js flow diagram
│   ├── FlowExplorer.tsx  # tree-view sidebar for flow steps
│   └── DiffModal.tsx     # Monaco diff editor modal (lazy-loaded)
└── index.tsx             # entry point
```

The concept map supports multiple overlay types:
- **Flow overlays** — highlight concepts involved in a specific execution path
- **Diff overlays** — highlight concepts touched by a branch or PR
- **Branch overlays** — show file-level changes with clickable Monaco diffs
