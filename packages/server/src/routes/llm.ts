import { Router } from 'express'
import { loadConfig, saveConfig } from '../lib/config.ts'
import type { LlmConfig } from '@archwire/core'

const router = Router()

router.get('/config', (_req, res) => {
  res.json(loadConfig())
})

router.put('/config', (req, res) => {
  const config = req.body as Partial<LlmConfig>
  const current = loadConfig()
  const updated = { ...current, ...config }
  saveConfig(updated)
  res.json(updated)
})

// test endpoint connectivity
router.post('/test', async (req, res) => {
  const config = loadConfig()
  const url = (req.body as { llmUrl?: string }).llmUrl ?? config.llmUrl

  try {
    // try the models endpoint first (OpenAI-compatible)
    const modelsUrl = url.replace(/\/chat\/completions$/, '/models')
    const r = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      const data = await r.json() as { data?: { id: string }[] }
      const models = data.data?.map(m => m.id) ?? []
      return res.json({ ok: true, models })
    }
    res.json({ ok: false, error: `${r.status} ${r.statusText}` })
  } catch (e) {
    res.json({ ok: false, error: (e as Error).message })
  }
})

export default router
