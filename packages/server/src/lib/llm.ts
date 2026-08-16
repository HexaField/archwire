// Thin wrapper around the Ollama JS SDK. Reads connection config from
// lib/config.ts so callers never have to thread a client/config through.

import { Ollama } from 'ollama'
import { loadConfig } from './config.ts'

export function getClient(): Ollama {
  const config = loadConfig()
  return new Ollama({ host: config.host })
}

export async function listModels(): Promise<string[]> {
  const client = getClient()
  const response = await client.list()
  return response.models.map(m => m.name)
}

export async function chat(
  messages: { role: string; content: string }[],
  options?: { temperature?: number; model?: string },
): Promise<string> {
  const config = loadConfig()
  const client = getClient()
  const model = options?.model ?? config.model
  if (!model) throw new Error('no model configured — set one via /api/llm/config')
  const response = await client.chat({
    model,
    messages: messages as any,
    options: { temperature: options?.temperature ?? 0.1 },
  })
  return response.message.content
}
