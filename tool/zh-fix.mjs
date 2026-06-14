#!/usr/bin/env node
// zh-fix.mjs (v3 - in-process autocorrect)
// 在 autocorrect 之上的薄包装层。
//
// 用法:
//   CLI 模式:   node zh-fix.mjs <file>
//   Hook 模式:  stdin 喂 Claude Code 的 PostToolUse JSON,提取 file_path
//
// v3 vs v2 关键变化:
//   - autocorrect 改为 in-process(import { formatFor } from 'autocorrect-node')
//   - 不再 spawn 子进程,无 shell 注入、无 PATH 劫持、无 cmd.exe 复杂度
//   - 不再读两次文件(autocorrect 处理 string,不碰磁盘)
//
// 安全原则:
//   - file_path 走 path.resolve + 白名单字符检查,避免 UNC/路径穿越
//   - 任何异常 → 日志 + exit 0,绝不阻塞 Claude
//   - 写文件用临时文件 + 原子改名,失败时清理 tmp
//   - 文件首行 <!-- zh-fix: off --> 静默退出
//   - 跑完写一行日志到 ~/.claude/zh-fix.log

import { readFileSync, writeFileSync, renameSync, lstatSync, unlinkSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { extname, dirname, basename, join, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { formatFor } from 'autocorrect-node'
import { computeMaskedText } from './mask.mjs'
import { applySemicolonRule } from './rules/semicolon.mjs'
import { applyBoundaryRule } from './rules/boundary.mjs'
import { applyCjkSurroundRule } from './rules/cjk-surround.mjs'

const MAX_FILE_SIZE = 100 * 1024 * 1024
const TIMEOUT_MS = 8000
const ALLOWED_EXTS = new Set(['.md', '.markdown', '.html', '.htm'])
const LOG_PATH = join(homedir(), '.claude', 'zh-fix.log')

// A4 修:全局兜底超时**永远挂上**(原代码只在 CLI 模式无参数时挂,逻辑反了
// —— hook 模式现在通过 CLI 调用,带参数,反而拿不到兜底)
{
  const t = setTimeout(() => {
    logLine('TIMEOUT (8s exceeded)')
    process.exit(0)
  }, TIMEOUT_MS)
  t.unref?.()
}

function logLine(msg) {
  try {
    const dir = dirname(LOG_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString()
    appendFileSync(LOG_PATH, `${stamp}  ${msg}\n`, 'utf-8')
  } catch {}
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

async function resolveFilePath() {
  const cliArg = process.argv[2]
  if (cliArg && !cliArg.startsWith('-')) return cliArg
  const stdinData = await readStdin()
  if (!stdinData) return null
  try {
    const payload = JSON.parse(stdinData)
    return payload?.tool_input?.file_path || payload?.tool_input?.path || null
  } catch {
    return null
  }
}

// 文件路径安全校验
function checkFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return { ok: false, reason: 'invalid-input' }
  if (filePath.includes('\x00')) return { ok: false, reason: 'null-byte' }
  if (/[<>"|&^`$]/.test(filePath)) return { ok: false, reason: 'shell-unsafe-chars' }
  if (/^(\\\\|\/\/)/.test(filePath)) return { ok: false, reason: 'unc-path' }
  if (!isAbsolute(filePath)) return { ok: false, reason: 'not-absolute' }

  const normalized = resolve(filePath)
  if (normalized !== resolve(normalized)) return { ok: false, reason: 'path-traversal' }

  const ext = extname(filePath).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) return { ok: false, reason: 'ext-skip' }

  let stat
  try { stat = lstatSync(filePath) } catch { return { ok: false, reason: 'not-found' } }
  if (stat.isSymbolicLink()) return { ok: false, reason: 'symlink' }
  if (!stat.isFile()) return { ok: false, reason: 'not-regular' }
  if (stat.size > MAX_FILE_SIZE) return { ok: false, reason: `too-large(${stat.size})` }

  return { ok: true, normalized }
}

// in-process autocorrect:接 string,返回 string
// A1+A2 修:autocorrect-node 在某些 edge 输入下可能返回 "" 或大幅缩短的内容
// 拒绝这两种情况,防止把用户原文件清空 / 截断
function runAutocorrect(filePath, text) {
  try {
    const result = formatFor(text, filePath)
    const out = typeof result === 'string'
      ? result
      : (result && typeof result.out === 'string' ? result.out : null)
    if (out === null) {
      if (result?.error) return { ok: false, reason: `ac-error: ${result.error}` }
      return { ok: false, reason: 'ac-unknown-result' }
    }
    // A1:非空输入不该返回空串
    if (out === '' && text !== '') {
      return { ok: false, reason: 'ac-returned-empty-on-nonempty-input' }
    }
    // A2:正文超过 100 字时,处理后长度不该跌到 50% 以下
    if (text.length > 100 && out.length < text.length * 0.5) {
      return { ok: false, reason: `ac-shrunk-suspicious(${text.length}→${out.length})` }
    }
    return { ok: true, text: out }
  } catch (e) {
    return { ok: false, reason: `ac-throw: ${e.message}` }
  }
}

function hasOptOut(text) {
  const head = text.slice(0, 200)
  return /<!--\s*zh-fix:\s*off\s*-->/.test(head) || /^\s*<!--\s*zh-fix\s+disabled\s*-->/m.test(head)
}

function applyPatches(text) {
  const masked = computeMaskedText(text)
  let t = text
  t = applySemicolonRule(t, masked)
  t = applyBoundaryRule(t, masked)
  t = applyCjkSurroundRule(t, masked)
  return t
}

function tmpName(filePath) {
  const rnd = Math.floor(Math.random() * 1e9).toString(36)
  return join(dirname(filePath), `.${basename(filePath)}.zh-fix.${rnd}.tmp`)
}

function atomicWrite(filePath, content) {
  // A1+A5 修:任何情况下都拒绝写空串(防止把用户原文件清空)
  if (content == null || content === '') {
    logLine(`WRITE_REFUSED ${filePath}: empty-content`)
    return false
  }
  const tmpPath = tmpName(filePath)
  try {
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, filePath)
    return true
  } catch (e) {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath) } catch {}
    }
    logLine(`WRITE_FAIL ${filePath}: ${e.message}`)
    return false
  }
}

async function main() {
  const filePathRaw = await resolveFilePath()
  if (!filePathRaw) process.exit(0)

  const check = checkFile(filePathRaw)
  if (!check.ok) {
    if (check.reason.startsWith('shell-unsafe') || check.reason === 'unc-path' || check.reason === 'null-byte' || check.reason === 'symlink') {
      logLine(`REJECT ${filePathRaw}: ${check.reason}`)
    }
    process.exit(0)
  }

  const filePath = check.normalized

  // 读文件
  let original
  try {
    original = readFileSync(filePath, 'utf-8')
  } catch {
    process.exit(0)
  }

  if (hasOptOut(original)) {
    logLine(`SKIP ${filePath}: opt-out`)
    process.exit(0)
  }

  // BOM 处理
  let hadBOM = false
  let text = original
  if (text.charCodeAt(0) === 0xFEFF) {
    hadBOM = true
    text = text.slice(1)
  }

  // autocorrect in-process
  const acRes = runAutocorrect(filePath, text)
  if (!acRes.ok) {
    logLine(`AC_FAIL ${filePath}: ${acRes.reason}`)
    process.exit(0)
  }
  const afterAc = acRes.text

  // 我们的补丁
  const patched = applyPatches(afterAc)

  // 最终内容(含/不含 BOM)
  const finalText = hadBOM ? '﻿' + patched : patched

  if (finalText === original) {
    // 完全没改 → 不写,不记
    process.exit(0)
  }

  // A2 修:最终长度大幅缩短 → 拒绝写,记日志让用户能发现
  if (original.length > 100 && finalText.length < original.length * 0.5) {
    logLine(`WRITE_REFUSED ${filePath}: final-shrunk-suspicious(${original.length}→${finalText.length})`)
    process.exit(0)
  }

  if (atomicWrite(filePath, finalText)) {
    // B4 修订:
    //  - autocorrect 改半→全角 + 加盘古空格会改长度,acDiffs 不能用索引比对
    //  - 我们的 patches 永远是单字符等长替换(`,` → `,` 等),patch_diffs 可以精确算
    //  - 显式输出 ac_changed/patch_changed 布尔位,避免 len_delta=0 误读为"没改"
    const acChanged = text !== afterAc
    const patchChanged = afterAc !== patched
    const acLenDelta = afterAc.length - text.length
    let patchDiffs = 0
    if (patchChanged && afterAc.length === patched.length) {
      for (let i = 0; i < afterAc.length; i++) {
        if (afterAc[i] !== patched[i]) patchDiffs++
      }
    }
    if (patchChanged) {
      logLine(`OK ${filePath}: ac_changed=${acChanged ? 'yes' : 'no'} patch_diffs=${patchDiffs} ac_len_delta=${acLenDelta}`)
    } else if (acChanged) {
      logLine(`AC_ONLY ${filePath}: changed=yes ac_len_delta=${acLenDelta}`)
    }
  }
  process.exit(0)
}

main().catch((e) => {
  logLine(`UNHANDLED: ${e.message}`)
  process.exit(0)
})
