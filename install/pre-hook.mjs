#!/usr/bin/env node
// install/pre-hook.mjs — PreToolUse hook(0.2.0+)
//
// 在 Claude 写盘**前**改写 tool_input:让"Claude 写下去的 = 磁盘最终内容 =
// 模型 context 可见的 updatedInput attachment",消掉 PostToolUse 的 Re-Read reminder 链路。
//
// 适配工具:Write / Edit / MultiEdit / NotebookEdit。
// Edit/MultiEdit 用"marker 法":把模型给的 new_string 用私用区字符圈起来,嵌进
// 内存里拼出的"假想最终文件"整文跑 zh-fix 管道,再取 marker 之间内容做新 new_string。
//
// 协议:
//   stdin:Claude Code PreToolUse payload(JSON, 含 tool_name / tool_input)
//   stdout:{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"
//                                 (,"updatedInput":{...})?}}
//
// 出错放行:任何异常 → 输出 allow 不带 updatedInput,绝不阻塞 Claude。

import { readFileSync, lstatSync } from 'node:fs'
import { extname } from 'node:path'
import {
  applyPipeline,
  hasOptOut,
  MAX_FILE_SIZE,
  ALLOWED_EXTS,
} from '../tool/zh-fix.mjs'
import {
  readConfig,
  readStdin,
  isInPausedPath,
  logLine,
} from './hook-common.mjs'

const SOFT_TIMEOUT_MS = 1500   // 用户感知缓冲,超过就放行不改写
const HARD_TIMEOUT_MS = 8000   // 兜底,绝不卡死

// Marker 用 CJK Extension A 区段(U+3400-4DBF),全是稀有汉字,普通中文文档基本不会出现;
// 同时 \p{Script=Han} 视为 CJK —— 让"句末.<marker>" 能触发 autocorrect 的中文句末判定。
// (私用区 PUA 字符不算 CJK,会破坏边界判定,不能用 —— 实测漏改句末标点。)
// 单 Edit 用 SINGLE_OPEN/CLOSE;MultiEdit 第 i 条用 MULTI_OPEN(i)/MULTI_CLOSE(i),i ∈ [0,255]
const SINGLE_OPEN  = String.fromCharCode(0x3400, 0x3400)             // "㐀㐀"
const SINGLE_CLOSE = String.fromCharCode(0x3401, 0x3401)             // "㐁㐁"
const MULTI_OPEN   = (i) => String.fromCharCode(0x3402, 0x3400 + (i & 0xFF))   // "㐂?"
const MULTI_CLOSE  = (i) => String.fromCharCode(0x3403, 0x3400 + (i & 0xFF))   // "㐃?"

// ---------------------------------------------------------------------------
// 协议输出
// ---------------------------------------------------------------------------
function emit(updatedInput) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      ...(updatedInput ? { updatedInput } : {}),
    },
  }
  process.stdout.write(JSON.stringify(out))
}

// ---------------------------------------------------------------------------
// 公共守卫:扩展名白名单 / 文件大小 / pause / opt-out
// ---------------------------------------------------------------------------

function extAllowed(filePath) {
  return typeof filePath === 'string' && ALLOWED_EXTS.has(extname(filePath).toLowerCase())
}

// 读现磁盘原文。任一失败 → null;同步 + 大小预检
function readDiskFile(filePath) {
  try {
    const st = lstatSync(filePath)
    if (!st.isFile()) return null
    if (st.size > MAX_FILE_SIZE) return null
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 字符串工具:模拟 Edit 工具的 old → new 语义(精确字面匹配,不是 regex)
// 注意:replace_all=false 是"精确匹配 1 次",且 Edit 工具要求该匹配是文件中唯一一次 —
// 我们这里宽松处理:就替换第一次出现。模型给的 old_string 在原文里若不止一次,
// Edit 工具本来就会报错,我们放行即可(返回 null 不改写)。
function applyEditOnce(text, oldStr, newStr) {
  const idx = text.indexOf(oldStr)
  if (idx < 0) return null
  return text.slice(0, idx) + newStr + text.slice(idx + oldStr.length)
}

function applyEditAll(text, oldStr, newStr) {
  if (oldStr === '') return null
  if (!text.includes(oldStr)) return null
  return text.split(oldStr).join(newStr)
}

function applyEdit(text, edit) {
  return edit.replace_all
    ? applyEditAll(text, edit.old_string, edit.new_string)
    : applyEditOnce(text, edit.old_string, edit.new_string)
}

// 在 text 里把 edit 的 new_string 用 marker 包起来后再 apply。
// 返回 { text, ok };ok=false 表示 old_string 没匹配
function applyEditWithMarkers(text, edit, openMark, closeMark) {
  const wrapped = { ...edit, new_string: openMark + edit.new_string + closeMark }
  const out = applyEdit(text, wrapped)
  return { text: out, ok: out !== null }
}

// 在 fixed 里取 [openMark, closeMark] 之间的内容
function extractBetween(fixed, openMark, closeMark) {
  const a = fixed.indexOf(openMark)
  if (a < 0) return null
  const b = fixed.indexOf(closeMark, a + openMark.length)
  if (b < 0) return null
  return fixed.slice(a + openMark.length, b)
}

// ---------------------------------------------------------------------------
// 四个 handler
// ---------------------------------------------------------------------------

function handleWrite(input, config) {
  const { file_path, content } = input
  if (typeof file_path !== 'string' || typeof content !== 'string') return null
  if (!extAllowed(file_path)) return null
  if (isInPausedPath(file_path, config.paused_paths)) {
    logLine(`PRE_SKIP Write ${file_path}: paused`); return null
  }
  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
    logLine(`PRE_SKIP Write ${file_path}: too-large`); return null
  }
  if (hasOptOut(content)) {
    logLine(`PRE_SKIP Write ${file_path}: opt-out`); return null
  }
  const fixed = applyPipeline(file_path, content)
  if (fixed === content) {
    logLine(`PRE_SKIP Write ${file_path}: no-change`); return null
  }
  logLine(`PRE_OK Write ${file_path} len_delta=${fixed.length - content.length}`)
  return { ...input, content: fixed }
}

function handleEdit(input, config) {
  const { file_path, old_string, new_string } = input
  if (typeof file_path !== 'string' || typeof old_string !== 'string' || typeof new_string !== 'string') return null
  if (!extAllowed(file_path)) return null
  if (isInPausedPath(file_path, config.paused_paths)) {
    logLine(`PRE_SKIP Edit ${file_path}: paused`); return null
  }
  const original = readDiskFile(file_path)
  if (original === null) {
    logLine(`PRE_SKIP Edit ${file_path}: no-disk-file-or-too-large`); return null
  }
  if (hasOptOut(original)) {
    logLine(`PRE_SKIP Edit ${file_path}: opt-out`); return null
  }
  // 拼"假想最终文件":把 new_string 用 marker 圈起来后 apply
  const wrap = applyEditWithMarkers(original, input, SINGLE_OPEN, SINGLE_CLOSE)
  if (!wrap.ok) {
    // old_string 没匹配 → 不改写,Edit 工具自己会报错
    logLine(`PRE_SKIP Edit ${file_path}: old-no-match`); return null
  }
  const fixed = applyPipeline(file_path, wrap.text)
  const newNew = extractBetween(fixed, SINGLE_OPEN, SINGLE_CLOSE)
  if (newNew === null) {
    logLine(`PRE_FAIL Edit ${file_path}: marker-not-found`); return null
  }
  if (newNew === new_string) {
    logLine(`PRE_SKIP Edit ${file_path}: no-change`); return null
  }
  logLine(`PRE_OK Edit ${file_path} new_string_len=${new_string.length}->${newNew.length}`)
  return { ...input, new_string: newNew }
}

function handleMultiEdit(input, config) {
  const { file_path, edits } = input
  if (typeof file_path !== 'string' || !Array.isArray(edits) || edits.length === 0) return null
  if (!extAllowed(file_path)) return null
  if (isInPausedPath(file_path, config.paused_paths)) {
    logLine(`PRE_SKIP MultiEdit ${file_path}: paused`); return null
  }
  if (edits.length > 256) {
    logLine(`PRE_SKIP MultiEdit ${file_path}: too-many-edits (${edits.length})`); return null
  }
  const original = readDiskFile(file_path)
  if (original === null) {
    logLine(`PRE_SKIP MultiEdit ${file_path}: no-disk-file-or-too-large`); return null
  }
  if (hasOptOut(original)) {
    logLine(`PRE_SKIP MultiEdit ${file_path}: opt-out`); return null
  }

  // 累积 apply 每条 edit,第 i 条 new_string 用 MULTI_OPEN(i) / MULTI_CLOSE(i) 包起来
  let cursor = original
  const applied = new Array(edits.length).fill(false)
  for (let i = 0; i < edits.length; i++) {
    const r = applyEditWithMarkers(cursor, edits[i], MULTI_OPEN(i), MULTI_CLOSE(i))
    if (!r.ok) {
      // 某条 old_string 没匹配(可能是前面 edit 改变了 cursor 里的目标)
      // MultiEdit 工具会自己报错;这里我们就保留累积态继续往下,该条不改写。
      // 但如果某条挂了,Edit 工具语义是整条 MultiEdit 失败 —— 我们干脆放行整个调用
      logLine(`PRE_SKIP MultiEdit ${file_path}: edit[${i}] old-no-match → 放行整调用`); return null
    }
    cursor = r.text
  }

  const fixed = applyPipeline(file_path, cursor)

  // 逐条提取
  let changed = 0
  const newEdits = edits.map((e, i) => {
    const extracted = extractBetween(fixed, MULTI_OPEN(i), MULTI_CLOSE(i))
    if (extracted === null) {
      logLine(`PRE_FAIL MultiEdit ${file_path}: edit[${i}] marker-not-found → 该条不改写`)
      return e
    }
    if (extracted !== e.new_string) changed++
    return { ...e, new_string: extracted }
  })

  if (changed === 0) {
    logLine(`PRE_SKIP MultiEdit ${file_path}: no-change`); return null
  }
  logLine(`PRE_OK MultiEdit ${file_path} edits=${edits.length} changed=${changed}`)
  return { ...input, edits: newEdits }
}

function handleNotebookEdit(input, config) {
  const { notebook_path, new_source, cell_type, edit_mode } = input
  if (typeof notebook_path !== 'string' || typeof new_source !== 'string') return null
  if (edit_mode === 'delete') return null
  // 保守:cell_type 不明或非 markdown 一律跳过(我们不解析 .ipynb JSON)
  if (cell_type !== 'markdown') {
    logLine(`PRE_SKIP NotebookEdit ${notebook_path}: cell_type=${cell_type ?? 'unknown'}`); return null
  }
  if (isInPausedPath(notebook_path, config.paused_paths)) {
    logLine(`PRE_SKIP NotebookEdit ${notebook_path}: paused`); return null
  }
  if (hasOptOut(new_source)) {
    logLine(`PRE_SKIP NotebookEdit ${notebook_path}: opt-out`); return null
  }
  // 让 autocorrect 按 markdown 规则跑(它看 file_path 扩展名)
  const fakePath = notebook_path.replace(/\.ipynb$/i, '.md')
  const fixed = applyPipeline(fakePath, new_source)
  if (fixed === new_source) {
    logLine(`PRE_SKIP NotebookEdit ${notebook_path}: no-change`); return null
  }
  logLine(`PRE_OK NotebookEdit ${notebook_path} len_delta=${fixed.length - new_source.length}`)
  return { ...input, new_source: fixed }
}

// ---------------------------------------------------------------------------
// 调度
// ---------------------------------------------------------------------------

function rewrite(toolName, input, config) {
  switch (toolName) {
    case 'Write':         return handleWrite(input, config)
    case 'Edit':          return handleEdit(input, config)
    case 'MultiEdit':     return handleMultiEdit(input, config)
    case 'NotebookEdit':  return handleNotebookEdit(input, config)
    default:              return null
  }
}

// 软 timeout:1.5s 内出结果,超时即放行不改写
function withSoftTimeout(task) {
  return new Promise((resolve) => {
    let done = false
    const t = setTimeout(() => {
      if (done) return
      done = true
      logLine('PRE_TIMEOUT_SOFT')
      resolve(null)
    }, SOFT_TIMEOUT_MS)
    Promise.resolve()
      .then(task)
      .then((r) => { if (done) return; done = true; clearTimeout(t); resolve(r) })
      .catch((e) => { if (done) return; done = true; clearTimeout(t); logLine(`PRE_FAIL ${e.message}`); resolve(null) })
  })
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

// 硬 timeout 兜底
setTimeout(() => { try { emit(null) } catch {} ; process.exit(0) }, HARD_TIMEOUT_MS).unref?.()

async function main() {
  const config = readConfig() || { paused_paths: [] }
  const stdin = await readStdin()
  if (!stdin) { emit(null); return }

  let payload
  try { payload = JSON.parse(stdin) } catch (e) {
    logLine(`PRE_FAIL parse: ${e.message}`)
    emit(null); return
  }

  const toolName = payload?.tool_name
  const input = payload?.tool_input
  if (!toolName || !input || typeof input !== 'object') { emit(null); return }

  const updated = await withSoftTimeout(() => rewrite(toolName, input, config))
  emit(updated || null)
}

main().catch((e) => {
  logLine(`PRE_UNHANDLED: ${e.message}`)
  try { emit(null) } catch {}
  process.exit(0)
})
