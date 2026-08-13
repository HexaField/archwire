// archwire batch scanner — runs flow extraction for multiple scopes, then
// regenerates branch overlays. Self-service: point at a repo, feed it scopes,
// and it produces the full flows.json + branch diffs.
//
// Usage:
//   node extract/scan.mjs <path-to-target-repo>
//   node extract/scan.mjs <path-to-target-repo> --scopes custom-scopes.json
//   node extract/scan.mjs <path-to-target-repo> --no-branches
//   node extract/scan.mjs <path-to-target-repo> --dry-run
//
// Scopes file: JSON array of scope strings (one per flow).
// Default: extract/scopes.json (create one if it doesn't exist).

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const targetArg = args.find(a => !a.startsWith('--'));
const flag = name => args.includes(`--${name}`);
const flagVal = name => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };

if (!targetArg) {
  console.error('usage: node extract/scan.mjs <path-to-target-repo> [--scopes file.json] [--no-branches] [--dry-run]');
  process.exit(1);
}

const noBranches = flag('no-branches');
const dryRun = flag('dry-run');

// load scopes
const scopesArg = flagVal('scopes');
const scopesPath = scopesArg || path.join(here, 'scopes.json');

if (!existsSync(scopesPath)) {
  console.error(`no scopes file at ${scopesPath}`);
  console.error('create one — JSON array of scope descriptions:');
  console.error(JSON.stringify([
    'create a new local perspective',
    'join a neighbourhood from a URL',
  ], null, 2));
  process.exit(1);
}

let rawScopes;
try {
  rawScopes = JSON.parse(readFileSync(scopesPath, 'utf8'));
  if (!Array.isArray(rawScopes)) throw new Error('scopes file must contain a JSON array');
} catch (e) {
  console.error(`failed to read scopes: ${e.message}`);
  process.exit(1);
}

// normalise: accept strings or {scope, files?} objects
const scopes = rawScopes.map(s => typeof s === 'string' ? { scope: s } : s);

console.error(`archwire scan: ${scopes.length} scope(s) from ${scopesPath}`);
if (dryRun) {
  for (const s of scopes) console.error(`  → ${s.scope}${s.files ? ` (${s.files.length} files)` : ''}`);
  console.error('\n(dry run — no extraction performed)');
  process.exit(0);
}

// pass through any LLM flags
const passthrough = [];
for (const f of ['llm-url', 'model', 'context-budget']) {
  const v = flagVal(f);
  if (v) passthrough.push(`--${f}`, JSON.stringify(v));
}

// extract each scope
const flowMjs = path.join(here, 'flow.mjs');
let first = true;
let succeeded = 0;
let failed = 0;

for (let i = 0; i < scopes.length; i++) {
  const entry = scopes[i];
  console.error(`\n── [${i + 1}/${scopes.length}] ${entry.scope} ──`);

  const cmd = [
    'node', flowMjs, targetArg,
    '--scope', JSON.stringify(entry.scope),
    ...(first ? [] : ['--merge']),
    ...(entry.files?.length ? ['--files', entry.files.join(',')] : []),
    ...passthrough,
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'inherit', timeout: 900_000 });
    succeeded++;
  } catch (e) {
    console.error(`  ✗ failed: ${e.message}`);
    failed++;
  }
  first = false;
}

console.error(`\narchwire scan: ${succeeded} succeeded, ${failed} failed`);

// branch overlays
if (!noBranches) {
  console.error('\n── branch scan ──');
  try {
    execSync(`node ${path.join(here, 'branches.mjs')} ${targetArg} --no-fetch`, {
      stdio: 'inherit',
      timeout: 120_000,
    });
  } catch (e) {
    console.error(`  ✗ branch scan failed: ${e.message}`);
  }
}

console.error('\narchwire scan complete');
