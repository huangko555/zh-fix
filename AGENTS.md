# 安装指南 (给 AI Agent 看)

你正在帮一位用户安装 zhfix。这是一个 Claude Code PostToolUse hook 工具，自动把中文文档里的半角标点修正成全角。

## 装之前先检查这几项 (Pre-flight)

**任何一项失败，先告诉用户，不要直接装。** AI 闷头跑失败后再瞎修代价更高。

| 检查项 | 命令 | 失败时怎么说 |
|---|---|---|
| Node ≥ 18 | `node --version` | "需要 Node 18 或以上，请先升级 Node" |
| npm 可用 | `npm --version` | "npm 没装好，检查 Node 安装" |
| Git Bash(仅 Windows)| Windows 上 `bash --version`；非 Win 跳过 | "Windows 上 hook 需要 bash，请装 Git for Windows (https://git-scm.com/download/win)" |
| Claude Code 已装 | 看 `~/.claude/` 目录是否预先存在 | "没检测到 Claude Code(`~/.claude/` 不存在)。zhfix 是给 Claude Code 用的 hook，没装 Claude Code 这工具不会触发。建议先装好 Claude Code，或确认你确实要继续 (我们仍会装，但 hook 不会自动跑)。" |
| 平台 prebuilt 支持 | 看 platform/arch | autocorrect-node 当前 prebuilt 覆盖:Win-x64、macOS-x64、macOS-arm64、Linux-x64-gnu。**不覆盖 Linux musl(Alpine) 和 Linux arm64**。那些用户 `npm i -g zhfix` 会失败，提示他们装 Rust 工具链自己编或换镜像 |

## 安装 (两条命令)

```bash
npm i -g zhfix     # 装命令本体 + autocorrect 依赖(随包自动装)
zhfix install      # 接入 Claude Code
```

`zhfix install` 做了什么：

1. 定位包自身的 `tool/`(全局 node_modules 内)，写进 `~/.zhfix/config.json`
2. 把 hook 路由 `hook.mjs` 复制到 `~/.zhfix/`
3. 写 `~/.claude/hooks/zh-fix-auto.sh`(bash 包装，内容固定)
4. 把 PostToolUse hook merge 进 `~/.claude/settings.json`(已有就不重复)
5. 装 `/zhfix` skill 到 `~/.claude/skills/zhfix/`

> `zhfix` 命令由 npm 在 `npm i -g` 时自动挂到全局 bin(PATH 已有)，不用手动配。
> `tool/zh-fix.mjs` 通过 `import { formatFor } from 'autocorrect-node'` **in-process** 调用 autocorrect，不再 spawn 子进程。autocorrect-node 作为 npm 依赖声明在 `package.json`，随 zhfix 包一起从 npm 下载，不打包源码。
>
> 开发者想从 repo 本地装 (改代码时)：repo 根目录 `node install/install.mjs`，再 `npm link` 拿到全局命令。

## 验证

```bash
zhfix status
```

期望全部 ✅。如果 `zhfix` 没找到，多半是 npm 全局 bin 不在 PATH，或装完没重开终端。先重开终端重试；还不行就 `npm prefix -g` 看全局 bin 路径在不在 PATH 里。

## 完成后告诉用户 (重要)

`zhfix install` 跑完会自己打印一段"使用说明"。你**必须把这段内容转述给用户**(可以引用，可以改写，但核心点都要传达)。用户不会主动去看终端输出。

要确保传达到用户的几点 (直接说，不要用复杂术语)：

### 1. 装好了，什么都不用做

> "装完了，你**不用主动触发任何操作**。重启 Claude Code 之后，继续正常用就行。每次我 (或别的 Claude) 写 `.md` / `.html` 文件时，工具会在后台自动把中文段落里的半角标点改成全角。"

### 2. 效果直观演示

> "举个例子，如果我写出 `你好,世界.`，落到磁盘上会变成 `你好，世界。`。"

### 3. 常用命令 (在终端任意位置都能用)

| 命令 | 干啥 |
|---|---|
| `zhfix status` | 看 hook 是否启用 + 当前目录是否暂停 + 今日活动统计 |
| `zhfix pause` | 当前目录不想被处理 (英文文档 / 代码示例等)，`cd` 过去再跑这条 |
| `zhfix resume` | 恢复当前目录的自动处理 (撤销之前的 `zhfix pause`) |
| `zhfix restore <文件>` | 把指定文件还原到 /zhfix 改之前的备份 |
| `zhfix uninstall` | 卸载接入 (删本体再 `npm uninstall -g zhfix`) |

### 4. Claude Code 斜杠命令 (改单个已有文档)

`/zhfix <文件>` —— 把单个 `.md/.html` 文件用 zh-fix 规则改一遍标点。
也可以自然语言触发，例如：**"帮我把 prd.md 改成中文标点"**、**"改一下 docs/api.md 的半角逗号"**。

- 改前自动备份到 `~/.zhfix/backups/`，事后用 `zhfix restore` 还原
- 必须指定单个文件，不接受目录或批量
- 必须明确提到"标点 / 全角 / 半角 / 逗号 / 句号" 等关键词才主动触发 (避免对"改一下"这种泛改请求误触发)

### 5. 出问题怎么办

- 日志在 `~/.claude/zh-fix.log`，每次工具跑都会记一行，可以 trace
- 紧急关闭：看 `tool/EMERGENCY-OFF.md`

### 6. **提醒用户重启 Claude Code**

不重启 hook 不生效，`/zhfix` skill 也是。这是装完唯一需要他做的事。

## 常见问题

### `autocorrect-node` 没装好 (npm i -g 时失败)

autocorrect-node 是随 zhfix 包一起装的。失败就重跑：

```bash
npm i -g zhfix
```

如果还失败，常见原因：
- 网络不通 npm registry — 配代理或镜像 (`npm config set registry https://registry.npmmirror.com`)
- 平台二进制不存在 — autocorrect-node 是 NAPI 原生模块，需要对应平台的 .node binary

**注意**：不要改 `package.json` 里 autocorrect-node 的版本号。zh-fix 的规则是基于 2.14.0 的行为写的，升级前要在测试样本上跑一遍验证。

### `zhfix: command not found`

确认 npm 全局 bin 在 PATH:

```bash
npm prefix -g    # 看路径
echo $PATH       # 确认这个路径(Windows 上是这个路径本身;Linux/Mac 是它下面的 bin/)在内
```

不在的话，重开终端再试 (装完 PATH 没刷新)；还不行就把 npm 全局 bin 加到 PATH。

### Claude Code hook 不触发

1. 确认 Claude Code **重启过** — settings.json 改完不重启 hook 不加载
2. `zhfix status` 看 "hook 已注册" 是不是 ✅
3. 看 `~/.claude/zh-fix.log` 有没有日志写入

### 卸装 (两步)

```bash
zhfix uninstall            # ① 清接入:settings hook、bash 包装、~/.zhfix/、/zhfix skill
npm uninstall -g zhfix     # ② 删本体:zhfix 命令 + tool 源 + autocorrect 依赖
```

先 ① 再 ②——卸了本体 `zhfix` 命令就没了。

`zhfix uninstall` 会清掉：
- `settings.json` 里的 PostToolUse hook
- `~/.claude/hooks/zh-fix-auto.sh`
- `~/.zhfix/` 整个目录 (config + 复制进去的 hook.mjs + backups)
- `/zhfix` skill

默认保留 `~/.claude/zh-fix.log`(历史日志)；加 `--all` 连日志和 settings 备份一起清。
backups 默认搬到 `~/.zhfix-backups-saved-*` 保留，加 `--purge-backups` 才一并删。

`npm uninstall -g zhfix` 删掉包本体 (命令 + tool 源 + autocorrect 依赖)。

## 你不需要做的事

- ❌ 不要手改 `~/.claude/settings.json`(`zhfix install` 会处理)
- ❌ 不要把 tool 路径写进 hook 包装脚本 (已经解耦，通过 config 解析)
- ❌ 不要升级 autocorrect-node(规则是基于当前版本的行为补的)

## 仓库结构

```
.
├── README.md           人看的
├── AGENTS.md           本文件(你正在读)
├── LICENSE             MIT
├── package.json        bin(zhfix 命令) + autocorrect 依赖声明
├── tool/               实际处理代码(随 npm 包发布)
│   ├── zh-fix.mjs      主程序(被 hook 调)
│   ├── mask.mjs        跳过区域引擎
│   ├── rules/          补丁规则
│   └── EMERGENCY-OFF.md 紧急关闭指南
└── install/            安装/命令层(随 npm 包发布)
    ├── install.mjs     开发模式入口(从 repo 本地装)
    ├── cli.mjs         zhfix 命令实现(npm bin 入口)
    └── hook.mjs        hook 路由(装时复制到 ~/.zhfix/，读 config 找 tool + 检查 pause)
```
