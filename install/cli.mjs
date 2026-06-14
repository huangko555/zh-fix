#!/usr/bin/env node
// install/cli.mjs (source) → 装到 ~/.zhfix/cli.mjs
// zhfix 命令族:init / pause / resume / status / uninstall / help
// 跨平台:Windows / macOS / Linux

// Node 24+ DEP0190 警告对 cmd.exe→.cmd 子链是误报,压制
process.removeAllListeners('warning')
process.on('warning', (w) => { if (w.code !== 'DEP0190') console.warn(w) })

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync, rmSync, chmodSync, readdirSync, statSync, appendFileSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, basename, resolve as resolvePath, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// ============================================================================
// 公共工具(给备份命名/时间戳用)
// ============================================================================

// F5 修:时间戳带毫秒,避免秒级冲突
function makeTimestamp() {
  const d = new Date()
  const Y = d.getFullYear()
  const M = String(d.getMonth() + 1).padStart(2, '0')
  const D = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${Y}${M}${D}-${h}${m}${s}-${ms}`
}

// F9 修:用 SHA1 hash + basename,避免路径编码碰撞
//   `D:\a_b\c.md` 和 `D:\a\b_c.md` 之前都编成同样的下划线串,这里靠 hash 区分
//   basename 留在文件名里方便 ls 时认出原文件
function encodePathForBackup(absPath) {
  const hash = createHash('sha1').update(absPath).digest('hex').slice(0, 8)
  return `${hash}.${basename(absPath)}`
}

const IS_WIN = process.platform === 'win32'
const HOME = homedir()
const ZHFIX_DIR = join(HOME, '.zhfix')
const CONFIG_PATH = join(ZHFIX_DIR, 'config.json')
const BACKUPS_DIR = join(ZHFIX_DIR, 'backups')
const HOOK_BASH = join(HOME, '.claude', 'hooks', 'zh-fix-auto.sh')
const SETTINGS_JSON = join(HOME, '.claude', 'settings.json')
const LOG_PATH = join(HOME, '.claude', 'zh-fix.log')
const SKILL_DIR = join(HOME, '.claude', 'skills', 'zhfix')

// 包自身位置:cli.mjs 在 <pkg>/install/cli.mjs,上级目录即包根。
// npm 全局装后包根 = <npm-global>/node_modules/zhfix/,tool / hook / skill 都从这里取,
// 不写死任何机器路径,靠 import.meta.url 让包自己定位自己。
const PKG_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_TOOL = join(PKG_ROOT, 'tool')
const PKG_HOOK_SRC = join(PKG_ROOT, 'install', 'hook.mjs')
const PKG_SKILL_SRC = join(PKG_ROOT, 'skills', 'zhfix', 'SKILL.md')

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
  // 默认指向包自身的 tool/(npm 全局包内);传参时用参数(开发者从 repo 指过去)
  const toolRoot = arg ? resolvePath(arg) : PKG_TOOL

  if (!existsSync(join(toolRoot, 'zh-fix.mjs'))) {
    fail(`找不到 zh-fix.mjs 在: ${toolRoot}\n用法: zhfix init [tool 目录]`)
  }

  // C1+C2 修:在写任何文件前,**先 validate** settings.json 可解析且是 object
  // 这样如果 settings 坏了,不会留下半装状态(node_modules + cli.mjs + bash hook 已落地但 settings 没注册)
  if (existsSync(SETTINGS_JSON)) {
    let s
    try {
      s = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
    } catch (e) {
      fail(`settings.json 解析失败,中止安装(避免留半装状态)。\n` +
           `请先修复 ${SETTINGS_JSON} 再跑安装器。错误:${e.message}`)
    }
    if (typeof s !== 'object' || Array.isArray(s) || s === null) {
      fail(`settings.json 必须是 JSON 对象,当前是 ${Array.isArray(s) ? 'array' : typeof s},中止安装。`)
    }
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

  // bash hook 直接指向包内 hook.mjs(随 npm 升级自动跟随)。
  // 早期做法是拷贝到 ~/.zhfix/hook.mjs,但那样 npm 升级包后拷贝会脱节,故改为指向包内原件。
  if (!existsSync(PKG_HOOK_SRC)) {
    fail(`找不到 hook 路由源 ${PKG_HOOK_SRC}(包不完整?)`)
  }
  const routerBash = toBashPath(PKG_HOOK_SRC)

  const hookDir = dirname(HOOK_BASH)
  if (!existsSync(hookDir)) mkdirSync(hookDir, { recursive: true })
  const bashContent = `#!/usr/bin/env bash
# zh-fix-auto.sh - 由 zhfix init 生成,不要手改
# hook 调用进包内 hook.mjs,它读 config 找 tool 和 paused list
ROUTER="${routerBash}"
[ ! -f "$ROUTER" ] && exit 0
cat | node "$ROUTER" >/dev/null 2>&1
exit 0
`
  writeFileSync(HOOK_BASH, bashContent, 'utf-8')
  if (!IS_WIN) { try { chmodSync(HOOK_BASH, 0o755) } catch {} }
  ok(`bash hook: ${HOOK_BASH}`)

  installPostToolUseHook()
  ok(`settings.json PostToolUse 已配`)

  // zhfix 命令由 npm bin 提供(npm i -g zhfix 时自动挂到 PATH),这里不再手写 shim

  // 装 /zhfix skill 到 ~/.claude/skills/zhfix/(从包内取)
  const skillSrc = PKG_SKILL_SRC
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

// ============================================================================
// zhfix install — 首次接入 Claude Code(npm i -g zhfix 之后跑这个)
// = preflight + init(自动用包内 tool) + 一段使用说明
// ============================================================================
function cmdInstall(args) {
  // Windows 上 bash hook 强依赖 Git Bash,先探测。
  // 要排除 WSL 的 System32\bash.exe —— 它把盘符当 /mnt/c,跟我们写的 /c/... hook 路径不兼容
  if (IS_WIN) {
    const bashCheck = spawnSync('cmd.exe', ['/d', '/s', '/c', 'where', 'bash'], { encoding: 'utf-8', shell: false })
    const bashPaths = (bashCheck.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    const gitBash = bashPaths.find(p => !/\\System32\\bash\.exe$/i.test(p))
    if (!gitBash) {
      fail(bashPaths.length > 0
        ? `检测到的 bash 是 WSL 的(System32\\bash.exe),它的路径风格(/mnt/c/...)跟 hook 用的 Git Bash(/c/...)不兼容。
请装 Git for Windows:https://git-scm.com/download/win
装完重开终端再跑 zhfix install。`
        : `Windows 上 hook 需要 bash(Git for Windows 自带),没检测到。
请先装 Git for Windows:https://git-scm.com/download/win
装完重开终端再跑 zhfix install。`)
    }
  }
  // Claude Code 装没装(看 ~/.claude/ 在不在)
  if (!existsSync(join(HOME, '.claude'))) {
    warn(`没检测到 Claude Code(${join(HOME, '.claude')} 不存在)。`)
    warn(`zhfix 是给 Claude Code 用的 hook,没装 Claude Code 这工具不会自动触发——`)
    warn(`仍会继续配置,hook 只在 Claude Code 装好并重启后才生效。`)
  }

  cmdInit(args)

  info('')
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  info('【接下来怎么用】')
  info('  你什么都不用做。重启 Claude Code 后正常用 ——')
  info('  Claude 每次写完 .md / .html,工具会在后台把中文段落里的')
  info('  半角标点改成全角。')
  info('')
  info('  写入:  你好,世界.带边界(英文).')
  info('  落盘:  你好，世界。带边界 (英文)。')
  info('')
  info('【常用命令】')
  info('  zhfix status     看 hook 是否启用 + 当前目录是否暂停 + 今日活动')
  info('  zhfix pause      当前目录不想被处理(英文文档 / 代码示例)')
  info('  zhfix resume     恢复处理')
  info('  zhfix uninstall  卸载接入(之后再 npm uninstall -g zhfix 删本体)')
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

function installPostToolUseHook() {
  let settings = {}
  if (existsSync(SETTINGS_JSON)) {
    // 备份带时间戳,避免重跑 init 时覆盖之前的备份
    const stamp = makeTimestamp()
    try { copyFileSync(SETTINGS_JSON, `${SETTINGS_JSON}.bak.${stamp}`) } catch {}
    try { settings = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8')) } catch {
      fail(`settings.json 解析失败,请先手动修复: ${SETTINGS_JSON}`)
    }
    // C2 修:settings.json 必须是 plain object,不能是 array/null/primitive
    if (typeof settings !== 'object' || Array.isArray(settings) || settings === null) {
      fail(`settings.json 必须是 JSON 对象(当前是 ${Array.isArray(settings) ? 'array' : typeof settings}),无法 merge hook。请检查 ${SETTINGS_JSON}`)
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
  const purgeBackups = args.includes('--purge-backups')
  info(all ? '卸载 zhfix 全套(含独立组件)...' : '卸载 zhfix 本体...')
  const removed = []
  const failedOps = []  // C7 修:收集失败的操作,不再静默吞

  function tryUnlink(p, label = p) {
    try { unlinkSync(p); removed.push(label) }
    catch (e) { failedOps.push({ path: p, error: e.message }) }
  }
  function tryRmDir(p, label = p) {
    try { rmSync(p, { recursive: true, force: true }); removed.push(label) }
    catch (e) { failedOps.push({ path: p, error: e.message }) }
  }

  // C6 修:先确认 settings.json 能 parse,坏了直接 fail,不继续删 hook 留 dangling
  let settingsObj = null
  if (existsSync(SETTINGS_JSON)) {
    try {
      settingsObj = JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8'))
    } catch (e) {
      fail(`settings.json 解析失败,中止 uninstall:${e.message}\n` +
           `请先手动修复或备份 settings.json 再跑 zhfix uninstall`)
    }
  }

  if (settingsObj && settingsObj?.hooks?.PostToolUse) {
    const before = JSON.stringify(settingsObj.hooks.PostToolUse)
    settingsObj.hooks.PostToolUse = settingsObj.hooks.PostToolUse
      .map(e => ({
        ...e,
        hooks: (e.hooks || []).filter(h => !(typeof h?.command === 'string' && h.command.includes('zh-fix-auto.sh'))),
      }))
      .filter(e => e.hooks && e.hooks.length > 0)
    if (JSON.stringify(settingsObj.hooks.PostToolUse) !== before) {
      if (settingsObj.hooks.PostToolUse.length === 0) delete settingsObj.hooks.PostToolUse
      try {
        writeFileSync(SETTINGS_JSON, JSON.stringify(settingsObj, null, 2) + '\n', 'utf-8')
        removed.push('settings.json 里的 PostToolUse')
      } catch (e) {
        failedOps.push({ path: SETTINGS_JSON + ' (PostToolUse 段)', error: e.message })
      }
    }
  }

  if (existsSync(HOOK_BASH)) tryUnlink(HOOK_BASH)

  // 注意:zhfix 命令本身由 npm bin 提供,不在这里删 —— 交给 `npm uninstall -g zhfix`

  // B8 修:卸 ~/.zhfix/ 之前,如果 backups/ 非空,默认搬到外面保留
  // 用户加 --purge-backups 才一并删
  let backupsSaved = null
  if (existsSync(BACKUPS_DIR) && !purgeBackups) {
    try {
      const files = readdirSync(BACKUPS_DIR).filter(n => n.endsWith('.bak'))
      if (files.length > 0) {
        const totalBytes = files.reduce((s, f) => {
          try { return s + statSync(join(BACKUPS_DIR, f)).size } catch { return s }
        }, 0)
        // 移到 ~/.zhfix-backups-saved-<timestamp>/,跟主目录平级
        const savedDir = join(HOME, `.zhfix-backups-saved-${makeTimestamp()}`)
        renameSync(BACKUPS_DIR, savedDir)
        backupsSaved = { dir: savedDir, count: files.length, sizeMb: (totalBytes / 1024 / 1024).toFixed(2) }
      }
    } catch (e) {
      failedOps.push({ path: BACKUPS_DIR, error: `移到外部保留失败:${e.message}` })
    }
  }

  if (existsSync(ZHFIX_DIR)) tryRmDir(ZHFIX_DIR)

  // 删 /zhfix skill
  if (existsSync(SKILL_DIR)) tryRmDir(SKILL_DIR)

  // --all:一并清掉日志和 settings 备份
  // (autocorrect-node 是 zhfix 包的依赖,随 `npm uninstall -g zhfix` 一起删,这里不单独卸)
  if (all) {
    // log
    if (existsSync(LOG_PATH)) tryUnlink(LOG_PATH)
    // settings.json 时间戳备份(C5 修:只删严格匹配我们时间戳格式的,不动用户手动备份)
    // 我们的格式:
    //   - settings.json.bak.YYYY-MM-DD_HH-MM-SS    (老格式)
    //   - settings.json.bak.YYYYMMDD-HHMMSS-mmm    (新格式 makeTimestamp)
    const ourBakRegex = /^settings\.json\.bak\.(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}|\d{8}-\d{6}-\d{3})$/
    try {
      const claudeDir = dirname(SETTINGS_JSON)
      const bakFiles = readdirSync(claudeDir).filter(n => ourBakRegex.test(n))
      for (const f of bakFiles) tryUnlink(join(claudeDir, f))
    } catch {}
  }

  info('')
  ok('已卸载:')
  removed.forEach(r => info('  - ' + r))

  // C7 修:失败操作不再吞,显式告知用户
  if (failedOps.length > 0) {
    info('')
    warn(`以下 ${failedOps.length} 项删除失败:`)
    failedOps.forEach(f => info(`  - ${f.path}: ${f.error}`))
    info('  可能因为文件被进程占用或没权限。关闭相关程序后手动删除即可。')
  }

  // B8 修:告知 backups 的去向(搬到外部,或被 --purge-backups 清掉)
  if (backupsSaved) {
    info('')
    info(`📦 备份保留:`)
    info(`  ${backupsSaved.count} 个备份(${backupsSaved.sizeMb} MB)已搬到 ${backupsSaved.dir}`)
    info(`  zhfix restore 已无法用(zhfix 卸了),你可以手动 cp 这里面的文件还原`)
    info(`  不需要时直接 rm -rf "${backupsSaved.dir}" 清理`)
  }

  if (!all) {
    info('')
    info('未卸载(默认保留):')
    info('  - ~/.claude/zh-fix.log(历史日志)')
    info('  - ~/.claude/settings.json.bak.*(只动我们生成的;你自己的手动备份不会动)')
    info('')
    info('要把上面这些也一起清,跑:zhfix uninstall --all')
    if (backupsSaved) {
      info('要连备份也一起清,跑:zhfix uninstall --purge-backups(配合 --all)')
    }
  }

  info('')
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  info('以上清的是"接入 Claude Code"的部分。要删 zhfix 本体(命令 + autocorrect 依赖),再跑:')
  info('  npm uninstall -g zhfix')
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

// ============================================================================
// zhfix restore <file>
// 还原指定文件到最近的备份(由 /zhfix skill 在改之前自动生成)
// 备份命名:~/.zhfix/backups/<hash>.<basename>.<timestamp>.bak
// pre-restore 备份命名:同名 + ".pre-restore.bak" 后缀,排序时被过滤
// ============================================================================
function cmdRestore(args) {
  const fileArg = args[0]
  if (!fileArg) fail(`用法:zhfix restore <文件路径>`)
  // F3 防御:用户误把 .bak 文件本身当参数
  if (fileArg.endsWith('.bak')) {
    fail(`restore 接的是原文件路径,不是备份文件本身。例:zhfix restore D:/docs/prd.md`)
  }

  const fileAbs = resolvePath(fileArg)
  if (!existsSync(BACKUPS_DIR)) fail(`没找到备份目录 ${BACKUPS_DIR}`)

  const encoded = encodePathForBackup(fileAbs)
  let entries
  try { entries = readdirSync(BACKUPS_DIR) } catch { fail(`读不到备份目录`) }

  // F2 修:只找"普通备份",排除 .pre-restore.bak(避免它被当成"最新"还原回去)
  const matches = entries.filter(n =>
    n.startsWith(encoded + '.') &&
    n.endsWith('.bak') &&
    !n.endsWith('.pre-restore.bak'),
  )
  if (matches.length === 0) {
    fail(`没找到 ${fileAbs} 的备份。(如要查看所有备份:ls ${BACKUPS_DIR})`)
  }

  // 按文件名(含时间戳)字典序排序,降序取最新
  matches.sort((a, b) => b.localeCompare(a))
  const latest = join(BACKUPS_DIR, matches[0])

  // 还原前再备份当前状态(以防误用 restore)
  // B5 修:pre-restore 失败必须 fail,不能继续覆盖原文件 —— 否则用户没法回到误用前的状态
  const ts = makeTimestamp()
  const preRestoreName = `${encoded}.${ts}.pre-restore.bak`
  if (existsSync(fileAbs)) {
    try {
      copyFileSync(fileAbs, join(BACKUPS_DIR, preRestoreName))
    } catch (e) {
      fail(`pre-restore 备份失败,中止 restore(防误用)。原因:${e.message}\n` +
           `你可以手动 cp "${fileAbs}" 到别处再重试。`)
    }
  }

  // 复制 latest 到原文件位置
  try {
    copyFileSync(latest, fileAbs)
    ok(`已还原:${fileAbs}`)
    info(`  来源备份:${latest}`)
    info(`  本次操作前已存:${preRestoreName}(再次 restore 仍走"普通备份",这份 pre-restore 保留)`)
    // F16 修:写一行 log,便于事后追溯
    try {
      const stamp = new Date().toISOString()
      appendFileSync(LOG_PATH, `${stamp}  RESTORE ${fileAbs}: from=${matches[0]}\n`, 'utf-8')
    } catch {}
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
  // F3 修:默认不动 pre-restore(那是给"撤销 restore"留的退路);--include-pre-restore 才一并清
  const includePreRestore = args.includes('--include-pre-restore')

  if (!existsSync(BACKUPS_DIR)) {
    info(`备份目录不存在:${BACKUPS_DIR}`)
    info('(还没有改过任何文件,所以没备份)')
    return
  }

  const allBak = readdirSync(BACKUPS_DIR).filter(n => n.endsWith('.bak'))
  if (allBak.length === 0) {
    info(`${BACKUPS_DIR} 里没有备份文件`)
    return
  }

  const preRestores = allBak.filter(n => n.endsWith('.pre-restore.bak'))
  const regular = allBak.filter(n => !n.endsWith('.pre-restore.bak'))
  const toDelete = includePreRestore ? allBak : regular

  // 列出概览;按 basename(去掉 hash 前缀)分组方便用户认出
  function sizeOf(f) {
    try { return statSync(join(BACKUPS_DIR, f)).size } catch { return 0 }
  }
  function totalSize(files) {
    return files.reduce((s, f) => s + sizeOf(f), 0)
  }
  function fmtMb(n) { return (n / 1024 / 1024).toFixed(2) + ' MB' }

  info(`备份目录:${BACKUPS_DIR}`)
  info(`普通备份:${regular.length} 个 (${fmtMb(totalSize(regular))})`)
  info(`pre-restore 快照:${preRestores.length} 个 (${fmtMb(totalSize(preRestores))})`)

  // F15 改进:按 basename 分组列前几条
  if (regular.length > 0) {
    const byName = {}
    regular.forEach(f => {
      // 文件名格式:<hash>.<basename>.<timestamp>.bak — 去掉前后取中间
      const m = f.match(/^[a-f0-9]+\.(.+?)\.\d{8}-\d{6}(-\d{3})?\.bak$/)
      const orig = m ? m[1] : f
      ;(byName[orig] ||= []).push(f)
    })
    info('')
    info('按文件分组(取最多 8 个):')
    Object.entries(byName).slice(0, 8).forEach(([k, v]) => info(`  ${k}  × ${v.length}`))
  }

  if (!yes) {
    info('')
    info(`要删 ${toDelete.length} 个文件,加 --yes:`)
    info('  zhfix clear-backups --yes')
    if (preRestores.length > 0 && !includePreRestore) {
      info(`  (pre-restore 快照默认保留,加 --include-pre-restore 才一并清)`)
    }
    return
  }

  let deleted = 0, failed = 0
  for (const f of toDelete) {
    try { unlinkSync(join(BACKUPS_DIR, f)); deleted++ } catch { failed++ }
  }
  ok(`已删 ${deleted} 个备份(${failed > 0 ? failed + ' 个失败' : '全部成功'})`)
  if (preRestores.length > 0 && !includePreRestore) {
    info(`保留了 ${preRestores.length} 个 pre-restore 快照(用 --include-pre-restore 可一并清)`)
  }
}

// ============================================================================
// zhfix version / --version / -v
// ============================================================================
function cmdVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'))
    info(`zhfix ${pkg.version}`)
  } catch {
    info('zhfix(版本未知)')
  }
}

// ============================================================================
// zhfix help
// ============================================================================
function cmdHelp() {
  info(`zhfix - 中文标点自动修正工具

用法:
  zhfix install                首次接入 Claude Code(npm i -g zhfix 之后跑这个)
  zhfix init [tool 路径]       重新绑定 / 修复配置;tool 路径默认为包自身
  zhfix pause                  暂停当前目录(及子目录)
  zhfix resume                 恢复当前目录的自动处理(撤销之前的 zhfix pause)
  zhfix status                 查看 hook 是否启用 + 当前目录是否暂停 + 今日活动
  zhfix restore <文件>         还原指定文件到最近的备份(由 /zhfix skill 改之前生成)
  zhfix clear-backups [--yes]  清掉所有备份文件
  zhfix uninstall [--all]      卸载接入(hook/config/skill);默认 backups 搬到 ~/.zhfix-backups-saved-* 保留
                               --all 一并清日志和 settings 备份
                               --purge-backups 备份也一并清掉(慎用)
                               删 zhfix 本体另跑:npm uninstall -g zhfix
  zhfix version                查看当前版本号
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
  case 'install':    cmdInstall(rest); break
  case 'init':       cmdInit(rest); break
  case 'pause':      cmdPause(); break
  case 'resume':     cmdResume(); break
  case 'status':     cmdStatus(); break
  case 'restore':    cmdRestore(rest); break
  case 'clear-backups':
  case 'clean-backups': cmdClearBackups(rest); break
  case 'uninstall':  cmdUninstall(rest); break
  case 'version':
  case '--version':
  case '-v':         cmdVersion(); break
  case 'help':
  case '--help':
  case '-h':         cmdHelp(); break
  default:
    warn(`未知命令:${cmd}`)
    cmdHelp()
    process.exit(1)
}
