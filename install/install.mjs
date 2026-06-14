#!/usr/bin/env node
// installer/install.mjs
// 一条命令搞定全套:本地装 autocorrect-node + ~/.zhfix/ 基础设施 + Claude Code hook + zhfix PATH 命令
// 用法:在 repo 根目录 `node install/install.mjs`

// Node 24+ 对 cmd.exe→.cmd 子链有误报的 DEP0190 警告,压制
process.removeAllListeners('warning')
process.on('warning', (w) => { if (w.code !== 'DEP0190') console.warn(w) })

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const TOOL_ROOT = join(REPO_ROOT, 'tool')
const INSTALL_DIR = __dirname

const IS_WIN = process.platform === 'win32'
const HOME = homedir()
const ZHFIX_DIR = join(HOME, '.zhfix')

function info(m) { process.stdout.write(m + '\n') }
function ok(m)   { process.stdout.write('✅ ' + m + '\n') }
function warn(m) { process.stderr.write('⚠️  ' + m + '\n') }
function fail(m) { process.stderr.write('❌ ' + m + '\n'); process.exit(1) }

info(`zh-fix 安装器`)
info(`  REPO_ROOT = ${REPO_ROOT}`)
info(`  TOOL_ROOT = ${TOOL_ROOT}`)
info('')

// 1. Pre-flight
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)
if (nodeMajor < 18) fail(`Node 版本太低 (${process.versions.node}),需 ≥ 18`)
ok(`Node ${process.versions.node}`)

if (!existsSync(join(TOOL_ROOT, 'zh-fix.mjs'))) {
  fail(`找不到 tool/zh-fix.mjs。请确认这是 zh-fix repo 的根目录。`)
}
ok(`tool 源代码就位`)

// Windows 上 bash hook 强依赖 Git Bash,先检测
if (IS_WIN) {
  const bashCheck = spawnSync('cmd.exe', ['/d', '/s', '/c', 'where', 'bash'], { encoding: 'utf-8', shell: false })
  if (bashCheck.status !== 0 || !bashCheck.stdout) {
    fail(`Windows 上 hook 需要 bash(Git for Windows 自带),没检测到。
请先装 Git for Windows:https://git-scm.com/download/win
装完重开终端再跑安装器。`)
  }
  ok(`Git Bash 已装`)
}

// Claude Code 装没装(看 ~/.claude/ 在不在)
const CLAUDE_DIR = join(HOME, '.claude')
if (!existsSync(CLAUDE_DIR)) {
  warn(`没检测到 Claude Code(${CLAUDE_DIR} 不存在)。`)
  warn(`zh-fix 是给 Claude Code 用的 hook,没装 Claude Code 这工具不会自动触发——`)
  warn(`你可以继续装,但 hook 只在 Claude Code 重启后才生效。`)
  warn(`如果你想用别的方式(比如手动跑 'node tool/zh-fix.mjs <file>')也行。`)
} else {
  ok(`Claude Code 配置目录就位`)
}

// B6 修:autocorrect-node 的 NAPI prebuilt 覆盖检查
// 已知 prebuilt 平台:win32-x64, darwin-x64, darwin-arm64, linux-x64-gnu
// 不覆盖:linux-musl(Alpine), linux-arm64, win32-arm64 — 这些平台 npm install 会试着编译,可能失败
{
  const p = process.platform
  const a = process.arch
  const supported =
    (p === 'win32' && a === 'x64') ||
    (p === 'darwin' && (a === 'x64' || a === 'arm64')) ||
    (p === 'linux' && a === 'x64')
  if (!supported) {
    warn(`autocorrect-node 可能没有 ${p}-${a} 的 prebuilt binary`)
    warn(`常见的不覆盖平台:Linux musl(Alpine)、Linux arm64、Windows arm64`)
    warn(`稍后 npm install 可能失败 — 解法:装 Rust 工具链(cargo)后再跑,会自己编译`)
  } else {
    ok(`平台 ${p}-${a} 在 autocorrect-node prebuilt 列表内`)
  }
}

// 2. 本地 npm install(把 autocorrect-node 装到 repo/node_modules/,不污染全局)
const acLocal = join(REPO_ROOT, 'node_modules', 'autocorrect-node')
if (existsSync(acLocal)) {
  ok(`autocorrect-node 已装在 ${REPO_ROOT}/node_modules`)
} else {
  info(`正在本地装 autocorrect-node(在 repo 内,不污染全局)...`)
  const r = IS_WIN
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', 'install'], { cwd: REPO_ROOT, stdio: 'inherit', shell: false })
    : spawnSync('npm', ['install'], { cwd: REPO_ROOT, stdio: 'inherit', shell: false })
  if (r.status !== 0) fail(`npm install 失败`)
  ok(`依赖装好`)
}

// 3. ~/.zhfix/ 基础设施
if (!existsSync(ZHFIX_DIR)) mkdirSync(ZHFIX_DIR, { recursive: true })
copyFileSync(join(INSTALL_DIR, 'cli.mjs'), join(ZHFIX_DIR, 'cli.mjs'))
copyFileSync(join(INSTALL_DIR, 'hook.mjs'), join(ZHFIX_DIR, 'hook.mjs'))
ok(`基础设施装到 ${ZHFIX_DIR}`)

// 4. 调 cli.mjs init
info('')
const initRes = spawnSync('node', [join(ZHFIX_DIR, 'cli.mjs'), 'init', TOOL_ROOT], {
  stdio: 'inherit', shell: false,
})
if (initRes.status !== 0) fail(`zhfix init 失败`)

info('')
info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
ok(`🎉 安装完成!下面是你需要知道的:`)
info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
info('')
info('【接下来怎么用】')
info('')
info('  你什么都不用做。 重启 Claude Code 后,继续正常用 ——')
info('  Claude 每次写完 .md / .html 文件时,工具会在后台自动')
info('  把中文段落里的半角标点(, . ? ! 等)改成全角。')
info('')
info('【会改成什么样】')
info('')
info('  写入:  你好,世界.这是一个测试,带边界(英文),还有.')
info('  落盘:  你好，世界。这是一个测试，带边界 (英文)，还有。')
info('')
info('【常用命令】')
info('')
info('  zhfix status     看 hook 是否启用 + 当前目录是否暂停 + 今日活动')
info('  zhfix pause      当前目录不想被处理(英文文档 / 代码示例等)')
info('  zhfix resume     恢复处理')
info('  zhfix uninstall  卸载')
info('')
info('【出问题】')
info('')
info('  - 想看 trace:日志在 ~/.claude/zh-fix.log')
info('  - 紧急关闭:看 tool/EMERGENCY-OFF.md')
info('')
info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
info('重启 Claude Code,完事了。')
info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
