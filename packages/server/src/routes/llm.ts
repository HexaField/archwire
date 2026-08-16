import { Router } from 'express'
import { loadConfig, saveConfig } from '../lib/config.ts'
import { listModels } from '../lib/llm.ts'
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

// list models available on the configured Ollama host
router.get('/models', async (_req, res) => {
  try {
    const models = await listModels()
    res.json({ models })
  } catch (e) {
    res.status(502).json({ error: (e as Error).message })
  }
})

// test connectivity to the configured Ollama host
router.post('/test', async (_req, res) => {
  try {
    const models = await listModels()
    res.json({ ok: true, models })
  } catch (e) {
    res.json({ ok: false, error: (e as Error).message })
  }
})

export default router
