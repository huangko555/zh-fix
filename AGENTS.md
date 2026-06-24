# 安装指南 (给 AI Agent 看)

你正在帮一位用户安装 zhfix。0.3.0 起这是个**纯用户主动触发**的工具：装个 `/zhfix` skill 到 Claude Code，用户说 `/zhfix prd.md` 或"把 prd.md 改成中文标点"，Claude 才去改。**不再自动改任何文件**，没有 hook，没有"写完自动转标点"那套。

## 装之前先检查这几项 (Pre-flight)

**任何一项失败，先告诉用户，不要直接装。** AI 闷头跑失败后再瞎修代价更高。

| 检查项 | 命令 | 失败时怎么说 |
|---|---|---|
| Node ≥ 18 | `node --version` | "需要 Node 18 或以上，请先升级 Node" |
| npm 可用 | `npm --version` | "npm 没装好，检查 Node 安装" |
| Claude Code 已装 | 看 `~/.claude/` 目录是否预先存在 | "没检测到 Claude Code(`~/.claude/` 不存在)。zhfix 的 `/zhfix` skill 是给 Claude Code 用的，没装 Claude Code 用不上。建议先装好 Claude Code，或确认你确实要继续 (skill 落地了但不会有任何效果)。" |
| 平台 prebuilt 支持 | 看 platform/arch | autocorrect-node 当前 prebuilt 覆盖：Win-x64、macOS-x64、macOS-arm64、Linux-x64-gnu。**不覆盖 Linux musl(Alpine)、Linux arm64、Windows arm64**。那些用户 `npm i -g zhfix` 会失败，提示他们装 Rust 工具链自己编或换镜像 |

> 0.1.x/0.2.0 需要的 Git Bash 检测，0.3.0 起**不再需要** —— hook 没了，Windows 上 `zhfix` 命令直接走 npm 全局 bin。

## 安装 (两条命令)

```bash
npm i -g zhfix     # 装命令本体 + autocorrect 依赖
zhfix install      # 装 /zhfix skill 到 Claude Code + 写 config
```

`zhfix install` 做了什么：

1. 定位包自身的 `tool/`(全局 node_modules 内)，写进 `~/.zhfix/config.json`(给 `/zhfix` skill 用)
2. 装 `/zhfix` skill 到 `~/.claude/skills/zhfix/`
3. **自动清理**`~/.claude/settings.json` 里 0.1.x/0.2.0 残留的 hook 注册 (PreToolUse / PostToolUse 里指向 `zh-fix-auto.sh` 的条目)
4. **自动删除** `~/.claude/hooks/zh-fix-auto.sh` 旧 bash 包装 (如果有)

> `zhfix` 命令由 npm 在 `npm i -g` 时自动挂到全局 bin(PATH 已有)，不用手动配。
> `tool/zh-fix.mjs` 通过 `import { formatFor } from 'autocorrect-node'` **in-process** 调用 autocorrect。autocorrect-node 作为 npm 依赖随 zhfix 包一起从 npm 下载。
>
> 开发者想从 repo 本地装 (改代码时)：repo 根目录 `node install/install.mjs`，再 `npm link` 拿到全局命令。

## 验证

```bash
zhfix status
```

期望：
- `tool 存在: ✅`
- `skill 已装: ✅`
- `PATH 命令: ✅`
- 没有 "检测到旧版残留" 的 warning(如果有，说明清理没成功，跑 `zhfix init` 再试)

`zhfix` 没找到多半是 npm 全局 bin 不在 PATH。先重开终端；还不行就 `npm prefix -g` 看全局 bin 路径在不在 PATH 里。

## 完成后告诉用户 (重要)

`zhfix install` 跑完会自己打印一段"使用说明"。你**必须把这段内容转述给用户**，他不会主动去看终端输出。

要传达给用户的几点 (直接说，不要用复杂术语)：

### 1. 装好了，但**不会自动改任何东西**

> "装完了。0.3.0 起 zhfix **不会主动改任何文件** —— 跟 0.1.x/0.2.0 不一样，现在只有你明确说 `/zhfix prd.md` 或'把 prd.md 改成中文标点'，Claude 才会去改那一个文件。"

### 2. 怎么用 `/zhfix`

> "在 Claude Code 里这样说：
> - `/zhfix prd.md`
> - 或者：'把 prd.md 改成中文标点'
> - 或者：'修一下 docs/api.md 的半角逗号'
>
> Claude 会调 `/zhfix` skill 改那个文件，改前自动备份。不满意跑 `zhfix restore prd.md` 还原。"

### 3. 常用命令 (在终端任意位置都能用)

| 命令 | 干啥 |
|---|---|
| `zhfix status` | 看 skill 是否装好 + 旧版残留检测 + 今日活动 |
| `zhfix restore <文件>` | 把指定文件还原到 `/zhfix` 改之前的备份 |
| `zhfix update` | 升到 npm 最新版并刷新接入 (自动清旧 hook 残留) |
| `zhfix uninstall` | 卸接入 (之后再 `npm uninstall -g zhfix` 删本体) |

### 4. 出问题怎么办

- 日志在 `~/.claude/zh-fix.log`，每次 `/zhfix` 跑都会记一行，可以 trace
- `/zhfix` 不触发 → 确认重启过 Claude Code(skill 要重启才加载)

### 5. **提醒用户重启 Claude Code**

不重启 `/zhfix` skill 不生效。这是装完唯一需要他做的事。

## 从老版本升级 (给 AI 的迁移指南)

如果用户当前装的是 0.1.x 或 0.2.0(有自动 hook)，让他跑一行：

```bash
zhfix update
```

这会：
1. `npm i -g zhfix@latest` 拉最新版
2. 跑 `zhfix init`(0.3.0 版)，它会：
   - 扫 `~/.claude/settings.json`，删 `PreToolUse` / `PostToolUse` 里所有指向 `zh-fix-auto.sh` 的条目
   - 删 `~/.claude/hooks/zh-fix-auto.sh` 文件本身
   - 重写 `~/.zhfix/config.json`(去掉旧的 `paused_paths` / `protocol_version` 字段)
   - 重装 `/zhfix` skill

跑完重启 Claude Code，确认 `zhfix status` 不再显示 "检测到旧版残留"。

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

不在的话，重开终端再试；还不行就把 npm 全局 bin 加到 PATH。

### `/zhfix` skill 不触发

1. 确认 Claude Code **重启过** — skill 改完不重启不加载
2. `zhfix status` 看 `skill 已装: ✅`
3. 用户的描述必须**明确提到**标点 / 全角 / 半角 + 单个文件名才会触发 (避免对"改一下 prd.md"这种泛改请求误触发)；见 `skills/zhfix/SKILL.md` 里的触发条件

### 卸载 (两步)

```bash
zhfix uninstall            # ① 清接入:config、/zhfix skill、settings hook 残留
npm uninstall -g zhfix     # ② 删本体:zhfix 命令 + tool 源 + autocorrect 依赖
```

先 ① 再 ② —— 卸了本体 `zhfix` 命令就没了。

`zhfix uninstall` 会清掉：
- `settings.json` 里残留的 PreToolUse / PostToolUse zh-fix 注册 (如果 0.1.x/0.2.0 升上来的)
- `~/.claude/hooks/zh-fix-auto.sh`(如果还在)
- `~/.zhfix/` 整个目录 (config + backups)
- `/zhfix` skill

默认保留 `~/.claude/zh-fix.log`(历史日志)；加 `--all` 连日志和 settings 备份一起清。
backups 默认搬到 `~/.zhfix-backups-saved-*` 保留，加 `--purge-backups` 才一并删。

`npm uninstall -g zhfix` 删掉包本体 (命令 + tool 源 + autocorrect 依赖)。

## 你不需要做的事

- ❌ 不要手改 `~/.claude/settings.json`(0.3.0 不再注入任何 hook;升级时 `zhfix init` 会清理旧的)
- ❌ 不要升级 autocorrect-node(规则是基于 2.14.0 的行为补的)

## 仓库结构 (0.3.0)

```
.
├── README.md           人看的
├── AGENTS.md           本文件(你正在读)
├── LICENSE             MIT
├── package.json        bin(zhfix 命令) + autocorrect 依赖声明
├── tool/               核心处理代码(随 npm 包发布)
│   ├── zh-fix.mjs      主程序(被 /zhfix skill 通过 CLI 调)
│   ├── mask.mjs        跳过区域引擎
│   ├── rules/          补丁规则(semicolon / boundary / cjk-surround / attr-text)
│   └── EMERGENCY-OFF.md 紧急关闭指南
├── skills/             /zhfix skill 源(随 npm 包发布)
│   └── zhfix/SKILL.md  skill 定义(装到 ~/.claude/skills/zhfix/)
└── install/            安装/命令层(随 npm 包发布)
    ├── install.mjs     开发模式入口(从 repo 本地装)
    └── cli.mjs         zhfix 命令实现(npm bin 入口)
```
