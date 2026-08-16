// API client for the archwire server.
// In dev, Vite proxies /api to localhost:3001.

import type {
  RepoInfo,
  LlmConfig,
  FlowModel,
  ConceptModel,
  CodeModel,
  ChangeModel,
  AskResponse,
} from '@archwire/core'

const BASE = '/api'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

// ── SSE consumer helper ──

async function consumeSSE(
  url: string,
  onProgress: (event: { phase: string; message: string; current?: number; total?: number; result?: unknown; results?: unknown[] }) => void,
): Promise<void> {
  const res = await fetch(`${BASE}${url}`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { onProgress(JSON.parse(line.slice(6))) } catch { /* malformed JSON */ }
      }
    }
  }
}

// ── repos ──

export const listRepos = () => json<RepoInfo[]>('/repos')

export const addRepo = (source: { path?: string; url?: string }) =>
  json<RepoInfo>('/repos', { method: 'POST', body: JSON.stringify(source) })

export const removeRepo = (id: string) =>
  json<{ ok: boolean }>(`/repos/${id}`, { method: 'DELETE' })

// ── data ──

export const getFlows = (repoId: string) =>
  json<FlowModel>(`/repos/${repoId}/flows`).catch(() => null)

export const getConcepts = (repoId: string) =>
  json<ConceptModel>(`/repos/${repoId}/concepts`).catch(() => null)

export const getCode = (repoId: string) =>
  json<CodeModel>(`/repos/${repoId}/code`).catch(() => null)

export const getChanges = (repoId: string) =>
  json<ChangeModel>(`/repos/${repoId}/changes`).catch(() => null)

export const getDiff = (repoId: string, slug: string) =>
  json<{ branch: string; base: string; files: Record<string, { original: string; modified: string }> }>(
    `/repos/${repoId}/diffs/${slug}`,
  ).catch(() => null)

// ── extraction (SSE) ──

export function extractConcepts(
  repoId: string,
  onProgress: (event: { phase: string; message: string; result?: unknown }) => void,
): Promise<void> {
  return consumeSSE(`/repos/${repoId}/extract/concepts`, onProgress)
}

export function extractFlows(
  repoId: string,
  onProgress: (event: { phase: string; message: string; current?: number; total?: number; results?: unknown[] }) => void,
): Promise<void> {
  return consumeSSE(`/repos/${repoId}/extract/flows`, onProgress)
}

export const extractBranches = (repoId: string, doFetch = false) =>
  json<{ branches: number; overlays: number; diffs: number }>(`/repos/${repoId}/extract/branches`, {
    method: 'POST',
    body: JSON.stringify({ fetch: doFetch }),
  })

// ── LLM ──

export const getLlmConfig = () => json<LlmConfig>('/llm/config')

export const setLlmConfig = (config: Partial<LlmConfig>) =>
  json<LlmConfig>('/llm/config', { method: 'PUT', body: JSON.stringify(config) })

export const getLlmModels = () =>
  json<{ models: string[] }>('/llm/models')

export const testLlm = () =>
  json<{ ok: boolean; models?: string[]; error?: string }>('/llm/test', {
    method: 'POST',
    body: JSON.stringify({}),
  })

export const askRepo = (repoId: string, question: string) =>
  json<AskResponse>(`/repos/${repoId}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
