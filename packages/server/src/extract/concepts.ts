// Concept extraction — calls an LLM in two phases to produce the high-level
// concept model (domain concepts, then cross-cutting threads) for a codebase,
// then grounds it against the real file tree to produce the code model.

import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import type { ConceptModel, CodeModel, CodeNode } from '@archwire/core'
import { readSpecificFiles } from './files.ts'
import { repoDataDir } from '../lib/repos.ts'
import { loadConfig } from '../lib/config.ts'
import { chat, extractJson } from '../lib/llm.ts'

const SOURCE_EXTS = ['.rs', '.ts', '.tsx', '.js', '.jsx', '.graphql', '.gql', '.toml', '.py']
const EXCLUDE_PATTERNS = [
  '*/node_modules/*', '*/.git/*', '*/dist/*', '*/build/*',
  '*/target/debug/*', '*/target/release/*',
]

// ── Phase 1: extract concepts ──────────────────────────────────────────

const CONCEPTS_PROMPT = `You are a code architecture analyst. Produce a JSON object listing the major domain concepts inside a codebase — the things a senior engineer would draw on a whiteboard to explain the system.

Output ONLY valid JSON — no markdown fences, no prose. Schema:

{
  "system": string (short name of the system),
  "summary": string (2-4 sentences: what this codebase does),
  "concepts": [{
    "id": string (short kebab-case, unique),
    "name": string (human-readable),
    "summary": string (1-2 sentences),
    "layer": number (0 = primitive … higher = composite),
    "pillar": boolean (true for 3-8 anchor concepts a newcomer must grasp first),
    "parent": string | null (id of the broader concept this belongs to; null if top-level),
    "implementedBy": [string] (repo-relative paths from the FILE LISTING — never invent paths),
    "relations": [{"to": string (concept id), "label": string (verb phrase)}]
  }]
}

Rules:
- Cover 8-20 major concepts — not every file or function.
- Every id referenced in parent or relations[].to MUST exist in the concepts array.
- Layer 0 = foundational (data models, base types). Higher layers compose lower layers.
- implementedBy paths MUST come from the file listing provided. Prefer directories when a concept spans many files; prefer specific files when narrowly implemented.
- relations labels: use precise verbs ("depends on", "emits events to", "configures") — never generic "relates to".
- Do NOT include a "threads" field — that comes in a separate pass.`

// ── Phase 2: extract threads ───────────────────────────────────────────

const THREADS_PROMPT = `You are a code architecture analyst. Given a list of concepts for a codebase, produce cross-cutting "threads" — end-to-end execution traces that show how a user action or system process pulls multiple concepts together.

Output ONLY valid JSON — no markdown fences, no prose. Schema:

{
  "threads": [{
    "id": string (short kebab-case, unique),
    "name": string (a user action or system process),
    "summary": string (1-2 sentences),
    "steps": [{
      "concept": string (a concept id from the list below),
      "code": string (repo-relative "path" or "path:line"),
      "note": string (one sentence: what happens at this step)
    }]
  }]
}

Rules:
- Each thread should visit 3+ different concepts in execution order.
- Produce 2-5 threads covering the most important user workflows or system processes.
- Every concept id in steps MUST exist in the concept list below.
- Keep it focused — quality over quantity.`

export async function extractConcepts(
  repoId: string,
  repoPath: string,
  onProgress?: (phase: string, message: string) => void,
): Promise<ConceptModel> {
  onProgress?.('scanning', 'Finding source files…')

  const repoName = path.basename(repoPath)
  const { contextBudget } = loadConfig()
  const allSourceFiles = listAllSourceFiles(repoPath)

  if (!allSourceFiles.length) {
    throw new Error(`no source files found in ${repoPath}`)
  }

  // file listing for implementedBy grounding
  let pathListing = allSourceFiles.join('\n')
  const maxListingChars = Math.min(20000, Math.floor(contextBudget * 0.3))
  if (pathListing.length > maxListingChars) {
    const cut = pathListing.slice(0, maxListingChars)
    pathListing = cut.slice(0, cut.lastIndexOf('\n')) + '\n… (truncated)'
  }

  const remainingBudget = Math.max(contextBudget - pathListing.length, 4000)
  const files = readSpecificFiles(repoPath, allSourceFiles, remainingBudget)

  let sourceContext = ''
  for (const f of files) {
    sourceContext += `--- ${f.path} ---\n${f.content}\n--- end ---\n\n`
  }

  // ── Phase 1: concepts ──

  onProgress?.('concepts', 'Extracting concepts…')

  const conceptsUserPrompt =
    `Repository: ${repoName}\n\n` +
    `FILE LISTING (${allSourceFiles.length} files — implementedBy must use these paths):\n${pathListing}\n\n` +
    `SOURCE CODE:\n\n${sourceContext}` +
    `Generate the concept model JSON.`

  const conceptsRaw = await chat(
    [{ role: 'system', content: CONCEPTS_PROMPT }, { role: 'user', content: conceptsUserPrompt }],
    { temperature: 0.1, numPredict: 8192, onToken: t => onProgress?.('streaming', t) },
  )

  let parsed: any
  try {
    parsed = JSON.parse(extractJson(conceptsRaw))
  } catch (e) {
    throw new Error(`concept extraction failed: ${(e as Error).message}`)
  }

  if (!Array.isArray(parsed.concepts) || parsed.concepts.length === 0) {
    throw new Error('LLM returned no concepts')
  }

  const conceptModel: ConceptModel = {
    system: parsed.system || repoName,
    summary: parsed.summary || '',
    concepts: parsed.concepts,
    threads: [],
  }

  // ── Phase 2: threads ──

  onProgress?.('threads', 'Generating threads…')

  const conceptSummary = conceptModel.concepts
    .map(c => `- ${c.id}: ${c.name} (layer ${c.layer}) — ${c.summary}`)
    .join('\n')

  const threadsUserPrompt =
    `Repository: ${repoName}\n\n` +
    `CONCEPTS:\n${conceptSummary}\n\n` +
    `Generate the threads JSON.`

  const threadsRaw = await chat(
    [{ role: 'system', content: THREADS_PROMPT }, { role: 'user', content: threadsUserPrompt }],
    { temperature: 0.1, numPredict: 4096, onToken: t => onProgress?.('streaming', t) },
  )

  try {
    const threadsParsed = JSON.parse(extractJson(threadsRaw))
    if (Array.isArray(threadsParsed.threads)) {
      // filter to only reference known concept ids
      const knownIds = new Set(conceptModel.concepts.map(c => c.id))
      conceptModel.threads = threadsParsed.threads.filter((t: any) =>
        Array.isArray(t.steps) && t.steps.every((s: any) => knownIds.has(s.concept)),
      )
    }
  } catch {
    // threads are non-critical — proceed without them
    onProgress?.('threads', 'Thread extraction failed — continuing without threads')
  }

  // ── Write results ──

  const dataDir = repoDataDir(repoId)
  writeFileSync(path.join(dataDir, 'concepts.json'), JSON.stringify(conceptModel, null, 2))

  onProgress?.('mapping', 'Mapping concepts to code…')
  const codeModel = buildCodeModel(repoPath, repoName, conceptModel)
  writeFileSync(path.join(dataDir, 'code.json'), JSON.stringify(codeModel, null, 2))

  onProgress?.('done', `Extracted ${conceptModel.concepts.length} concepts, ${conceptModel.threads.length} threads`)
  return conceptModel
}

// ── file discovery ─────────────────────────────────────────────────────

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

// ── code model: ground concepts in the real file tree ──────────────────

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
      if (!matches.length) continue

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
