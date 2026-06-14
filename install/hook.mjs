#!/usr/bin/env node
// install/hook.mjs (source) → 装到 ~/.zhfix/hook.mjs
// PostToolUse hook 路由层:读 config 找 tool_root,检查 paused_paths,转发到 zh-fix.mjs
// 任何异常 → log + exit 0(永不阻塞 Claude)

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_PATH = join(homedir(), '.zhfix', 'config.json')
const LOG_PATH = join(homedir(), '.claude', 'zh-fix.log')
const HOOK_TIMEOUT_MS = 10000

setTimeout(() => process.exit(0), HOOK_TIMEOUT_MS).unref?.()

function logLine(msg) {
  try {
    const dir = dirname(LOG_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(LOG_PATH, `${new Date().toISOString()}  ${msg}\n`, 'utf-8')
  } catch {}
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch (e) {
    logLine(`NO_CONFIG: ${e.message}`)
    return null
  }
}

async function readStdin() {
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

function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isInPausedPath(filePath, pausedPaths) {
  if (!Array.isArray(pausedPaths) || pausedPaths.length === 0) return false
  const f = normalizePath(filePath)
  return pausedPaths.some(p => {
    const pp = normalizePath(p)
    if (!pp) return false
    return f === pp || f.startsWith(pp + '/')
  })
}

async function main() {
  const config = readConfig()
  if (!config?.tool_root) process.exit(0)

  const toolPath = join(config.tool_root, 'zh-fix.mjs')
  if (!existsSync(toolPath)) {
    logLine(`TOOL_MISSING ${toolPath}`)
    process.exit(0)
  }

  const stdinData = await readStdin()
  if (!stdinData) process.exit(0)

  let filePath
  try {
    const payload = JSON.parse(stdinData)
    filePath = payload?.tool_input?.file_path || payload?.tool_input?.path || null
  } catch {
    process.exit(0)
  }

  if (!filePath) process.exit(0)

  if (isInPausedPath(filePath, config.paused_paths)) {
    logLine(`PAUSED ${filePath}`)
    process.exit(0)
  }

  spawnSync('node', [toolPath, filePath], {
    stdio: 'ignore',
    timeout: 8000,
    windowsHide: true,
    shell: false,
  })

  process.exit(0)
}

main().catch((e) => {
  logLine(`HOOK_UNHANDLED: ${e.message}`)
  process.exit(0)
})
