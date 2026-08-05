// archwire concept→code grounding: expands each concept's implementedBy paths
// into the real file tree of the target repo, so the continuous canvas can drill
// from a concept down to its code. Language-agnostic (walks the filesystem).
//
// Usage:  node extract/ground.mjs <path-to-target-repo>

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('usage: node extract/ground.mjs <path-to-target-repo>');
  process.exit(1);
}
const targetAbs = path.resolve(targetArg);

const conceptsPath = path.join(repoRoot, 'public', 'concepts.json');
if (!existsSync(conceptsPath)) {
  console.error('public/concepts.json missing — extract the concept model first');
  process.exit(1);
}
const concepts = JSON.parse(readFileSync(conceptsPath, 'utf8')).concepts;

const IGNORE = new Set(['node_modules', 'target', 'dist', 'build', '.git', '__pycache__', 'coverage']);
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|rs|py|graphql|gql|toml)$/;
const MAX_PER_PATH = 50; // keep a concept's subtree navigable

const nodes = [];
const seen = new Set();
function add(id, data) {
  if (seen.has(id)) return;
  seen.add(id);
  nodes.push({ id, ...data });
}

function walk(abs, rel, parentId, budget) {
  if (budget.n >= MAX_PER_PATH) return;
  const base = path.basename(rel);
  if (IGNORE.has(base)) return;
  let st;
  try {
    st = statSync(abs);
  } catch {
    return;
  }
  const id = `code:${rel}`;
  if (st.isDirectory()) {
    add(id, { path: rel, label: base, kind: 'dir', parent: parentId });
    let entries;
    try {
      entries = readdirSync(abs);
    } catch {
      return;
    }
    // directories first, then files — stable order
    entries.sort((a, b) => a.localeCompare(b));
    const dirs = [];
    const files = [];
    for (const e of entries) {
      try {
        (statSync(path.join(abs, e)).isDirectory() ? dirs : files).push(e);
      } catch {
        /* skip */
      }
    }
    for (const e of [...dirs, ...files]) {
      if (budget.n >= MAX_PER_PATH) break;
      walk(path.join(abs, e), path.join(rel, e), id, budget);
    }
  } else if (st.isFile() && CODE_RE.test(base)) {
    budget.n += 1;
    add(id, { path: rel, label: base, kind: 'file', parent: parentId });
  }
}

for (const c of concepts) {
  for (const rel of c.implementedBy ?? []) {
    const abs = path.join(targetAbs, rel);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    const id = `code:${rel}`;
    const budget = { n: 0 };
    if (st.isDirectory()) {
      // the top of this path attaches to the concept
      add(id, { path: rel, label: path.basename(rel), kind: 'dir', parent: null, concept: c.id });
      let entries;
      try {
        entries = readdirSync(abs);
      } catch {
        continue;
      }
      entries.sort((a, b) => a.localeCompare(b));
      const dirs = [];
      const files = [];
      for (const e of entries) {
        try {
          (statSync(path.join(abs, e)).isDirectory() ? dirs : files).push(e);
        } catch {
          /* skip */
        }
      }
      for (const e of [...dirs, ...files]) {
        if (budget.n >= MAX_PER_PATH) break;
        walk(path.join(abs, e), path.join(rel, e), id, budget);
      }
    } else if (st.isFile() && CODE_RE.test(path.basename(rel))) {
      add(id, { path: rel, label: path.basename(rel), kind: 'file', parent: null, concept: c.id });
    }
  }
}

writeFileSync(path.join(repoRoot, 'public', 'code.json'), JSON.stringify({ target: targetAbs, nodes }, null, 2));
console.error(
  `archwire: grounded ${nodes.length} code nodes across ${concepts.length} concepts → public/code.json`,
);
