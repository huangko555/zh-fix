# 安装指南 (给 AI Agent 看)

你正在帮一位用户安装 zh-fix。这是一个 Claude Code PostToolUse hook 工具，自动把中文文档里的半角标点修正成全角。

## 装之前先检查这几项 (Pre-flight)

**任何一项失败，先告诉用户，不要直接跑 installer。** AI 闷头跑失败后再瞎修代价更高。

| 检查项 | 命令 | 失败时怎么说 |
|---|---|---|
| Node ≥ 18 | `node --version` | "需要 Node 18 或以上，请先升级 Node" |
| npm 可用 | `npm --version` | "npm 没装好，检查 Node 安装" |
| Git Bash(仅 Windows)| Windows 上 `bash --version`；非 Win 跳过 | "Windows 上 hook 需要 bash，请装 Git for Windows (https://git-scm.com/download/win)" |
| Claude Code 已装 | 看 `~/.claude/` 目录是否预先存在 | "没检测到 Claude Code(`~/.claude/` 不存在)。zh-fix 是给 Claude Code 用的 hook，没装 Claude Code 这工具不会触发。建议先装好 Claude Code，或确认你确实要继续 (我们仍会装，但 hook 不会自动跑)。" |
| 平台 prebuilt 支持 | 看 platform/arch | autocorrect-node 当前 prebuilt 覆盖:Win-x64、macOS-x64、macOS-arm64、Linux-x64-gnu。**不覆盖 Linux musl(Alpine) 和 Linux arm64**。那些用户 `npm install` 会失败，提示他们装 Rust 工具链自己编或换镜像 |

## 安装 (一条命令)

在 repo 根目录：

```bash
node install/install.mjs
```

这条命令做了什么：

1. 检查 Node 版本 ≥ 18
2. **本地** `npm install`(在 repo 内，把 `autocorrect-node@2.14.0` 装到 `node_modules/`,**不装全局**)
3. 把 `install/cli.mjs` 和 `install/hook.mjs` 复制到 `~/.zhfix/`
4. 调 `~/.zhfix/cli.mjs init <repo>/tool/` 完成余下：
   - 写 `~/.zhfix/config.json`(指 tool 位置)
   - 写 `~/.claude/hooks/zh-fix-auto.sh`(bash 包装，内容固定)
   - 把 PostToolUse hook merge 进 `~/.claude/settings.json`(已有就不重复)
   - 在 npm 全局 bin 装 `zhfix` 命令 (.cmd + 无扩展名 sh 两份)

> `tool/zh-fix.mjs` 通过 `import { formatFor } from 'autocorrect-node'` **in-process** 调用 autocorrect，不再 spawn 子进程。autocorrect-node 作为 npm 依赖声明在 `package.json`，从 npm 官方仓库下载，我们的 repo 里不打包它的源码。

## 验证

```bash
zhfix status
```

期望全部 ✅。如果 `zhfix` 没找到，可能 npm 全局 bin 不在 PATH。fallback:

```bash
node ~/.zhfix/cli.mjs status
```

## 完成后告诉用户 (重要)

installer 跑完会自己打印一段"使用说明"。你**必须把这段内容转述给用户**(可以引用，可以改写，但核心点都要传达)。用户不会主动去看终端输出。

要确保传达到用户的几点 (直接说，不要用复杂术语):

### 1. 装好了，什么都不用做

> "装完了，你**不用主动触发任何操作**。重启 Claude Code 之后，继续正常用就行。每次我 (或别的 Claude) 写 `.md` / `.html` 文件时，工具会在后台自动把中文段落里的半角标点改成全角。"

### 2. 效果直观演示

> "举个例子，如果我写出 `你好,世界.`，落到磁盘上会变成 `你好，世界。`。"

### 3. 常用命令 (在终端任意位置都能用)

| 命令 | 干啥 |
|---|---|
| `zhfix status` | 看 hook 是否启用 + 当前目录是否暂停 + 今日活动统计 |
| `zhfix pause` | 当前目录不想被处理 (英文文档 / 代码示例等),`cd` 过去再跑这条 |
| `zhfix resume` | 恢复处理 |
| `zhfix uninstall` | 卸载 |

### 4. 出问题怎么办

- 日志在 `~/.claude/zh-fix.log`，每次工具跑都会记一行，可以 trace
- 紧急关闭：看 `tool/EMERGENCY-OFF.md`

### 5. **提醒用户重启 Claude Code**

不重启 hook 不生效。这是装完唯一需要他做的事。

## 常见问题

### `autocorrect-node` 没装好 (npm install 失败)

回到 repo 根目录，手动跑：

```bash
npm install
```

如果失败，常见原因：
- 网络不通 npm registry — 配代理或镜像 (`npm config set registry https://registry.npmmirror.com`)
- 平台二进制不存在 — autocorrect-node 是 NAPI 原生模块，需要对应平台的 .node binary

**注意**：不要改 `package.json` 里 autocorrect-node 的版本号。zh-fix 的规则是基于 2.14.0 的行为写的，升级前要在测试样本上跑一遍验证。

### `zhfix: command not found`

确认 npm 全局 bin 在 PATH:

```bash
npm prefix -g    # 看路径
echo $PATH       # 确认这个路径(Windows 上是这个路径本身;Linux/Mac 是它下面的 bin/)在内
```

不在的话，fallback 直接调 `node ~/.zhfix/cli.mjs <command>`，或者把 npm bin 加到 PATH。

### Claude Code hook 不触发

1. 确认 Claude Code **重启过** — settings.json 改完不重启 hook 不加载
2. `zhfix status` 看 "hook 已注册" 是不是 ✅
3. 看 `~/.claude/zh-fix.log` 有没有日志写入

### 卸装

```bash
zhfix uninstall
```

会清掉：
- `settings.json` 里的 PostToolUse hook
- `~/.claude/hooks/zh-fix-auto.sh`
- `zhfix` PATH 命令
- `~/.zhfix/` 整个目录

留下不动：
- `autocorrect-node`(npm 包)— 如果不再用，运行 `npm uninstall -g autocorrect-node`
- 工具源 `tool/` 目录 — 用户自己决定
- `~/.claude/zh-fix.log` — 历史日志，留着可查

## 你不需要做的事

- ❌ 不要手改 `~/.claude/settings.json`(installer 会处理)
- ❌ 不要把 tool 路径写进 hook 包装脚本 (已经解耦，通过 config 解析)
- ❌ 不要升级 autocorrect-node(规则是基于当前版本的行为补的)

## 仓库结构

```
.
├── README.md           人看的
├── AGENTS.md           本文件(你正在读)
├── LICENSE             MIT
├── tool/               实际处理代码
│   ├── zh-fix.mjs      主程序(被 hook 调)
│   ├── mask.mjs        跳过区域引擎
│   ├── rules/          补丁规则
│   └── EMERGENCY-OFF.md 紧急关闭指南
├── install/            安装层源文件
│   ├── install.mjs     安装器入口
│   ├── cli.mjs         → ~/.zhfix/cli.mjs(zhfix 命令)
│   └── hook.mjs        → ~/.zhfix/hook.mjs(hook 路由)
└── docs/               研究归档(可读但与运行无关)
    └── research/       zhlint / autocorrect 对比试验材料
```
