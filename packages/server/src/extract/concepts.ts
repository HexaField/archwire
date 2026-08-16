// Concept extraction — calls an LLM to produce the high-level concept model
// (domain concepts + cross-cutting threads) for a codebase, then grounds it
// against the real file tree to produce the code model (concept → code bridge).

import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import type { ConceptModel, CodeModel, CodeNode } from '@archwire/core'
import { readSpecificFiles } from './files.ts'
import { repoDataDir } from '../lib/repos.ts'
import { loadConfig } from '../lib/config.ts'
import { chat } from '../lib/llm.ts'

const SOURCE_EXTS = ['.rs', '.ts', '.tsx', '.js', '.jsx', '.graphql', '.gql', '.toml', '.py']
const EXCLUDE_PATTERNS = [
  '*/node_modules/*', '*/.git/*', '*/dist/*', '*/build/*',
  '*/target/debug/*', '*/target/release/*',
]

const SYSTEM_PROMPT = `You are a code architecture analyst. You produce a structured JSON "concept model" that documents the domain concepts inside a codebase, for onboarding new engineers.

Output ONLY valid JSON matching this schema — no markdown, no explanation:

{
  "system": string (short name of the system/repo),
  "summary": string (2-4 sentences: what this codebase does, in plain language),
  "concepts": [{
    "id": string (short, kebab-case, unique, e.g. "auth-session"),
    "name": string (human-readable name, e.g. "Auth Session"),
    "summary": string (1-3 sentences: what this concept is and why it exists),
    "layer": number (0 = primitive/foundational building block … each higher layer is built on top of lower-layer concepts),
    "pillar": boolean (true only for the handful of anchor concepts a newcomer MUST understand first),
    "parent": string | null (id of the concept this is a sub-part of, for drill-down hierarchy; null if top-level),
    "implementedBy": [string] (repo-relative file or directory paths that implement this concept — must be REAL paths taken from the file listing below, never invented),
    "relations": [{"to": string (another concept id), "label": string (short verb phrase, e.g. "contains", "depends on", "emits events to", "configures", "extends", "shares state with")}]
  }],
  "threads": [{
    "id": string (short, kebab-case, unique),
    "name": string (a user action or system process, e.g. "user submits a form"),
    "summary": string (1-2 sentences describing the end-to-end journey),
    "steps": [{
      "concept": string (a concept id this step passes through),
      "code": string (repo-relative "path" or "path:line" where this step happens),
      "note": string (one short sentence: what happens at this step)
    }]
  }]
}

Rules:
- Cover the codebase's MAJOR domain concepts — not every file, not every function. Aim for the concepts a senior engineer would draw on a whiteboard to explain the system to a new hire.
- Every concept id referenced anywhere (parent, relations[].to, threads[].steps[].concept) MUST exist in the concepts array. Never reference an id you did not define.
- Assign "layer" by dependency depth: layer 0 concepts are foundational primitives (core data models, base types, storage) that don't depend on other concepts here; each higher layer composes lower-layer concepts into something more capability-level. Most systems need 3-5 layers.
- Mark 3-8 concepts as "pillar": true. These are the essential anchors a newcomer needs first — not every concept qualifies.
- Use "parent" to build a breakdown hierarchy: a concept's parent is the broader concept it is a sub-part of. Top-level concepts have parent: null. Never create a cycle (a concept cannot be its own ancestor).
- "implementedBy" paths must come from the FILE LISTING provided below. Prefer a directory when a concept spans most/all files in that area; prefer specific files when a concept is narrowly implemented. Every concept needs at least one implementedBy path.
- "relations" describe how concepts connect to each other (data flow, dependency, composition, ownership, events) — use a precise verb phrase, never the generic "relates to".
- "threads" trace cross-cutting execution paths that pull multiple concepts together end-to-end (e.g. a request lifecycle, a user workflow, a build/CI run, a startup sequence). Each thread should visit 3+ DIFFERENT concepts across its steps, in the order they actually execute.
- Produce at least 8 concepts and at least 2 threads for any non-trivial codebase — more for larger ones. Scale coverage to the size of the codebase shown below.
- Every string field must be filled in with real content — no empty strings, no "TODO" or "N/A" placeholders.`

export async function extractConcepts(
  repoId: string,
  repoPath: string,
  onProgress?: (phase: string, message: string) => void,
): Promise<ConceptModel> {
  onProgress?.('scanning', 'Finding source files...')

  const repoName = path.basename(repoPath)
  const { contextBudget } = loadConfig()
  const allSourceFiles = listAllSourceFiles(repoPath)

  if (!allSourceFiles.length) {
    throw new Error(`no source files found in ${repoPath}`)
  }

  // Full path listing grounds implementedBy even for files whose content
  // doesn't fit the context budget — budget it separately from file content.
  let pathListing = allSourceFiles.join('\n')
  const maxListingChars = Math.min(20000, Math.floor(contextBudget * 0.3))
  if (pathListing.length > maxListingChars) {
    const cut = pathListing.slice(0, maxListingChars)
    pathListing = cut.slice(0, cut.lastIndexOf('\n')) + '\n... (truncated — more files exist)'
  }

  const remainingBudget = Math.max(contextBudget - pathListing.length, 4000)
  const files = readSpecificFiles(repoPath, allSourceFiles, remainingBudget)

  let sourceContext = ''
  for (const f of files) {
    sourceContext += `--- ${f.path} ---\n${f.content}\n--- end ---\n\n`
  }

  const userPrompt =
    `Analyze this codebase and generate a concept model.\n\n` +
    `Repository: ${repoName}\n\n` +
    `FILE LISTING (${allSourceFiles.length} source files total — implementedBy paths must come from this list):\n${pathListing}\n\n` +
    `SOURCE CODE (as much as fits the context budget):\n\n${sourceContext}` +
    `Generate the concept model JSON now.`

  onProgress?.('analyzing', 'Sending to LLM...')
  const content = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.1 },
  )

  // parse JSON from response
  let jsonStr = content
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) jsonStr = fenceMatch[1]

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr.trim())
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${(e as Error).message}`)
  }

  const conceptModel = normalizeConceptModel(parsed, repoName)

  const dataDir = repoDataDir(repoId)
  writeFileSync(path.join(dataDir, 'concepts.json'), JSON.stringify(conceptModel, null, 2))

  onProgress?.('mapping', 'Mapping concepts to code...')
  const codeModel = buildCodeModel(repoPath, repoName, conceptModel)
  writeFileSync(path.join(dataDir, 'code.json'), JSON.stringify(codeModel, null, 2))

  onProgress?.('done', 'Concepts extracted')
  return conceptModel
}

function normalizeConceptModel(raw: unknown, repoName: string): ConceptModel {
  const cm = raw as Partial<ConceptModel> | null
  if (!cm || !Array.isArray(cm.concepts)) {
    throw new Error('Invalid concept data: missing "concepts" array')
  }
  return {
    system: cm.system || repoName,
    summary: cm.summary || '',
    concepts: cm.concepts,
    threads: Array.isArray(cm.threads) ? cm.threads : [],
  }
}

// ── file discovery (mirrors extract/files.ts, but lists everything rather
// than keyword-scoring a scope — concept extraction needs full coverage) ──

function excludeArgs(): string {
  return EXCLUDE_PATTERNS.map(p => `-not -path '${p}'`).join(' ')
}

function listAllSourceFiles(repoPath: string): string[] {
  try {
    return execSync(
      `find . -type f \\( ${SOURCE_EXTS.map(e => `-name '*${e}'`).join(' -o ')} \\) ${excludeArgs()}`,
      { cwd: repoPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    ).trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''))
  } catch {
    return []
  }
}

function listAllFiles(repoPath: string): string[] {
  try {
    return execSync(
      `find . -type f ${excludeArgs()}`,
      { cwd: repoPath, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    ).trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''))
  } catch {
    return []
  }
}

// ── code model: ground each concept's implementedBy paths in the real file
// tree (not via LLM) so the UI can drill down from a concept to real files ──

function buildCodeModel(repoPath: string, repoName: string, conceptModel: ConceptModel): CodeModel {
  const allFiles = listAllFiles(repoPath)
  const allFilesSet = new Set(allFiles)
  const nodesById = new Map<string, CodeNode>()

  for (const concept of conceptModel.concepts) {
    for (const rawPath of concept.implementedBy ?? []) {
      const relPath = rawPath.replace(/^\.\/+/, '').replace(/\/+$/, '')
      if (!relPath || relPath === '.') continue

      const isFile = allFilesSet.has(relPath)
      const matches = isFile ? [relPath] : allFiles.filter(f => f === relPath || f.startsWith(`${relPath}/`))
      if (!matches.length) continue // LLM hallucinated a path that doesn't exist — skip it

      const topId = `code:${relPath}`
      let topNode = nodesById.get(topId)
      if (!topNode) {
        topNode = {
          id: topId,
          path: relPath,
          label: path.basename(relPath) || relPath,
          kind: isFile ? 'file' : 'dir',
          parent: null,
        }
        nodesById.set(topId, topNode)
      }
      if (!topNode.concept) topNode.concept = concept.id

      if (!isFile) {
        for (const f of matches) addDescendant(nodesById, relPath, topId, f)
      }
    }
  }

  return { target: repoName, nodes: [...nodesById.values()] }
}

// Adds the intermediate dir nodes + leaf file node for `filePath`, hanging
// off the concept's top node (`rootId`), relative to `rootPath`.
function addDescendant(nodesById: Map<string, CodeNode>, rootPath: string, rootId: string, filePath: string): void {
  if (filePath === rootPath) return

  const relFromRoot = filePath.slice(rootPath.length + 1)
  const segments = relFromRoot.split('/')
  let curPath = rootPath
  let curId = rootId
  for (let i = 0; i < segments.length; i++) {
    curPath = `${curPath}/${segments[i]}`
    const id = `code:${curPath}`
    const isLeaf = i === segments.length - 1
    if (!nodesById.has(id)) {
      nodesById.set(id, {
        id,
        path: curPath,
        label: segments[i],
        kind: isLeaf ? 'file' : 'dir',
        parent: curId,
      })
    }
    curId = id
  }
}
