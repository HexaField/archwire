import cors from 'cors'
import express from 'express'
import { ensureDataDir } from './lib/config.ts'
import healthRouter from './routes/health.ts'
import reposRouter from './routes/repos.ts'
import llmRouter from './routes/llm.ts'

ensureDataDir()

const app = express()
const port = parseInt(process.env.PORT ?? '3001')
const host = process.env.HOST ?? '0.0.0.0'

app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.use('/api/health', healthRouter)
app.use('/api/repos', reposRouter)
app.use('/api/llm', llmRouter)

app.listen(port, host, () => {
  console.log(`archwire server running at http://${host}:${port}`)
})
