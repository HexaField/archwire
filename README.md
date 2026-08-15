# archwire

Architecture visualisation tool that uses LLMs to extract execution flows and concept models from any codebase, then renders them as interactive graphs.

## Features

- **Repo management** — add local repos or clone from GitHub
- **LLM-powered extraction** — traces execution paths through source code
- **Concept maps** — hierarchical architecture visualisation with Cytoscape + ELK layout
- **Flow diagrams** — execution-path diagrams with branch diff overlays
- **Diff viewer** — Monaco-based side-by-side code diffs
- **Chat** — ask questions about the repo architecture

## Quick start

```bash
pnpm install
pnpm dev
```

Opens the client at `http://localhost:4300`. The server runs at `http://localhost:3001`.

Requires an OpenAI-compatible LLM endpoint for extraction. Default: Ollama at `localhost:11434`.

## Architecture

Monorepo with three packages:

- **@archwire/core** — shared TypeScript types
- **@archwire/server** — Express API handling repo management, LLM extraction, and data serving
- **@archwire/client** — SolidJS web UI with interactive graph visualisation

See [AGENTS.md](./AGENTS.md) for detailed documentation.
