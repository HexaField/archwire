// archwire branch scanner — generates diff overlays by matching branch changes
// against flow step code references. No LLM required — pure git + file matching.
//
// Usage:
//   node extract/branches.mjs <path-to-target-repo> [--base main] [--local-only]
//
// Options:
//   --base <branch>   Base branch for comparison (default: auto-detect)
//   --local-only      Only scan local branches, skip remote tracking
//   --no-fetch        Skip git fetch

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// ── parse args ──
const args = process.argv.slice(2);
const targetArg = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(`--${name}`);
const flagVal = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

if (!targetArg) {
  console.error('usage: node extract/branches.mjs <path-to-target-repo> [--base main] [--local-only] [--no-fetch]');
  process.exit(1);
}
const targetAbs = path.resolve(targetArg);
const localOnly = flag('local-only');
const noFetch = flag('no-fetch');

// ── detect base branch ──
function detectBase(repoPath) {
  try {
    const head = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: repoPath, encoding: 'utf8', stdio: 'pipe',
    }).trim();
    return head.replace('refs/remotes/origin/', '');
  } catch { /* fall through */ }
  for (const name of ['main', 'master', 'develop', 'dev']) {
    try {
      execSync(`git rev-parse --verify ${name}`, {
        cwd: repoPath, encoding: 'utf8', stdio: 'pipe',
      });
      return name;
    } catch { /* next */ }
  }
  return 'main';
}
const baseBranch = flagVal('base') || detectBase(targetAbs);

// ── load existing flows ──
const flowsPath = path.join(repoRoot, 'public', 'flows.json');
if (!existsSync(flowsPath)) {
  console.error('error: no public/flows.json — run flow extraction first');
  process.exit(1);
}
const flowData = JSON.parse(readFileSync(flowsPath, 'utf8'));
if (!flowData.flows?.length) {
  console.error('error: no flows in flows.json — nothing to match branches against');
  process.exit(1);
}

// ── build code-ref index from all flows ──
// Each code-ref path gets both an exact entry and a stem entry (for module
// directory matching: perspectives.rs → matches perspectives/*.rs too).
const codeRefs = []; // {path, stem, flowId, stepId}
for (const flow of flowData.flows) {
  for (const step of flow.steps) {
    for (const ref of (step.codeRefs ?? [])) {
      const p = ref.path.replace(/^\.\//, '');
      const dot = p.lastIndexOf('.');
      const stem = dot > 0 ? p.slice(0, dot) : p;
      codeRefs.push({ path: p, stem, flowId: flow.id, stepId: step.id });
    }
  }
}
const uniquePaths = new Set(codeRefs.map((r) => r.path));
console.error(`archwire: ${uniquePaths.size} tracked files across ${flowData.flows.length} flow(s), base: ${baseBranch}`);

// ── fetch + list branches ──
if (!noFetch) {
  try {
    execSync('git fetch --all --prune', { cwd: targetAbs, stdio: 'pipe', timeout: 30000 });
  } catch { console.error('warning: git fetch failed (offline?)'); }
}

let rawBranches;
try {
  const refs = localOnly ? 'refs/heads/' : 'refs/heads/ refs/remotes/origin/';
  rawBranches = execSync(`git for-each-ref --format='%(refname:short)' ${refs}`, {
    cwd: targetAbs, encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);
} catch (e) {
  console.error(`failed to list branches: ${e.message}`);
  process.exit(1);
}

// normalize: strip origin/ prefix, deduplicate (prefer remote ref)
const branches = new Map(); // displayName → gitRef
for (const b of rawBranches) {
  if (b === 'HEAD' || b.endsWith('/HEAD')) continue;
  const name = b.replace(/^origin\//, '');
  if (name === baseBranch) continue;
  // remote ref is more current than a stale local checkout
  if (!branches.has(name) || b.startsWith('origin/')) {
    branches.set(name, b);
  }
}
console.error(`archwire: ${branches.size} branches to scan`);

// ── strip old branch overlays; keep PR / manual diffs ──
flowData.diffs = (flowData.diffs ?? []).filter((d) => !d.diffSource.startsWith('branch: '));

// ── generate overlays ──
let hitCount = 0;
let skipCount = 0;
for (const [name, ref] of branches) {
  let changedFiles;
  try {
    const raw = execSync(`git diff ${baseBranch}...${ref} --name-only`, {
      cwd: targetAbs, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: 'pipe',
    });
    changedFiles = new Set(raw.trim().split('\n').filter(Boolean).map((f) => f.replace(/^\.\//, '')));
  } catch {
    skipCount++;
    continue; // no common ancestor or other git error
  }
  if (!changedFiles.size) continue;

  // match: exact path OR file sits inside a stem directory
  // (perspectives.rs → matches perspectives/perspective_instance.rs)
  const affected = new Map(); // flowId → Set<stepId>
  for (const ref2 of codeRefs) {
    for (const cf of changedFiles) {
      if (cf === ref2.path || cf.startsWith(ref2.stem + '/')) {
        const set = affected.get(ref2.flowId) ?? new Set();
        set.add(ref2.stepId);
        affected.set(ref2.flowId, set);
        break;
      }
    }
  }

  if (affected.size) {
    hitCount++;

    // generate diff file with base + modified content for each matched file
    const matchedFiles = new Set();
    for (const cf of changedFiles) {
      for (const ref2 of codeRefs) {
        if (cf === ref2.path || cf.startsWith(ref2.stem + '/')) {
          matchedFiles.add(cf);
          break;
        }
      }
    }
    if (matchedFiles.size) {
      const diffFiles = {};
      for (const fp of matchedFiles) {
        let original = '', modified = '';
        try { original = execSync(`git show ${baseBranch}:${fp}`, { cwd: targetAbs, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: 'pipe' }); } catch { /* new file */ }
        try { modified = execSync(`git show ${ref}:${fp}`, { cwd: targetAbs, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: 'pipe' }); } catch { /* deleted file */ }
        diffFiles[fp] = { original, modified };
      }
      const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
      const diffDir = path.join(repoRoot, 'public', 'diffs');
      if (!existsSync(diffDir)) mkdirSync(diffDir, { recursive: true });
      writeFileSync(path.join(diffDir, `${slug}.json`), JSON.stringify({ branch: name, base: baseBranch, files: diffFiles }));
    }

    for (const [flowId, stepIds] of affected) {
      const stepStatus = {};
      for (const sid of stepIds) stepStatus[sid] = 'modified';
      flowData.diffs.push({
        flowId,
        diffSource: `branch: ${name}`,
        stepStatus,
        transitionStatus: {},
        addedSteps: [],
        addedTransitions: [],
      });
    }
  }
}

writeFileSync(flowsPath, JSON.stringify(flowData, null, 2));
const total = flowData.diffs.length;
console.error(
  `archwire: ${hitCount}/${branches.size} branch(es) affect tracked code → ${total} overlay(s) total` +
  (skipCount ? ` (${skipCount} skipped — no common ancestor)` : ''),
);
