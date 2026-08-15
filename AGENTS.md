# archwire

Architecture visualisation tool — extracts execution flows and concept models from codebases via LLM, serves them through an API, and renders interactive graphs in a web client.

## Monorepo structure

```
packages/
  core/     @archwire/core    — shared types (source-resolved, no build in dev)
  server/   @archwire/server  — Express API (repo management, extraction, LLM proxy)
  client/   @archwire/client  — SolidJS web UI (Cytoscape, ELK, Monaco)
```

## Quick start

```bash
pnpm install
pnpm dev          # starts both server (:3001) and client (:4300)
```

Vite proxies `/api` → `localhost:3001` in dev mode.

## Build

```bash
pnpm build        # builds all packages (core, server dist, client dist)
pnpm check        # TypeScript noEmit across all packages
```

## How it works

1. Add a repo (local path or GitHub URL) via the client UI.
2. The server clones/registers the repo and stores metadata in `packages/server/data/`.
3. Extraction calls the configured LLM (default: Ollama at `localhost:11434`) to trace execution paths through source code.
4. The client fetches extracted data from the server API and renders:
   - **Concept view** — hierarchical concept map (Cytoscape + ELK layout)
   - **Flow view** — execution-path diagrams with diff overlays
   - **Chat** — ask questions about the repo via the LLM

## Packages

### @archwire/core

Shared TypeScript types. Source-resolved in workspace (`exports: "./src/index.ts"`), no build step needed in dev.

Key types: `ConceptModel`, `FlowModel`, `CodeModel`, `ChangeModel`, `RepoInfo`, `LlmConfig`, `ScopeEntry`.

### @archwire/server

Express 5 API. Dev via `tsx watch`. Routes:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/repos` | GET/POST | List or add repos |
| `/api/repos/:id` | DELETE | Remove a repo |
| `/api/repos/:id/flows` | GET | Extracted flow data |
| `/api/repos/:id/concepts` | GET | Extracted concept model |
| `/api/repos/:id/code` | GET | Code structure |
| `/api/repos/:id/changes` | GET | Change model |
| `/api/repos/:id/diffs/:slug` | GET | Diff file content |
| `/api/repos/:id/extract/flows` | POST | Run flow extraction |
| `/api/repos/:id/extract/branches` | POST | Run branch scanning |
| `/api/repos/:id/ask` | POST | Ask LLM about the repo |
| `/api/llm/config` | GET/PUT | LLM configuration |
| `/api/llm/test` | POST | Test LLM connection |

Data stored in `packages/server/data/` (gitignored).

### @archwire/client

SolidJS app. Vite for dev/build. Dependencies:
- `cytoscape` + `elkjs` — graph layout
- `monaco-editor` — diff viewer
- `solid-js` — UI framework

## LLM configuration

Default endpoint: `http://localhost:11434/v1/chat/completions` (Ollama).
Configure via the `/api/llm/config` endpoint or `packages/server/data/config.json`.

## Conventions

- All imports from shared types use `@archwire/core`, never relative paths to another package.
- Server extraction output goes to `packages/server/data/repos/<id>/`.
- TypeScript strict mode, ESM throughout.
