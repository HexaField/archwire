// Branch scanner — finds branches that touch files referenced by flows,
// generates diff overlays and per-file diff content.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import type { FlowModel, FlowDiffOverlay } from '@archwire/core'
import { repoDataDir } from '../lib/repos.ts'

interface DiffFile {
  original: string
  modified: string
}

export interface BranchScanResult {
  branches: number
  overlays: number
  diffs: number
}

export function scanBranches(
  repoId: string,
  repoPath: string,
  fetch = false,
): BranchScanResult {
  const dataDir = repoDataDir(repoId)
  const flowsPath = path.join(dataDir, 'flows.json')

  if (!existsSync(flowsPath)) {
    throw new Error('no flows.json — extract flows first')
  }

  const flowData: FlowModel = JSON.parse(readFileSync(flowsPath, 'utf8'))
  const baseBranch = detectBaseBranch(repoPath)

  if (fetch) {
    try {
      execSync('git fetch --all --prune', { cwd: repoPath, stdio: 'pipe', timeout: 60_000 })
    } catch { /* ok */ }
  }

  // collect code refs from all flows
  const codeRefs: { path: string; stem: string; flowId: string; stepId: string }[] = []
  for (const flow of flowData.flows) {
    for (const step of flow.steps) {
      for (const ref of (step.codeRefs ?? [])) {
        const p = ref.path.replace(/^\.\//, '')
        const dot = p.lastIndexOf('.')
        const stem = dot > 0 ? p.slice(0, dot) : p
        codeRefs.push({ path: p, stem, flowId: flow.id, stepId: step.id })
      }
    }
  }

  // list all branches
  const branchLines = execSync('git branch -r --list "origin/*" --format "%(refname:short)"', {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  }).trim().split('\n').filter(Boolean)

  const branches = branchLines
    .map(b => b.replace(/^origin\//, ''))
    .filter(b => b !== baseBranch && b !== 'HEAD')

  const newOverlays: FlowDiffOverlay[] = []
  const diffsDir = path.join(dataDir, 'diffs')
  mkdirSync(diffsDir, { recursive: true })

  for (const branch of branches) {
    let mergeBase: string
    try {
      mergeBase = execSync(`git merge-base origin/${baseBranch} origin/${branch}`, {
        cwd: repoPath,
        encoding: 'utf8',
        timeout: 10_000,
      }).trim()
    } catch { continue }

    let changedFiles: string[]
    try {
      changedFiles = execSync(`git diff --name-only ${mergeBase}..origin/${branch}`, {
        cwd: repoPath,
        encoding: 'utf8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 10_000,
      }).trim().split('\n').filter(Boolean)
    } catch { continue }

    // match changed files against code refs (exact or stem prefix)
    const touchedRefs = codeRefs.filter(ref =>
      changedFiles.some(f => f === ref.path || f.startsWith(ref.stem + '/'))
    )

    if (!touchedRefs.length) continue

    // build diff overlay per affected flow
    const byFlow = new Map<string, typeof touchedRefs>()
    for (const ref of touchedRefs) {
      const arr = byFlow.get(ref.flowId) ?? []
      arr.push(ref)
      byFlow.set(ref.flowId, arr)
    }

    for (const [flowId, refs] of byFlow) {
      const stepStatus: Record<string, 'modified'> = {}
      for (const ref of refs) stepStatus[ref.stepId] = 'modified'

      newOverlays.push({
        flowId,
        diffSource: `branch: ${branch}`,
        stepStatus,
        transitionStatus: {},
        addedSteps: [],
        addedTransitions: [],
      })
    }

    // generate file-level diffs
    const matchedFiles = changedFiles.filter(f =>
      codeRefs.some(ref => f === ref.path || f.startsWith(ref.stem + '/'))
    )

    if (matchedFiles.length) {
      const slug = branch.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
      const diffData: Record<string, DiffFile> = {}

      for (const file of matchedFiles) {
        let original = ''
        let modified = ''
        try {
          original = execSync(`git show ${mergeBase}:${file}`, {
            cwd: repoPath,
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
          })
        } catch { /* new file */ }
        try {
          modified = execSync(`git show origin/${branch}:${file}`, {
            cwd: repoPath,
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
          })
        } catch { /* deleted file */ }

        diffData[file] = { original, modified }
      }

      writeFileSync(
        path.join(diffsDir, `${slug}.json`),
        JSON.stringify({ branch, base: baseBranch, files: diffData }),
      )
    }
  }

  // replace branch overlays in flows.json
  flowData.diffs = flowData.diffs.filter(d => !d.diffSource.startsWith('branch: '))
  flowData.diffs.push(...newOverlays)
  writeFileSync(flowsPath, JSON.stringify(flowData, null, 2))

  return {
    branches: branches.length,
    overlays: newOverlays.length,
    diffs: newOverlays.length,
  }
}

function detectBaseBranch(repoPath: string): string {
  try {
    const head = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim()
    return head.replace('refs/remotes/origin/', '')
  } catch {
    // fallback: check common names
    for (const name of ['main', 'master', 'dev', 'develop']) {
      try {
        execSync(`git rev-parse --verify origin/${name}`, { cwd: repoPath, stdio: 'pipe' })
        return name
      } catch { continue }
    }
    return 'main'
  }
}
