// install/hook-common.mjs
// hook 共享 utils:config 读取、paused 判定、stdin 读取、日志。
// pre-hook.mjs 用。

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const CONFIG_PATH = join(homedir(), '.zhfix', 'config.json')
export const LOG_PATH = join(homedir(), '.claude', 'zh-fix.log')

export function logLine(msg) {
  try {
    const dir = dirname(LOG_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(LOG_PATH, `${new Date().toISOString()}  ${msg}\n`, 'utf-8')
  } catch {}
}

export function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch (e) {
    logLine(`NO_CONFIG: ${e.message}`)
    return null
  }
}

// 读 stdin(Claude Code hook payload),200ms 兜底
export async function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    let resolved = false
    const done = () => { if (!resolved) { resolved = true; resolve(data) } }
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', done)
    process.stdin.on('error', done)
    setTimeout(done, 200)
  })
}

export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function isInPausedPath(filePath, pausedPaths) {
  if (!filePath || !Array.isArray(pausedPaths) || pausedPaths.length === 0) return false
  const f = normalizePath(filePath)
  return pausedPaths.some(p => {
    const pp = normalizePath(p)
    if (!pp) return false
    return f === pp || f.startsWith(pp + '/')
  })
}
