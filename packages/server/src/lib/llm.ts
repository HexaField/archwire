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

export interface ChatOptions {
  temperature?: number
  model?: string
  numPredict?: number
  onToken?: (token: string) => void
}

/**
 * Chat with the configured Ollama model. When onToken is provided, streams
 * the response token-by-token and calls onToken for each chunk.
 */
export async function chat(
  messages: { role: string; content: string }[],
  options?: ChatOptions,
): Promise<string> {
  const config = loadConfig()
  const client = getClient()
  const model = options?.model ?? config.model
  if (!model) throw new Error('no model configured — set one via /api/llm/config')

  if (options?.onToken) {
    // streaming mode
    const stream = await client.chat({
      model,
      messages: messages as any,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.1,
        num_predict: options.numPredict ?? 16384,
      },
    })
    let full = ''
    for await (const chunk of stream) {
      const token = chunk.message.content
      full += token
      options.onToken(token)
    }
    return full
  }

  // non-streaming mode
  const response = await client.chat({
    model,
    messages: messages as any,
    options: {
      temperature: options?.temperature ?? 0.1,
      num_predict: options?.numPredict ?? 16384,
    },
  })
  return response.message.content
}

/**
 * Try to extract valid JSON from an LLM response. Handles markdown fences,
 * leading prose, and truncated output (closes open strings/arrays/objects).
 */
export function extractJson(raw: string): string {
  let s = raw

  // strip markdown fence
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/)
  if (fence) s = fence[1]

  // find the first { or [
  const start = s.search(/[{[]/)
  if (start < 0) throw new Error('no JSON object or array found in LLM response')
  s = s.slice(start).trim()

  // try parsing as-is first
  try { JSON.parse(s); return s } catch { /* needs repair */ }

  // truncation repair: close open strings, arrays, objects
  let inString = false
  let escape = false
  const stack: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') stack.pop()
  }

  // close what's open
  if (inString) s += '"'
  // trim trailing comma or colon (incomplete key-value)
  s = s.replace(/,\s*$/, '').replace(/:\s*$/, ': null')
  while (stack.length) s += stack.pop()

  // validate the repair
  try { JSON.parse(s); return s } catch (e) {
    throw new Error(`failed to repair truncated JSON: ${(e as Error).message}`)
  }
}
