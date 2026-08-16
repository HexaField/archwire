import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import type { RepoInfo } from '@archwire/core'
import { getDataDir, ensureDataDir } from './config.ts'

const REPOS_FILE = () => path.join(getDataDir(), 'repos.json')

function loadRepos(): RepoInfo[] {
  try {
    return JSON.parse(readFileSync(REPOS_FILE(), 'utf8'))
  } catch {
    return []
  }
}

function saveRepos(repos: RepoInfo[]): void {
  ensureDataDir()
  writeFileSync(REPOS_FILE(), JSON.stringify(repos, null, 2) + '\n')
}

export function listRepos(): RepoInfo[] {
  return loadRepos()
}

export function getRepo(id: string): RepoInfo | undefined {
  return loadRepos().find(r => r.id === id)
}

export function repoDataDir(id: string): string {
  const dir = path.join(getDataDir(), 'repos', id)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function addLocalRepo(repoPath: string): RepoInfo {
  const abs = path.resolve(repoPath)
  if (!existsSync(path.join(abs, '.git'))) {
    throw new Error(`not a git repo: ${abs}`)
  }

  const repos = loadRepos()
  const existing = repos.find(r => r.path === abs)
  if (existing) return existing

  const name = path.basename(abs)
  const id = name + '-' + crypto.randomBytes(4).toString('hex')
  const info: RepoInfo = { id, name, path: abs, source: 'local' }
  repos.push(info)
  saveRepos(repos)
  return info
}

export function addGithubRepo(url: string): RepoInfo {
  // extract owner/repo from github URL
  const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/)
  if (!match) throw new Error(`invalid github URL: ${url}`)

  const slug = match[1]
  const name = slug.split('/')[1]
  const cloneDir = path.join(getDataDir(), 'clones', slug.replace('/', '-'))

  if (!existsSync(cloneDir)) {
    mkdirSync(path.dirname(cloneDir), { recursive: true })
    execSync(`git clone --depth 50 ${url} ${cloneDir}`, {
      stdio: 'pipe',
      timeout: 120_000,
    })
  } else {
    // pull latest
    try {
      execSync('git pull --ff-only', { cwd: cloneDir, stdio: 'pipe', timeout: 30_000 })
    } catch { /* ok if pull fails */ }
  }

  const repos = loadRepos()
  const existing = repos.find(r => r.path === cloneDir)
  if (existing) return existing

  const id = name + '-' + crypto.randomBytes(4).toString('hex')
  const info: RepoInfo = { id, name, path: cloneDir, source: 'github' }
  repos.push(info)
  saveRepos(repos)
  return info
}

export function removeRepo(id: string): boolean {
  const repos = loadRepos()
  const idx = repos.findIndex(r => r.id === id)
  if (idx < 0) return false
  repos.splice(idx, 1)
  saveRepos(repos)
  return true
}

/**
 * Auto-register the archwire monorepo itself as the default project
 * when the repos list sits empty (first run / fresh clone).
 */
export function seedSelf(): void {
  if (loadRepos().length > 0) return

  // walk up from this file to find the monorepo root (has package.json with name "archwire")
  let dir = path.resolve(import.meta.dirname ?? '.', '..', '..', '..')
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.name === 'archwire' && existsSync(path.join(dir, '.git'))) {
          const info = addLocalRepo(dir)
          console.log(`seeded self: ${info.name} (${dir})`)
          return
        }
      } catch { /* skip */ }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}
