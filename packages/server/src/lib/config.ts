import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { LlmConfig } from '@archwire/core'

const DATA_DIR = path.resolve(process.env.ARCHWIRE_DATA ?? './data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true })
}

export function getDataDir(): string {
  return DATA_DIR
}

const DEFAULT_CONFIG: LlmConfig = {
  llmUrl: 'http://localhost:11434/v1/chat/completions',
  model: '',
  contextBudget: 80000,
}

export function loadConfig(): LlmConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: LlmConfig): void {
  ensureDataDir()
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}
