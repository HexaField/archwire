// Auto-discover relevant source files from a repo for a given scope.
// Keyword-matches the scope description against file paths, then reads
// files up to a character budget.

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const STOP_WORDS = new Set([
  'a','an','the','and','or','of','to','in','on','at','by','for','from','into','with',
  'that','this','when','what','how','does','each','then','also','over','all','new',
])
const SOURCE_EXTS = ['.rs','.ts','.tsx','.js','.jsx','.graphql','.gql','.toml','.py']

interface SourceFile {
  path: string
  content: string
}

export function findRelevantFiles(targetPath: string, scopeText: string, budget: number): SourceFile[] {
  const keywords = scopeText.toLowerCase()
    .split(/[\s/._-]+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))

  let allFiles: string[]
  try {
    allFiles = execSync(
      `find . -type f \\( ${SOURCE_EXTS.map(e => `-name '*${e}'`).join(' -o ')} \\) ` +
      `-not -path '*/node_modules/*' -not -path '*/target/debug/*' -not -path '*/target/release/*' ` +
      `-not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*'`,
      { cwd: targetPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    ).trim().split('\n').filter(Boolean)
  } catch { return [] }

  const scored = allFiles.map(f => {
    const rel = f.replace(/^\.\//, '')
    const lower = rel.toLowerCase()
    let score = 0
    for (const kw of keywords) {
      for (const seg of lower.split(/[/._-]/)) {
        if (seg === kw) score += 5
        else if (seg.includes(kw)) score += 2
      }
      if (lower.includes(kw)) score += 1
    }
    return { absPath: path.join(targetPath, rel), rel, score }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score)

  return budgetFiles(
    scored.map(s => {
      try { return { path: s.rel, content: readFileSync(s.absPath, 'utf8') } }
      catch { return null }
    }).filter((f): f is SourceFile => f !== null),
    budget,
  )
}

export function readSpecificFiles(targetPath: string, filePaths: string[], budget: number): SourceFile[] {
  const raw = filePaths.map(f => {
    try { return { path: f, content: readFileSync(path.join(targetPath, f), 'utf8') } }
    catch { return null }
  }).filter((f): f is SourceFile => f !== null)

  return budgetFiles(raw, budget)
}

function budgetFiles(files: SourceFile[], budget: number): SourceFile[] {
  const result: SourceFile[] = []
  let chars = 0
  for (const f of files) {
    if (chars + f.content.length <= budget) {
      result.push(f)
      chars += f.content.length
    } else {
      const remaining = budget - chars
      if (remaining > 1000) {
        result.push({ path: f.path, content: f.content.slice(0, remaining) + '\n[... truncated ...]' })
      }
      break
    }
  }
  return result
}
