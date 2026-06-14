# zh-fix

<p align="center">
  <img src="docs/assets/header.png" alt="zh-fix" width="100%">
</p>

## 省流版

**这是什么**：Claude Code 写中文文档 (`.md`/`.html`) 时，自动把里面的半角标点换成全角。

**前提**：你用 [Claude Code](https://claude.com/claude-code)。不用 Claude Code 的话，这工具不会自动触发 (可以手动 `node tool/zh-fix.mjs <file>`，但意义不大)。

```
before: 你好,世界.这是一个测试,带边界(英文),还有.
after:  你好，世界。这是一个测试，带边界 (英文)，还有。
```

**怎么安装**(两条命令)：

```powershell
npm i -g zhfix     # 装命令本体 + 依赖，源码进全局 node_modules，工作区零残留
zhfix install      # 接入 Claude Code
```

不想敲命令，把这句发给你的 AI agent：

> 帮我装一下 zhfix(npm i -g zhfix 再 zhfix install)，装好告诉我怎么用

**如何使用**：装完重启 Claude Code, **正常情况下完全不用管** ——每次写完 `.md` / `.html`,hook 在后台自动跑完。

如有需要，以下命令可以主动用：

```
# Claude Code 里(对已有文件主动跑一次,改前自动备份)
/zhfix <文件>            说"改 prd.md 的标点"这种自然语言也会触发

# 终端(任意位置)
zhfix status            看 hook 是否启用 + 当前目录是否暂停 + 今日活动
zhfix pause             当前目录暂停(写英文文档或代码示例时)
zhfix resume            恢复当前目录(撤销 pause)
zhfix uninstall         卸载接入(再跑 npm uninstall -g zhfix 删本体)
```

完整命令清单 `zhfix help`(还有 `restore` `clear-backups` 等不常用的)。

> 出问题了？→ 见 [`tool/EMERGENCY-OFF.md`](tool/EMERGENCY-OFF.md)，或直接 `zhfix uninstall`。

---

## 详细说明

中文标点自动修正——给 Claude Code(以及任何会写 `.md`/`.html` 的 AI agent) 挂一个 PostToolUse hook，写完文件自动把中文里的半角标点改成全角。

基于 [AutoCorrect](https://github.com/huacnlee/autocorrect) 之上的薄包装层，补它的硬缺口 (`;` `:` 边界 `,` 等)，并加上安全、日志、暂停/恢复等运维特性。

## 是什么 / 不是什么

- ✅ 给 `.md`/`.markdown`/`.html`/`.htm` 用，Claude Code Hook 自动触发
- ✅ AutoCorrect 漏改的 `;` `:` 边界 `,` 都补上
- ✅ 安全：不破 markdown 结构、不破 HTML `<script>` 里的 JS、不动代码块/URL/属性值
- ✅ 可暂停：某个目录不想被处理，`cd` 过去 `zhfix pause`
- ✅ 全程日志，出问题能 trace
- ❌ 不改纯英文文档、纯代码、纯数字
- ❌ 不强加西式弯引号 `""`(尊重 Claude 自己的引号风格 `「」` `""` 等)

实测命中率：同一份 PRD 跑一次，**autocorrect 单跑残留 32 处 → autocorrect + zh-fix 残留 5 处**(修正率 84%)，后续真实场景接近 0 残留。

## 怎么装

```powershell
npm i -g zhfix     # ① 装命令本体，autocorrect 依赖随包自动装，源码进全局 node_modules，工作区零残留
zhfix install      # ② 接入 Claude Code
```

`zhfix install` 干的事：
1. 定位包自身的 `tool/`(全局 node_modules 内)，写进 `~/.zhfix/config.json`
2. 把 hook 路由 `hook.mjs` 放进 `~/.zhfix/`
3. 配 Claude Code 的 PostToolUse hook(`~/.claude/settings.json`)
4. 装 `/zhfix` skill 到 `~/.claude/skills/`

装完重启 Claude Code，试着写一份中文 `.md`，半角标点会自动变全角。

> `zhfix` 命令由 npm 在 `npm i -g` 时自动挂到全局 bin(PATH 已有)。`tool/zh-fix.mjs` 用 `import { formatFor } from 'autocorrect-node'` **in-process** 调用，无子进程开销、无 PATH 劫持风险。autocorrect-node 是声明式 npm 依赖，随 zhfix 包从 npm 官方仓库下载，不打包源码。
>
> 开发者想从 repo 本地装 (改代码时)：repo 根目录 `node install/install.mjs`，再 `npm link` 拿全局命令。

## zhfix 命令

```
zhfix install                    首次接入 Claude Code(npm i -g zhfix 之后跑这个)
zhfix init [tool 路径]           重新绑定 / 修复配置(默认指向包自身 tool)
zhfix pause                      暂停当前目录(及子目录)
zhfix resume                     恢复当前目录的自动处理(撤销 pause)
zhfix status                     看配置 / 暂停列表 / 今日活动
zhfix restore <文件>             还原指定文件到上次 /zhfix 改之前的备份
zhfix clear-backups [--yes]      清掉所有"普通备份"(pre-restore 默认保留)
zhfix uninstall [--all]          卸载接入;--all 清日志和备份配置(删本体另跑 npm uninstall -g zhfix)
zhfix help                       帮助
```

> **`zhfix uninstall` 默认会删 `~/.zhfix/`，里面的备份会一起没**。如果想保留某些备份做长期归档，提前 `cp` 出来。

### 卸载是两步

```powershell
zhfix uninstall            # ① 清接入:settings hook、bash 包装、~/.zhfix/、/zhfix skill
npm uninstall -g zhfix     # ② 删本体:zhfix 命令 + tool 源 + autocorrect 依赖
```

先 ① 再 ②——因为卸了本体 `zhfix` 命令就没了。

### `zhfix init` 是干啥的

首次接入由 `zhfix install` 完成 (定位包内 tool、写配置、配 hook、装 skill)。
**之后你日常用不到 init**。会用到 `zhfix init` 的几种场景：

| 场景 | 操作 |
|---|---|
| 把 tool 指到别处 (开发时指向 repo) | `zhfix init <新路径>` 改 config 指向新位置 |
| 换电脑 | 直接重装：`npm i -g zhfix && zhfix install` |
| `settings.json` 被手改坏了 | `zhfix init` 重新写一遍 hook 段 |
| `~/.zhfix/config.json` 被误删 | `zhfix init` 重建 (默认指向包自身 tool) |

它只重写"指针"层 (config + hook 包装 + settings.json + hook.mjs)，**不动 autocorrect、不动 tool 源、不动暂停列表**。可以安心反复跑。

## 仓库结构

```
.
├── README.md           (你正在读)
├── AGENTS.md           AI agent 安装指南
├── LICENSE             MIT
├── package.json        元数据 + bin(zhfix 命令) + autocorrect 依赖声明
├── tool/               核心处理代码(随 npm 包发布)
│   ├── zh-fix.mjs      主程序
│   ├── mask.mjs        跳过区域引擎
│   ├── rules/          补丁规则(semicolon, boundary, cjk-surround, cjk)
│   └── EMERGENCY-OFF.md 紧急关闭指南
├── install/            安装/命令层(随 npm 包发布)
│   ├── install.mjs     开发模式入口(从 repo 本地装)
│   ├── cli.mjs         zhfix 命令实现(npm bin 入口)
│   └── hook.mjs        hook 路由(装时复制到 ~/.zhfix/，读 config 找 tool + 检查 pause)
└── docs/assets/        头图等静态资源(不随 npm 包发布)
```

## 架构

```
Claude Code 写 .md/.html
         ↓
PostToolUse hook (matcher: Write|Edit|MultiEdit)
         ↓
~/.claude/hooks/zh-fix-auto.sh    (bash 包装,内容固定)
         ↓
~/.zhfix/hook.mjs                  (路由层:读 config,检查 pause)
         ↓
<tool_root>/zh-fix.mjs             (实际处理)
         ├─ 1. 安全 + 扩展名 + 大小检查
         ├─ 2. opt-out 文件首行 <!-- zh-fix: off -->
         ├─ 3. 调 autocorrect --fix
         ├─ 4. 读回 + 算 mask 跳过区
         ├─ 5. 跑补丁规则
         └─ 6. 原子改名写回
```

搬 tool 路径？重跑 `zhfix init <新路径>`。其他都不用动。

## 日志 + 调试

每次 hook 跑都写一行到 `~/.claude/zh-fix.log`：

```
2026-06-14T10:30:15.000Z  OK <file>: +12 chars     # 改了 12 处
2026-06-14T10:30:20.000Z  AC_FAIL <file>: ...      # autocorrect 失败
2026-06-14T10:30:25.000Z  SKIP <file>: opt-out     # 文件首行 opt-out
2026-06-14T10:30:30.000Z  PAUSED <file>            # 路径在 paused_paths
2026-06-14T10:30:35.000Z  AC_ONLY <file>           # autocorrect 改了,我们没追加改
2026-06-14T10:30:40.000Z  REJECT <file>: ...       # 安全拒绝(危险字符 / UNC 等)
```

`zhfix status` 把今天的活动按 tag 聚合显示。

## 安全 (对抗审查后做的加固)

- `autocorrect` 绝对路径调用，避免 PATH 劫持
- 不用 `shell:true`，Windows cmd 注入不可能
- file_path 白名单：拒绝 `< > " | & ^ \` $`、`\x00`、UNC `\\...`、非绝对路径、symlink
- 大文件 (>100MB)、不支持扩展名 → 静默退出
- 写文件用随机临时名 + 原子改名；失败清理 tmp
- 任何异常 → 写日志 + `exit 0`，绝不阻塞 Claude

## 已知缺口

- HTML `placeholder=` / `title=` / `alt=` 等属性值不改 (AutoCorrect 行为，我们也跳过)
- `中文:英文` / `中文 ; 英文`(右侧非 CJK 的边界)autocorrect 偶尔漏，我们也不强求
- 强加全角括号 `(中文)` → `(中文)`：品味问题，目前不做

## 不要做的事

- ❌ **不要随便升级 autocorrect-node**。zh-fix 的补丁规则是基于 2.14.0 的行为写的，升级可能变成"双重改动"或"反向破坏"。升级前在自己的真实文档样本上跑一遍验证残留可接受。
- ❌ **不要手改** `~/.claude/hooks/zh-fix-auto.sh` 或 `~/.zhfix/` 里的内容，重跑 `zhfix init` 会覆盖。
- ❌ **不要把 tool 路径写进 hook 包装脚本**，设计就是解耦的，通过 `~/.zhfix/config.json` 解析。

## License

MIT
