// API client for the archwire server.
// In dev, Vite proxies /api to localhost:3001.

import type {
  RepoInfo,
  LlmConfig,
  FlowModel,
  ConceptModel,
  CodeModel,
  ChangeModel,
  ScopeEntry,
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

// ── extraction ──

export const extractFlows = (repoId: string, scopes: ScopeEntry[]) =>
  json<{ results: unknown[]; total: number }>(`/repos/${repoId}/extract/flows`, {
    method: 'POST',
    body: JSON.stringify({ scopes }),
  })

export const extractBranches = (repoId: string, doFetch = false) =>
  json<{ branches: number; overlays: number }>(`/repos/${repoId}/extract/branches`, {
    method: 'POST',
    body: JSON.stringify({ fetch: doFetch }),
  })

// ── LLM ──

export const getLlmConfig = () => json<LlmConfig>('/llm/config')

export const setLlmConfig = (config: Partial<LlmConfig>) =>
  json<LlmConfig>('/llm/config', { method: 'PUT', body: JSON.stringify(config) })

export const testLlm = (llmUrl?: string) =>
  json<{ ok: boolean; models?: string[]; error?: string }>('/llm/test', {
    method: 'POST',
    body: JSON.stringify({ llmUrl }),
  })

export const askRepo = (repoId: string, question: string) =>
  json<AskResponse>(`/repos/${repoId}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
