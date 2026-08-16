import { Router } from 'express'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import * as repos from '../lib/repos.ts'
import { extractAllFlows } from '../extract/flows.ts'
import { extractConcepts } from '../extract/concepts.ts'
import { scanBranches } from '../extract/branches.ts'
import { chat } from '../lib/llm.ts'
import type { ScopeEntry, ConceptModel } from '@archwire/core'

const router = Router()

// ── repo CRUD ──

router.get('/', (_req, res) => {
  res.json(repos.listRepos())
})

router.post('/', (req, res) => {
  const { path: repoPath, url } = req.body as { path?: string; url?: string }
  try {
    const info = url
      ? repos.addGithubRepo(url)
      : repos.addLocalRepo(repoPath ?? '')
    res.status(201).json(info)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

router.delete('/:id', (req, res) => {
  repos.removeRepo(req.params.id)
    ? res.json({ ok: true })
    : res.status(404).json({ error: 'not found' })
})

// ── data endpoints ──

function serveData(filename: string) {
  return (req: import('express').Request, res: import('express').Response) => {
    const repo = repos.getRepo(req.params.id as string)
    if (!repo) return res.status(404).json({ error: 'repo not found' })

    const filePath = path.join(repos.repoDataDir(repo.id), filename)
    if (!existsSync(filePath)) return res.status(404).json({ error: `${filename} not extracted yet` })

    res.json(JSON.parse(readFileSync(filePath, 'utf8')))
  }
}

router.get('/:id/flows', serveData('flows.json'))
router.get('/:id/concepts', serveData('concepts.json'))
router.get('/:id/code', serveData('code.json'))
router.get('/:id/changes', serveData('changes.json'))

router.get('/:id/diffs/:slug', (req, res) => {
  const repo = repos.getRepo(req.params.id)
  if (!repo) return res.status(404).json({ error: 'repo not found' })

  const filePath = path.join(repos.repoDataDir(repo.id), 'diffs', `${req.params.slug}.json`)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'diff not found' })

  res.json(JSON.parse(readFileSync(filePath, 'utf8')))
})

// ── extraction ──

router.post('/:id/extract/concepts', async (req, res) => {
  const repo = repos.getRepo(req.params.id)
  if (!repo) return res.status(404).json({ error: 'repo not found' })

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const result = await extractConcepts(repo.id, repo.path, (phase, message) => {
      if (phase === 'streaming') {
        // token chunk — send as a token event (client accumulates)
        send({ phase: 'token', token: message })
      } else {
        send({ phase, message })
      }
    })
    send({ phase: 'done', message: `Extracted ${result.concepts.length} concepts`, result })
  } catch (e) {
    send({ phase: 'error', message: (e as Error).message })
  } finally {
    res.end()
  }
})

router.post('/:id/extract/flows', async (req, res) => {
  const repo = repos.getRepo(req.params.id)
  if (!repo) return res.status(404).json({ error: 'repo not found' })

  const { scopes } = (req.body ?? {}) as { scopes?: ScopeEntry[] }
  if (!scopes?.length) {
    // no explicit scopes — we'll auto-generate them from concepts below, but
    // fail fast (plain JSON, not SSE) if there's nothing to derive them from
    const conceptsPath = path.join(repos.repoDataDir(repo.id), 'concepts.json')
    if (!existsSync(conceptsPath)) {
      return res.status(400).json({ error: 'extract concepts first, or provide scopes' })
    }
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // if no scopes provided, derive one per thread from the concept model
    let finalScopes = scopes
    if (!finalScopes?.length) {
      const concepts: ConceptModel = JSON.parse(
        readFileSync(path.join(repos.repoDataDir(repo.id), 'concepts.json'), 'utf8'),
      )
      finalScopes = concepts.threads.map(t => ({ scope: t.name }))
      if (!finalScopes.length) {
        // fall back to pillar concepts if there are no threads
        finalScopes = concepts.concepts.filter(c => c.pillar).map(c => ({ scope: c.name, files: c.implementedBy }))
      }
    }

    const results = await extractAllFlows(
      repo.id, repo.path, finalScopes,
      (current, total, scope) => {
        send({ phase: 'extracting', message: `Flow ${current}/${total}: ${scope}`, current, total })
      },
      (token) => {
        send({ phase: 'token', token })
      },
    )
    send({ phase: 'done', message: `Extracted ${results.length} flows`, results })
  } catch (e) {
    send({ phase: 'error', message: (e as Error).message })
  } finally {
    res.end()
  }
})

router.post('/:id/extract/branches', (req, res) => {
  const repo = repos.getRepo(req.params.id)
  if (!repo) return res.status(404).json({ error: 'repo not found' })

  try {
    const result = scanBranches(repo.id, repo.path, req.body?.fetch ?? false)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ── ask LLM about the repo ──

router.post('/:id/ask', async (req, res) => {
  const repo = repos.getRepo(req.params.id)
  if (!repo) return res.status(404).json({ error: 'repo not found' })

  const { question } = req.body as { question: string }
  if (!question) return res.status(400).json({ error: 'question required' })

  const dataDir = repos.repoDataDir(repo.id)

  // build context from extracted data
  let context = `Repository: ${repo.name} (${repo.path})\n\n`

  const flowsPath = path.join(dataDir, 'flows.json')
  if (existsSync(flowsPath)) {
    const flows = JSON.parse(readFileSync(flowsPath, 'utf8'))
    context += `FLOWS (${flows.flows.length} execution paths):\n`
    for (const f of flows.flows) {
      context += `- ${f.name}: ${f.steps.length} steps\n`
      for (const step of f.steps.slice(0, 5)) {
        context += `  [${step.kind}] ${step.label}${step.detail ? ' — ' + step.detail : ''}\n`
      }
      if (f.steps.length > 5) context += `  ... and ${f.steps.length - 5} more steps\n`
    }
    context += '\n'
  }

  const conceptsPath = path.join(dataDir, 'concepts.json')
  if (existsSync(conceptsPath)) {
    const concepts = JSON.parse(readFileSync(conceptsPath, 'utf8'))
    context += `CONCEPTS:\n`
    for (const c of concepts.concepts) {
      context += `- ${c.name}: ${c.summary}\n`
    }
    context += '\n'
  }

  try {
    const answer = await chat([
      {
        role: 'system',
        content: 'You are a helpful code architecture assistant. Answer questions about a codebase based on the extracted architecture data provided. Be concise and specific.',
      },
      { role: 'user', content: `${context}QUESTION: ${question}` },
    ], { temperature: 0.3 })
    res.json({ answer, sources: [] })
  } catch (e) {
    res.status(502).json({ error: `LLM request failed: ${(e as Error).message}` })
  }
})

export default router
