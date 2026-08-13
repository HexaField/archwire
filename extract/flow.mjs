// archwire flow extractor — generates execution-path flow diagrams from a
// target repo, driven by PR diffs or scope descriptions. Uses an LLM to trace
// code paths and produce structured flow JSON.
//
// Usage:
//   node extract/flow.mjs <path-to-target-repo> --pr <number> [--repo owner/repo]
//   node extract/flow.mjs <path-to-target-repo> --scope "join a neighbourhood"
//   node extract/flow.mjs <path-to-target-repo> --pr 778 --diff   # also generate diff overlay
//
// Options:
//   --pr <n>            PR number (fetches diff via gh CLI)
//   --repo <owner/repo> GitHub repo for the PR (default: inferred from target repo)
//   --scope <text>      Free-text scope description (alternative to --pr)
//   --diff              Generate diff overlay (compare base flow with PR changes)
//   --llm-url <url>     OpenAI-compatible endpoint (default: Ollama http://localhost:11434/v1/chat/completions)
//   --model <name>      Model name for the LLM (default: whatever the endpoint serves)
//   --prompt-only       Output the LLM prompt to stdout instead of calling the endpoint
//   --merge <file>      Merge output into an existing flows.json instead of overwriting
//   --save-config       Persist --llm-url and --model to extract/config.json for future runs
//   --context-budget N  Max chars of source code to include in prompt (default: 40000)
//   --files a,b,c       Manually specify source files to include (comma-separated, repo-relative)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// ── config persistence ──
const configPath = path.join(here, 'config.json');
function loadConfig() {
  try { return JSON.parse(readFileSync(configPath, 'utf8')); }
  catch { return {}; }
}
const config = loadConfig();

// ── parse args ──
const args = process.argv.slice(2);
const targetArg = args.find((a) => !a.startsWith('--'));
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0; };
const flagVal = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) return null;
  const v = args[i + 1];
  return v.startsWith('--') ? null : v; // don't consume another flag as a value
};

if (!targetArg) {
  console.error('usage: node extract/flow.mjs <path-to-target-repo> [--pr N | --scope "text"] [--diff] [--prompt-only]');
  process.exit(1);
}
const targetAbs = path.resolve(targetArg);
const prNum = flagVal('pr');
const scope = flagVal('scope');
const wantDiff = flag('diff');
const promptOnly = flag('prompt-only');
const mergeFile = flagVal('merge');
const llmUrl = flagVal('llm-url') || config.llmUrl || 'http://localhost:11434/v1/chat/completions';
const llmModel = flagVal('model') || config.model || '';
const contextBudget = parseInt(flagVal('context-budget') || config.contextBudget || '40000', 10);

// save config when requested (can run standalone: --save-config without --pr/--scope)
if (flag('save-config')) {
  const newConfig = { ...config, llmUrl, model: llmModel, contextBudget };
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + '\n');
  console.error(`archwire: config saved → ${configPath}`);
}

if (!prNum && !scope) {
  if (flag('save-config')) process.exit(0); // allow save-only invocation
  console.error('error: provide --pr <number> or --scope "description"');
  process.exit(1);
}

// ── gather context ──
let conceptsSummary = '';
const conceptsPath = path.join(repoRoot, 'public', 'concepts.json');
if (existsSync(conceptsPath)) {
  try {
    const cm = JSON.parse(readFileSync(conceptsPath, 'utf8'));
    conceptsSummary = (cm.concepts ?? [])
      .map((c) => `- ${c.id}: ${c.name} (layer ${c.layer}) — ${c.summary}`)
      .join('\n');
  } catch { /* skip */ }
}

let prDiff = '';
let prTitle = '';
let prBody = '';
let ghRepo = flagVal('repo') || '';
if (prNum) {
  if (!ghRepo) {
    try {
      const remote = execSync('git remote get-url origin', { cwd: targetAbs, encoding: 'utf8' }).trim();
      const m = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      if (m) ghRepo = m[1];
    } catch { /* skip */ }
  }
  if (ghRepo) {
    try {
      prDiff = execSync(`gh pr diff ${prNum} --repo ${ghRepo}`, { cwd: targetAbs, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
      console.error(`warning: could not fetch PR diff: ${e.message}`);
    }
    try {
      const prJson = execSync(`gh pr view ${prNum} --repo ${ghRepo} --json title,body`, { cwd: targetAbs, encoding: 'utf8' });
      const pr = JSON.parse(prJson);
      prTitle = pr.title ?? '';
      prBody = pr.body ?? '';
    } catch { /* skip */ }
  }
}

// truncate large diffs to stay within LLM context
const MAX_DIFF_CHARS = 12000;
if (prDiff.length > MAX_DIFF_CHARS) {
  prDiff = prDiff.slice(0, MAX_DIFF_CHARS) + '\n\n[... diff truncated ...]';
}

// ── auto-discover relevant source files ──
const STOP_WORDS = new Set([
  'a','an','the','and','or','of','to','in','on','at','by','for','from','into','with',
  'that','this','when','what','how','does','each','then','also','over','all','new',
]);
const SOURCE_EXTS = new Set(['.rs','.ts','.tsx','.js','.jsx','.graphql','.gql','.toml','.py']);

function findRelevantFiles(targetPath, scopeText, budget) {
  const keywords = scopeText.toLowerCase()
    .split(/[\s/._-]+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  let allFiles;
  try {
    allFiles = execSync(
      `find . -type f \\( ${[...SOURCE_EXTS].map(e => `-name '*${e}'`).join(' -o ')} \\) ` +
      `-not -path '*/node_modules/*' -not -path '*/target/debug/*' -not -path '*/target/release/*' ` +
      `-not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*'`,
      { cwd: targetPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    ).trim().split('\n').filter(Boolean);
  } catch { return []; }

  // score files by keyword density in their path
  const scored = allFiles.map(f => {
    const rel = f.replace(/^\.\//, '');
    const lower = rel.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      // exact segment match (path part equals keyword)
      for (const seg of lower.split(/[/._-]/)) {
        if (seg === kw) score += 5;
        else if (seg.includes(kw)) score += 2;
      }
      // substring in full path
      if (lower.includes(kw)) score += 1;
    }
    return { absPath: path.join(targetPath, rel), rel, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  // read files up to budget
  const files = [];
  let chars = 0;
  for (const s of scored) {
    try {
      const content = readFileSync(s.absPath, 'utf8');
      if (chars + content.length > budget) {
        const remaining = budget - chars;
        if (remaining > 1000) {
          files.push({ path: s.rel, content: content.slice(0, remaining) + '\n[... truncated ...]' });
        }
        break;
      }
      files.push({ path: s.rel, content });
      chars += content.length;
    } catch { continue; }
  }
  return files;
}

// apply budget to a list of files — truncates/skips to stay within char limit
function budgetFiles(fileList, budget) {
  const result = [];
  let chars = 0;
  for (const f of fileList) {
    if (chars + f.content.length <= budget) {
      result.push(f);
      chars += f.content.length;
    } else {
      const remaining = budget - chars;
      if (remaining > 1000) {
        result.push({ path: f.path, content: f.content.slice(0, remaining) + '\n[... truncated ...]' });
      }
      break;
    }
  }
  return result;
}

let sourceContext = '';
if (scope && !promptOnly) {
  const manualFileList = flagVal('files')?.split(',').filter(Boolean) ?? [];
  let relevantFiles;
  if (manualFileList.length) {
    const raw = manualFileList.map(f => {
      try { return { path: f, content: readFileSync(path.join(targetAbs, f), 'utf8') }; }
      catch { console.error(`archwire: --files: cannot read ${f}`); return null; }
    }).filter(Boolean);
    relevantFiles = budgetFiles(raw, contextBudget);
  } else {
    relevantFiles = findRelevantFiles(targetAbs, scope, contextBudget);
  }

  if (relevantFiles.length) {
    sourceContext = '\n\nSOURCE CODE (trace execution through these files):\n\n';
    for (const f of relevantFiles) {
      sourceContext += `--- ${f.path} ---\n${f.content}\n--- end ---\n\n`;
    }
    console.error(`archwire: included ${relevantFiles.length} source file(s) (${Math.round(sourceContext.length / 1000)}k chars)`);
  } else {
    console.error('archwire: no relevant source files found for scope');
  }
}

// ── build prompt ──
const flowId = prNum ? `pr-${prNum}` : scope.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
const flowName = prNum ? `PR #${prNum}: ${prTitle || 'untitled'}` : scope;

const systemPrompt = `You are a code architecture analyst. You produce structured JSON describing execution flow diagrams for a codebase.

Output ONLY valid JSON matching this schema — no markdown, no explanation:

{
  "flows": [{
    "id": string,
    "name": string,
    "source": string,
    "steps": [{
      "id": string,
      "label": string (2-5 words),
      "detail": string (one sentence, optional),
      "parentId": string | null (for sub-steps within a higher-level step),
      "codeRefs": [{"path": string, "line": number | null}],
      "conceptIds": [string] (IDs from the concept model, if applicable),
      "kind": "start" | "action" | "decision" | "parallel" | "error" | "end"
    }],
    "transitions": [{
      "from": string (step id),
      "to": string (step id),
      "label": string | null (condition or description),
      "kind": "sequential" | "conditional" | "async" | "error"
    }]
  }],
  "diffs": [] (empty array unless told to generate diff overlay)
}

Rules:
- Each flow traces ONE user action or system process end-to-end.
- Use "start" and "end" kind for entry/exit points.
- Use "decision" for branching (if/else, switch, feature flags).
- Keep step labels SHORT (2-5 words). Put detail in the detail field.
- Include real file paths in codeRefs — these must exist in the repo.
- Use parentId for progressive disclosure: high-level steps break down into sub-steps.
- Top-level steps should give a clear overview; sub-steps show implementation detail.
- Transitions connect steps. Every step except "end" should have at least one outgoing transition.
- Use "conditional" kind with a label for if/else branches.
- Use "error" kind for error-handling paths.
- Use "async" kind for callbacks, promises, event handlers.`;

let userPrompt = `Analyze this codebase and generate a flow diagram.\n\n`;
userPrompt += `Flow ID: ${flowId}\n`;
userPrompt += `Flow name: ${flowName}\n\n`;

if (scope) {
  userPrompt += `SCOPE: ${scope}\n\n`;
  userPrompt += `Trace the execution path for this user action / system process through the codebase.\n\n`;
}

if (prTitle) {
  userPrompt += `PR TITLE: ${prTitle}\n`;
}
if (prBody) {
  userPrompt += `PR DESCRIPTION:\n${prBody.slice(0, 2000)}\n\n`;
}

if (prDiff) {
  userPrompt += `PR DIFF (key changes):\n\`\`\`diff\n${prDiff}\n\`\`\`\n\n`;
}

if (conceptsSummary) {
  userPrompt += `CONCEPT MODEL (use these IDs in conceptIds where applicable):\n${conceptsSummary}\n\n`;
}

userPrompt += `Generate the flow diagram JSON. Focus on the main execution path with key decision points and error paths.`;

if (sourceContext) userPrompt += sourceContext;

if (wantDiff) {
  userPrompt += `\n\nALSO generate a diff overlay in the "diffs" array. The diff should show what this PR changes relative to the existing flow:
- stepStatus: map of existing step IDs to "added" | "removed" | "modified"
- transitionStatus: map of "from->to" keys to "added" | "removed" | "modified"
- addedSteps: new steps introduced by this PR
- addedTransitions: new transitions introduced by this PR
- flowId: "${flowId}"
- diffSource: "PR #${prNum}"`;
}

if (promptOnly) {
  console.log('=== SYSTEM PROMPT ===');
  console.log(systemPrompt);
  console.log('\n=== USER PROMPT ===');
  console.log(userPrompt);
  process.exit(0);
}

// ── call LLM ──
console.error(`archwire: calling LLM at ${llmUrl}…`);
const body = {
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
  temperature: 0.1,
  max_tokens: 16384,
};
if (llmModel) body.model = llmModel;

let response;
try {
  const res = await fetch(llmUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`LLM error ${res.status}: ${text}`);
    process.exit(1);
  }
  response = await res.json();
} catch (e) {
  console.error(`LLM request failed: ${e.message}`);
  console.error('Use --prompt-only to output the prompt instead, or check the LLM endpoint.');
  process.exit(1);
}

const content = response.choices?.[0]?.message?.content ?? '';

// extract JSON from the response (may have markdown fences)
let jsonStr = content;
const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
if (fenceMatch) jsonStr = fenceMatch[1];

let flowData;
try {
  flowData = JSON.parse(jsonStr.trim());
} catch (e) {
  console.error(`Failed to parse LLM response as JSON: ${e.message}`);
  console.error('Raw response:');
  console.error(content);
  process.exit(1);
}

// ── validate + write ──
if (!flowData.flows || !Array.isArray(flowData.flows)) {
  console.error('Invalid flow data: missing "flows" array');
  process.exit(1);
}
if (!flowData.diffs) flowData.diffs = [];

// merge mode: append to existing flows.json
const outPath = path.join(repoRoot, 'public', 'flows.json');
if (mergeFile || (existsSync(outPath) && flag('merge'))) {
  try {
    const existing = JSON.parse(readFileSync(mergeFile || outPath, 'utf8'));
    // deduplicate by flow ID
    const existingIds = new Set(existing.flows.map((f) => f.id));
    for (const f of flowData.flows) {
      if (existingIds.has(f.id)) {
        existing.flows = existing.flows.filter((ef) => ef.id !== f.id);
      }
      existing.flows.push(f);
    }
    for (const d of flowData.diffs) existing.diffs.push(d);
    flowData = existing;
  } catch { /* start fresh */ }
}

writeFileSync(outPath, JSON.stringify(flowData, null, 2));
const stepCount = flowData.flows.reduce((n, f) => n + f.steps.length, 0);
const diffCount = flowData.diffs.length;
console.error(
  `archwire: ${flowData.flows.length} flow(s), ${stepCount} steps, ${diffCount} diff overlay(s) → public/flows.json`,
);
