export type {
  ConceptRelation,
  Concept,
  ThreadStep,
  Thread,
  ConceptModel,
  CodeNode,
  CodeModel,
  ChangeNode,
  ChangeLane,
  ChangeModel,
  CodeRef,
  FlowStep,
  FlowTransition,
  Flow,
  FlowDiffOverlay,
  FlowModel,
} from './types.ts'

// ── API types ──────────────────────────────────────────────────────────

export interface RepoInfo {
  id: string
  name: string
  path: string
  source: 'local' | 'github'
  extractedAt?: string
}

export interface LlmConfig {
  llmUrl: string
  model: string
  contextBudget: number
}

export interface ScopeEntry {
  scope: string
  files?: string[]
}

export interface ExtractionProgress {
  phase: string
  current: number
  total: number
  message: string
}

export interface AskRequest {
  question: string
  context?: 'flows' | 'concepts' | 'code' | 'all'
}

export interface AskResponse {
  answer: string
  sources: { path: string; line?: number }[]
}
