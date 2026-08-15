import { Router } from 'express'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import * as repos from '../lib/repos.ts'
import { loadConfig } from '../lib/config.ts'
import { extractAllFlows } from '../extract/flows.ts'
import { scanBranches } from '../extract/branches.ts'
import type { ScopeEntry } from '@archwire/core'

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

router.post('/:id/extract/flows', async (req, res) => {
  const repo = repos.getRepo(req.params.id)
  if (!repo) return res.status(404).json({ error: 'repo not found' })

  const { scopes } = req.body as { scopes: ScopeEntry[] }
  if (!scopes?.length) return res.status(400).json({ error: 'scopes required' })

  const config = loadConfig()
  try {
    const results = await extractAllFlows(repo.id, repo.path, scopes, config)
    res.json({ results, total: results.length })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
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

  const config = loadConfig()
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
    const llmRes = await fetch(config.llmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'You are a helpful code architecture assistant. Answer questions about a codebase based on the extracted architecture data provided. Be concise and specific.',
          },
          { role: 'user', content: `${context}QUESTION: ${question}` },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        ...(config.model ? { model: config.model } : {}),
      }),
    })

    if (!llmRes.ok) {
      const text = await llmRes.text()
      return res.status(502).json({ error: `LLM error: ${text}` })
    }

    const data = await llmRes.json() as { choices?: { message?: { content?: string } }[] }
    const answer = data.choices?.[0]?.message?.content ?? 'No response from LLM'

    res.json({ answer, sources: [] })
  } catch (e) {
    res.status(502).json({ error: `LLM request failed: ${(e as Error).message}` })
  }
})

export default router
