// Flow extraction — calls an LLM to trace execution paths through source code.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { FlowModel, ScopeEntry, ConceptModel } from '@archwire/core'
import { findRelevantFiles, readSpecificFiles } from './files.ts'
import { repoDataDir } from '../lib/repos.ts'
import { loadConfig } from '../lib/config.ts'
import { chat, extractJson } from '../lib/llm.ts'

const SYSTEM_PROMPT = `You are a code architecture analyst. You produce structured JSON describing execution flow diagrams for a codebase.

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
  "diffs": []
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
- Use "async" kind for callbacks, promises, event handlers.`

export interface FlowExtractionResult {
  flowId: string
  flowName: string
  steps: number
  transitions: number
}

export async function extractFlow(
  repoId: string,
  repoPath: string,
  scope: ScopeEntry,
  merge: boolean,
  onToken?: (token: string) => void,
): Promise<FlowExtractionResult> {
  const scopeText = scope.scope
  const flowId = scopeText.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60)
  const { contextBudget } = loadConfig()

  // gather source context
  const files = scope.files?.length
    ? readSpecificFiles(repoPath, scope.files, contextBudget)
    : findRelevantFiles(repoPath, scopeText, contextBudget)

  let sourceContext = ''
  if (files.length) {
    sourceContext = '\n\nSOURCE CODE (trace execution through these files):\n\n'
    for (const f of files) {
      sourceContext += `--- ${f.path} ---\n${f.content}\n--- end ---\n\n`
    }
  }

  // load concept model for context
  let conceptsSummary = ''
  const conceptsPath = path.join(repoDataDir(repoId), 'concepts.json')
  if (existsSync(conceptsPath)) {
    try {
      const cm: ConceptModel = JSON.parse(readFileSync(conceptsPath, 'utf8'))
      conceptsSummary = (cm.concepts ?? [])
        .map(c => `- ${c.id}: ${c.name} (layer ${c.layer}) — ${c.summary}`)
        .join('\n')
    } catch { /* skip */ }
  }

  // build prompt
  let userPrompt = `Analyze this codebase and generate a flow diagram.\n\n`
  userPrompt += `Flow ID: ${flowId}\nFlow name: ${scopeText}\n\n`
  userPrompt += `SCOPE: ${scopeText}\n\n`
  userPrompt += `Trace the execution path for this user action / system process through the codebase.\n\n`

  if (conceptsSummary) {
    userPrompt += `CONCEPT MODEL (use these IDs in conceptIds where applicable):\n${conceptsSummary}\n\n`
  }

  userPrompt += `Generate the flow diagram JSON. Focus on the main execution path with key decision points and error paths.`
  if (sourceContext) userPrompt += sourceContext

  // call LLM
  const content = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.1, numPredict: 16384, onToken },
  )

  let flowData: FlowModel
  try {
    flowData = JSON.parse(extractJson(content))
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${(e as Error).message}`)
  }

  if (!flowData.flows || !Array.isArray(flowData.flows)) {
    throw new Error('Invalid flow data: missing "flows" array')
  }
  if (!flowData.diffs) flowData.diffs = []

  // merge with existing flows
  const outPath = path.join(repoDataDir(repoId), 'flows.json')
  if (merge && existsSync(outPath)) {
    try {
      const existing: FlowModel = JSON.parse(readFileSync(outPath, 'utf8'))
      const existingIds = new Set(existing.flows.map(f => f.id))
      for (const f of flowData.flows) {
        if (existingIds.has(f.id)) {
          existing.flows = existing.flows.filter(ef => ef.id !== f.id)
        }
        existing.flows.push(f)
      }
      for (const d of flowData.diffs) existing.diffs.push(d)
      flowData = existing
    } catch { /* start fresh */ }
  }

  writeFileSync(outPath, JSON.stringify(flowData, null, 2))

  const totalSteps = flowData.flows.reduce((n, f) => n + f.steps.length, 0)
  return {
    flowId,
    flowName: scopeText,
    steps: totalSteps,
    transitions: flowData.flows.reduce((n, f) => n + f.transitions.length, 0),
  }
}

export async function extractAllFlows(
  repoId: string,
  repoPath: string,
  scopes: ScopeEntry[],
  onProgress?: (current: number, total: number, scope: string) => void,
  onToken?: (token: string) => void,
): Promise<FlowExtractionResult[]> {
  const results: FlowExtractionResult[] = []

  for (let i = 0; i < scopes.length; i++) {
    onProgress?.(i + 1, scopes.length, scopes[i].scope)
    try {
      const result = await extractFlow(repoId, repoPath, scopes[i], i > 0, onToken)
      results.push(result)
    } catch (e) {
      console.error(`flow extraction failed for "${scopes[i].scope}": ${(e as Error).message}`)
    }
  }

  return results
}
