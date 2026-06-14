#!/usr/bin/env node
// install/cli.mjs (source) → 装到 ~/.zhfix/cli.mjs
// zhfix 命令族:init / pause / resume / status / uninstall / help
// 跨平台:Windows / macOS / Linux

// Node 24+ DEP0190 警告对 cmd.exe→.cmd 子链是误报,压制
process.removeAllListeners('warning')
process.on('warning', (w) => { if (w.code !== 'DEP0190') console.warn(w) })

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, basename, resolve as resolvePath, isAbsolute } from 'node:path'
import { homedir } from 'node:os'

const IS_WIN = process.platform === 'win32'
const HOME = homedir()
const ZHFIX_DIR = join(HOME, '.zhfix')
const CONFIG_PATH = join(ZHFIX_DIR, 'config.json')
const BACKUPS_DIR = join(ZHFIX_DIR, 'backups')
const HOOK_BASH = join(HOME, '.claude', 'hooks', 'zh-fix-auto.sh')
const SETTINGS_JSON = join(HOME, '.claude', 'settings.json')
const LOG_PATH = join(HOME, '.claude', 'zh-fix.log')
const SKILL_DIR = join(HOME, '.claude', 'skills', 'zhfix')

// PATH 安装位置:用 npm 全局 bin(已经在 PATH 里)
function getNpmBin() {
  const r = IS_WIN
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', 'prefix', '-g'], { encoding: 'utf-8', shell: false })
    : spawnSync('npm', ['prefix', '-g'], { encoding: 'utf-8', shell: false })
  const prefix = r.stdout?.trim() || ''
  if (!prefix) return null
  return IS_WIN ? prefix : join(prefix, 'bin')
}

function getZhfixCmdPath()  { const b = getNpmBin(); return b ? join(b, IS_WIN ? 'zhfix.cmd' : 'zhfix') : null }
function getZhfixShPath()   { const b = getNpmBin(); return b ? join(b, 'zhfix') : null }

function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch { return null }
}

function writeConfig(cfg) {
  if (!existsSync(ZHFIX_DIR)) mkdirSync(ZHFIX_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
}

function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '')
}

// Windows 绝对路径 → Git Bash 风格(C:\foo → /c/foo)
function toBashPath(p) {
  if (!IS_WIN) return p
  return '/' + p.replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()).replace(/\\/g, '/')
}

function info(msg) { process.stdout.write(msg + '\n') }
function warn(msg) { process.stderr.write('⚠️  ' + msg + '\n') }
function fail(msg) { process.stderr.write('❌ ' + msg + '\n'); process.exit(1) }
function ok(msg)   { process.stdout.write('✅ ' + msg + '\n') }

// ============================================================================
// zhfix init [tool-path]
// ============================================================================
function cmdInit(args) {
  const arg = args[0]
  const toolRoot = arg ? resolvePath(arg) : resolvePath(process.cwd())

  if (!existsSync(join(toolRoot, 'zh-fix.mjs'))) {
    fail(`找不到 zh-fix.mjs 在: ${toolRoot}\n用法: zhfix init [tool 目录]`)
  }

  const existing = readConfig() || {}
  const cfg = {
    tool_root: normalizePath(toolRoot),
    paused_paths: existing.paused_paths || [],
    version: 1,
  }
  writeConfig(cfg)
  ok(`config 已写: ${CONFIG_PATH}`)
  ok(`  tool_root = ${cfg.tool_root}`)

  const hookDir = dirname(HOOK_BASH)
  if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true })
  const bashContent = `#!/usr/bin/env bash
# zh-fix-auto.sh - 由 zhfix init 生成,不要手改
# 路径解耦版:hook 调用统一进 ~/.zhfix/hook.mjs,后者读 config 找 tool 和 paused list
ROUTER="$HOME/.zhfix/hook.mjs"
[ ! -f "$ROUTER" ] && exit 0
cat | node "$ROUTER" >/dev/null 2>&1
exit 0
`
  writeFileSync(HOOK_BASH, bashContent, 'utf-8')
  if (!IS_WIN) { try { chmodSync(HOOK_BASH, 0o755) } catch {} }
  ok(`bash hook: ${HOOK_BASH}`)

  installPostToolUseHook()
  ok(`settings.json PostToolUse 已配`)

  const shimResult = installPathShim()
  if (shimResult.ok) {
    ok(`zhfix 命令已装到 PATH:`)
    shimResult.paths.forEach(p => info(`    ${p}`))
  } else {
    warn(`PATH shim 装失败:${shimResult.reason}`)
    info(`  替代:用 node ${join(ZHFIX_DIR, 'cli.mjs')} <command>`)
  }

  // 装 /zhfix skill 到 ~/.claude/skills/zhfix/
  const skillSrc = join(toolRoot, '..', 'skills', 'zhfix', 'SKILL.md')
  if (existsSync(skillSrc)) {
    if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true })
    copyFileSync(skillSrc, join(SKILL_DIR, 'SKILL.md'))
    ok(`/zhfix skill 已装:${SKILL_DIR}`)
  } else {
    warn(`找不到 skills/zhfix/SKILL.md(在 ${skillSrc}),skill 跳过`)
  }

  info('')
  info('🎉 安装完成。重启 Claude Code 让 hook 和 /zhfix 命令都生效。')
  info('   测试:zhfix status')
}

function installPostToolUseHook() {
  let settings = {}
  if (existsSync(SETTINGS_JSON)) {
    // B5 修:备份带时间戳,避免重跑 init 时覆盖之前的备份
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    try { copyFileSync(SETTINGS_JSON, `${SETTINGS_JSON}.bak.${stamp}`) } catch {}
    try { settings = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8')) } catch {
      fail(`settings.json 解析失败,请先手动修复: ${SETTINGS_JSON}`)
    }
  } else {
    const sdir = dirname(SETTINGS_JSON)
    if (!existsSync(sdir)) mkdirSync(sdir, { recursive: true })
  }
  settings.hooks ||= {}
  settings.hooks.PostToolUse ||= []
  const cmdLine = `bash ${toBashPath(HOOK_BASH)}`

  let exists = false
  for (const entry of settings.hooks.PostToolUse) {
    if (entry?.matcher === 'Write|Edit|MultiEdit') {
      for (const h of entry.hooks || []) {
        if (typeof h?.command === 'string' && h.command.includes('zh-fix-auto.sh')) {
          exists = true
          break
        }
      }
    }
    if (exists) break
  }
  if (!exists) {
    settings.hooks.PostToolUse.push({
      matcher: 'Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: cmdLine }],
    })
  }
  writeFileSync(SETTINGS_JSON, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

function installPathShim() {
  const bin = getNpmBin()
  if (!bin) return { ok: false, reason: '找不到 npm 全局 bin 目录' }
  if (!existsSync(bin)) mkdirSync(bin, { recursive: true })
  const paths = []
  if (IS_WIN) {
    const cmdPath = join(bin, 'zhfix.cmd')
    writeFileSync(cmdPath, `@echo off\r\nnode "%USERPROFILE%\\.zhfix\\cli.mjs" %*\r\n`, 'utf-8')
    paths.push(cmdPath)
    const shPath = join(bin, 'zhfix')
    writeFileSync(shPath, `#!/bin/sh\nnode "$HOME/.zhfix/cli.mjs" "$@"\n`, 'utf-8')
    paths.push(shPath)
  } else {
    const shPath = join(bin, 'zhfix')
    writeFileSync(shPath, `#!/bin/sh\nnode "$HOME/.zhfix/cli.mjs" "$@"\n`, 'utf-8')
    try { chmodSync(shPath, 0o755) } catch {}
    paths.push(shPath)
  }
  return { ok: true, paths }
}

// ============================================================================
// zhfix pause / resume
// ============================================================================
function cmdPause() {
  const cfg = readConfig()
  if (!cfg) fail(`未配置。先运行 zhfix init`)
  const cwd = normalizePath(process.cwd())
  cfg.paused_paths ||= []
  if (cfg.paused_paths.some(p => normalizePath(p).toLowerCase() === cwd.toLowerCase())) {
    info(`此路径已暂停:${cwd}`)
    return
  }
  cfg.paused_paths.push(cwd)
  writeConfig(cfg)
  ok(`暂停:${cwd}`)
  info(`(及其所有子目录,Claude 写文件时会跳过)`)
}

function cmdResume() {
  const cfg = readConfig()
  if (!cfg) fail(`未配置。先运行 zhfix init`)
  const cwd = normalizePath(process.cwd())
  const before = cfg.paused_paths?.length || 0
  cfg.paused_paths = (cfg.paused_paths || []).filter(p => normalizePath(p).toLowerCase() !== cwd.toLowerCase())
  if (cfg.paused_paths.length === before) {
    info(`此路径并未在暂停列表里:${cwd}`)
    return
  }
  writeConfig(cfg)
  ok(`恢复:${cwd}`)
}

// ============================================================================
// zhfix status
// ============================================================================
function cmdStatus() {
  const cfg = readConfig()
  info('=== zhfix 状态 ===')
  if (!cfg) {
    warn('未配置。运行 zhfix init [tool 路径]')
    return
  }
  info(`config:       ${CONFIG_PATH}`)
  info(`tool_root:    ${cfg.tool_root}`)
  const toolOk = existsSync(join(cfg.tool_root, 'zh-fix.mjs'))
  info(`tool 存在:    ${toolOk ? '✅' : '❌ (找不到 zh-fix.mjs)'}`)
  info(`hook 包装:    ${existsSync(HOOK_BASH) ? '✅' : '❌'}`)
  info(`hook 已注册:  ${checkHookRegistered() ? '✅' : '❌'}`)
  const cmdPath = getZhfixCmdPath()
  info(`PATH 命令:    ${cmdPath && existsSync(cmdPath) ? '✅' : '❌'}`)
  info('')
  info(`暂停的路径(${cfg.paused_paths?.length || 0} 个):`)
  if (!cfg.paused_paths || cfg.paused_paths.length === 0) {
    info('  (无)')
  } else {
    const cwd = normalizePath(process.cwd()).toLowerCase()
    cfg.paused_paths.forEach(p => {
      const np = normalizePath(p).toLowerCase()
      const here = np === cwd ? ' ← 当前所在' : ''
      info('  - ' + p + here)
    })
  }
  info('')

  const cwd = normalizePath(process.cwd()).toLowerCase()
  const cwdPaused = (cfg.paused_paths || []).some(p => {
    const np = normalizePath(p).toLowerCase()
    return cwd === np || cwd.startsWith(np + '/')
  })
  info(`当前路径状态:${cwdPaused ? '🛑 暂停中' : '✅ 启用'}`)
  info('')

  if (existsSync(LOG_PATH)) {
    const log = readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean)
    const todayPrefix = new Date().toISOString().slice(0, 10)
    const today = log.filter(l => l.startsWith(todayPrefix))
    info(`今日活动(${today.length} 条):`)
    const counts = {}
    today.forEach(l => {
      const m = l.match(/^\S+\s+(\w+)/)
      const tag = m ? m[1] : '?'
      counts[tag] = (counts[tag] || 0) + 1
    })
    Object.entries(counts).forEach(([k, v]) => info(`  ${k}: ${v}`))
    info('')
    info(`最近 5 条 log(${LOG_PATH}):`)
    log.slice(-5).forEach(l => info('  ' + l))
  } else {
    info('(尚无日志)')
  }
}

function checkHookRegistered() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
    const arr = s?.hooks?.PostToolUse || []
    for (const e of arr) {
      for (const h of e.hooks || []) {
        if (typeof h?.command === 'string' && h.command.includes('zh-fix-auto.sh')) return true
      }
    }
  } catch {}
  return false
}

// ============================================================================
// zhfix uninstall [--all]
// 默认只卸 zhfix 本体
// --all 还会一并卸 autocorrect-node、删 log、删 settings.json 时间戳备份
// ============================================================================
function cmdUninstall(args) {
  const all = args.includes('--all') || args.includes('-a')
  info(all ? '卸载 zhfix 全套(含独立组件)...' : '卸载 zhfix 本体...')
  const removed = []

  if (existsSync(SETTINGS_JSON)) {
    try {
      const s = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
      if (s?.hooks?.PostToolUse) {
        const before = JSON.stringify(s.hooks.PostToolUse)
        s.hooks.PostToolUse = s.hooks.PostToolUse
          .map(e => ({
            ...e,
            hooks: (e.hooks || []).filter(h => !(typeof h?.command === 'string' && h.command.includes('zh-fix-auto.sh'))),
          }))
          .filter(e => e.hooks && e.hooks.length > 0)
        if (JSON.stringify(s.hooks.PostToolUse) !== before) {
          if (s.hooks.PostToolUse.length === 0) delete s.hooks.PostToolUse
          writeFileSync(SETTINGS_JSON, JSON.stringify(s, null, 2) + '\n', 'utf-8')
          removed.push('settings.json 里的 PostToolUse')
        }
      }
    } catch (e) {
      warn(`settings.json 处理失败,跳过:${e.message}`)
    }
  }

  if (existsSync(HOOK_BASH)) {
    try { unlinkSync(HOOK_BASH); removed.push(HOOK_BASH) } catch {}
  }

  const cmdPath = getZhfixCmdPath()
  if (cmdPath && existsSync(cmdPath)) {
    try { unlinkSync(cmdPath); removed.push(cmdPath) } catch {}
  }
  const shPath = getZhfixShPath()
  if (shPath && existsSync(shPath) && shPath !== cmdPath) {
    try { unlinkSync(shPath); removed.push(shPath) } catch {}
  }

  if (existsSync(ZHFIX_DIR)) {
    try { rmSync(ZHFIX_DIR, { recursive: true, force: true }); removed.push(ZHFIX_DIR) } catch {}
  }

  // 删 /zhfix skill
  if (existsSync(SKILL_DIR)) {
    try { rmSync(SKILL_DIR, { recursive: true, force: true }); removed.push(SKILL_DIR) } catch {}
  }

  // --all:一并卸独立组件
  if (all) {
    // autocorrect-node 全局 npm 包
    info('卸 autocorrect-node 全局 npm 包...')
    const npmRes = IS_WIN
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', 'uninstall', '-g', 'autocorrect-node'], { stdio: 'ignore', shell: false })
      : spawnSync('npm', ['uninstall', '-g', 'autocorrect-node'], { stdio: 'ignore', shell: false })
    if (npmRes.status === 0) {
      removed.push('autocorrect-node(npm 全局包)')
    } else {
      warn(`autocorrect-node 卸载失败(也许本来就没装),跳过`)
    }
    // log
    if (existsSync(LOG_PATH)) {
      try { unlinkSync(LOG_PATH); removed.push(LOG_PATH) } catch {}
    }
    // settings.json 时间戳备份
    try {
      const claudeDir = dirname(SETTINGS_JSON)
      const bakFiles = readdirSync(claudeDir).filter(n => n.startsWith('settings.json.bak'))
      for (const f of bakFiles) {
        try { unlinkSync(join(claudeDir, f)); removed.push(join(claudeDir, f)) } catch {}
      }
    } catch {}
  }

  info('')
  ok('已卸载:')
  removed.forEach(r => info('  - ' + r))

  if (!all) {
    info('')
    info('未卸载(独立组件,默认保留):')
    info('  - autocorrect-node(npm 包)')
    info('  - ~/.claude/zh-fix.log(历史日志)')
    info('  - ~/.claude/settings.json.bak.*(自动备份)')
    info('')
    info('要把上面这些也一起卸,跑:zhfix uninstall --all')
  }

  info('')
  info('不会动的(你的资产):')
  info('  - 工具源 tool/ 目录(在你的 repo 里)')
  info('  - ~/.zhfix/backups/ 已经在 zhfix uninstall 时随 ~/.zhfix/ 一起删了')
  info('    (如果你想保留改文件的备份,提前 cp 出来)')
}

// ============================================================================
// zhfix restore <file>
// 还原指定文件到最近的备份(由 /zhfix skill 在改之前自动生成)
// 备份命名:~/.zhfix/backups/<encoded_abs_path>.<timestamp>.bak
// 路径编码:绝对路径里的 / \ : 都替换成 _
// ============================================================================
function encodePathForBackup(absPath) {
  return absPath.replace(/[\/\\:]/g, '_')
}

function cmdRestore(args) {
  const fileArg = args[0]
  if (!fileArg) fail(`用法:zhfix restore <文件路径>`)

  const fileAbs = resolvePath(fileArg)
  if (!existsSync(BACKUPS_DIR)) fail(`没找到备份目录 ${BACKUPS_DIR}`)

  const encoded = encodePathForBackup(fileAbs)
  // glob 等价:列 backups 里以 <encoded>. 开头、.bak 结尾的
  let entries
  try { entries = readdirSync(BACKUPS_DIR) } catch { fail(`读不到备份目录`) }
  const matches = entries.filter(n => n.startsWith(encoded + '.') && n.endsWith('.bak'))
  if (matches.length === 0) {
    fail(`没找到 ${fileAbs} 的备份(查 ${BACKUPS_DIR} 看看,或者没改过这个文件)`)
  }

  // 按时间戳排序(文件名格式:<encoded>.<YYYYMMDD-HHMMSS>.bak)
  matches.sort((a, b) => {
    const ta = a.slice(encoded.length + 1, -4)
    const tb = b.slice(encoded.length + 1, -4)
    return tb.localeCompare(ta)
  })
  const latest = join(BACKUPS_DIR, matches[0])

  // 还原前再备份当前状态(以防误用 restore)
  const ts = new Date().toISOString().replace(/[:.T-]/g, '').slice(0, 14)
  const preRestoreName = `${encoded}.${ts.slice(0,8)}-${ts.slice(8,14)}.pre-restore.bak`
  try {
    if (existsSync(fileAbs)) {
      copyFileSync(fileAbs, join(BACKUPS_DIR, preRestoreName))
    }
  } catch (e) {
    warn(`pre-restore 备份失败(继续):${e.message}`)
  }

  // 复制 latest 到原文件位置
  try {
    copyFileSync(latest, fileAbs)
    ok(`已还原:${fileAbs}`)
    info(`  来源备份:${latest}`)
    info(`  本次操作前已存:${preRestoreName}(再次 restore 可回到这一刻)`)
  } catch (e) {
    fail(`还原失败:${e.message}`)
  }
}

// ============================================================================
// zhfix clear-backups [--yes]
// 清掉 ~/.zhfix/backups/ 里所有 .bak 文件
// 默认列出 + 提示加 --yes 才真删;--yes 直接删
// ============================================================================
function cmdClearBackups(args) {
  const yes = args.includes('--yes') || args.includes('-y')

  if (!existsSync(BACKUPS_DIR)) {
    info(`备份目录不存在:${BACKUPS_DIR}`)
    info('(还没有改过任何文件,所以没备份)')
    return
  }

  const files = readdirSync(BACKUPS_DIR).filter(n => n.endsWith('.bak'))
  if (files.length === 0) {
    info(`${BACKUPS_DIR} 里没有备份文件`)
    return
  }

  let totalSize = 0
  for (const f of files) {
    try { totalSize += statSync(join(BACKUPS_DIR, f)).size } catch {}
  }
  const sizeMb = (totalSize / 1024 / 1024).toFixed(2)

  info(`备份目录:${BACKUPS_DIR}`)
  info(`共 ${files.length} 个备份,${sizeMb} MB`)

  if (!yes) {
    info('')
    info('要清掉它们,加 --yes:')
    info('  zhfix clear-backups --yes')
    return
  }

  let deleted = 0, failed = 0
  for (const f of files) {
    try { unlinkSync(join(BACKUPS_DIR, f)); deleted++ } catch { failed++ }
  }
  ok(`已删 ${deleted} 个备份(${failed > 0 ? failed + ' 个失败' : '全部成功'})`)
}

// ============================================================================
// zhfix help
// ============================================================================
function cmdHelp() {
  info(`zhfix - 中文标点自动修正工具

用法:
  zhfix init [tool 路径]       首次配置;tool 路径默认为当前目录
  zhfix pause                  暂停当前目录(及子目录)
  zhfix resume                 恢复当前目录
  zhfix status                 查看 hook 是否启用 + 当前目录是否暂停 + 今日活动
  zhfix restore <文件>         还原指定文件到最近的备份(由 /zhfix skill 改之前生成)
  zhfix clear-backups [--yes]  清掉所有备份文件
  zhfix uninstall [--all]      卸载;默认只卸 zhfix 本体,--all 同时卸 autocorrect 等
  zhfix help                   本帮助

Claude Code 命令(装好后斜杠触发):
  /zhfix <文件>            把单个 .md/.html 文件用 zh-fix 规则改标点
                          (备份再改,可用 zhfix restore 还原)

配置:
  ~/.zhfix/config.json     tool_root + paused_paths
  ~/.zhfix/backups/        skill 改文件前的备份

日志:
  ~/.claude/zh-fix.log     每次 hook 跑都记一行

紧急关闭:
  看 tool/EMERGENCY-OFF.md
`)
}

const [, , cmd, ...rest] = process.argv
switch ((cmd || 'help').toLowerCase()) {
  case 'init':       cmdInit(rest); break
  case 'pause':      cmdPause(); break
  case 'resume':     cmdResume(); break
  case 'status':     cmdStatus(); break
  case 'restore':    cmdRestore(rest); break
  case 'clear-backups':
  case 'clean-backups': cmdClearBackups(rest); break
  case 'uninstall':  cmdUninstall(rest); break
  case 'help':
  case '--help':
  case '-h':         cmdHelp(); break
  default:
    warn(`未知命令:${cmd}`)
    cmdHelp()
    process.exit(1)
}
