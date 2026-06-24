#!/usr/bin/env node
// installer/install.mjs —— 开发模式入口(从 repo 本地装)
// 普通用户用 `npm i -g zhfix && zhfix install`,不走这里。
// 本脚本:preflight + 在 repo 内本地装 autocorrect-node + 调 cli.mjs install 接入 Claude Code。
// 用法:在 repo 根目录 `node install/install.mjs`(如需全局 zhfix 命令,再 `npm link`)

// Node 24+ 对 cmd.exe→.cmd 子链有误报的 DEP0190 警告,压制
process.removeAllListeners('warning')
process.on('warning', (w) => { if (w.code !== 'DEP0190') console.warn(w) })

import { existsSync } from 'node:fs'
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

// Windows 上 bash hook 强依赖 Git Bash,先检测(排除 WSL 的 System32\bash.exe,路径风格不兼容)
if (IS_WIN) {
  const bashCheck = spawnSync('cmd.exe', ['/d', '/s', '/c', 'where', 'bash'], { encoding: 'utf-8', shell: false })
  const bashPaths = (bashCheck.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const gitBash = bashPaths.find(p => !/\\System32\\bash\.exe$/i.test(p))
  if (!gitBash) {
    fail(bashPaths.length > 0
      ? `检测到的 bash 是 WSL 的(System32\\bash.exe),路径风格跟 hook 用的 Git Bash 不兼容。
请装 Git for Windows:https://git-scm.com/download/win`
      : `Windows 上 hook 需要 bash(Git for Windows 自带),没检测到。
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

// 3. 接入 Claude Code:调 cli.mjs 的 install 流程
//    cli.mjs 自己会写 config、装 skill,并清掉 0.1.x/0.2.0 残留的 hook 注册,
//    并定位到 repo 自身的 tool/(传 TOOL_ROOT)。命令本体由 npm / npm link 提供,这里不再手动复制 cli.mjs。
info('')
const initRes = spawnSync('node', [join(INSTALL_DIR, 'cli.mjs'), 'install', TOOL_ROOT], {
  stdio: 'inherit', shell: false,
})
if (initRes.status !== 0) fail(`接入失败`)

info('')
info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
info('repo 本地装完成(开发模式)。使用说明由上面的 zhfix install 打印。')
info('如果想在任意目录直接敲 zhfix 命令,在本 repo 根目录再跑一次:')
info('  npm link')
info('(普通用户不用——他们 npm i -g zhfix 就自带命令了)')
info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
