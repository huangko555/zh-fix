# zh-fix

<p align="center">
  <img src="docs/assets/header.png" alt="zh-fix" width="100%">
</p>

Claude Code 里改单个 `.md` / `.html` 的中文标点 —— 半角换全角，加盘古空格，跳过代码/URL/HTML。

```
before: 你好,世界.这是一个测试,带边界(英文),还有.
after:  你好，世界。这是一个测试，带边界 (英文)，还有。
```

需要 [Claude Code](https://claude.com/claude-code) —— 它装个 `/zhfix` skill，你说 `/zhfix prd.md` 或者 "把 prd.md 改成中文标点"，Claude 就会调它去改。**不会自动改任何文件**，只有你明说才动手。

## 安装

推荐直接让 AI 代劳 —— 把这句发给你的 Claude Code:

> 帮我装一下 zhfix(npm i -g zhfix 再 zhfix install)，装好告诉我怎么用

想自己敲也行，两条命令：

```powershell
npm i -g zhfix     # 装命令 + 依赖
zhfix install      # 装 /zhfix skill 到 Claude Code
```

装完重启 Claude Code 生效。

## 怎么用

在 Claude Code 里：

```
/zhfix prd.md
```

或者自然语言触发，任何包含"标点 / 全角 / 半角"+ 单个文件名的话都会触发，例如：

- "把 prd.md 改成中文标点"
- "prd.md 全角化一下"
- "修一下 docs/api.md 的半角逗号"
- "把 prd.md 第三段的标点改成全角"(范围 + 文件)

改前自动备份，不满意：

```powershell
zhfix restore prd.md     # 还原到最近一次 /zhfix 改之前
```

## 能改 / 不改什么

- ✅ `.md` `.markdown` `.html` `.htm`
- ✅ 补上 AutoCorrect 漏掉的 `;` `:` 边界 `,`
- ✅ 不碰 markdown 结构、代码块、URL、HTML 里的 JS 和属性值
- ❌ 不动纯英文、纯代码、纯数字
- ❌ 不把引号强行改成西式弯引号 `""`，保留你自己的引号风格 (`「」` `""` 等)
- ❌ **不接受**目录 / 通配符 / 批量，一次只改一个文件
- ❌ **不接受**"把引号改成『』"这类指定非标准目标的改写 —— 不是 zh-fix 的职责

## 安全性

- 改前自动备份到 `~/.zhfix/backups/`，`zhfix restore <文件>` 一键还原
- 出错时直接放行，不报错地中止
- 写文件用临时文件 + 原子替换，失败不会留下半个文件
- 拒绝可疑路径 (危险字符、网络路径、软链等)，跳过 100MB 以上的大文件
- 每次操作都记日志：`~/.claude/zh-fix.log`

不想让某个文件被处理：首行加 `<!-- zh-fix: off -->`。

## 从老版本升级

0.1.x / 0.2.0 时 zhfix 装的是 Claude Code hook，会在你写 md 时**自动**改半角。0.3.0 起取消自动 hook，只保留主动调的 `/zhfix` skill。

升级一行命令搞定：

```
zhfix update
```

它会：
1. `npm i -g zhfix@latest` 拉最新版
2. 自动清掉 `~/.claude/settings.json` 里旧的 hook 注册
3. 删掉 `~/.claude/hooks/zh-fix-auto.sh` bash 包装
4. 重装 `/zhfix` skill

跑完重启 Claude Code，不会再有"写完就被自动改"的行为，只有你主动 `/zhfix` 才改。

## 卸载

```powershell
zhfix uninstall            # 清掉接入(config/skill + 旧 hook 残留)
npm uninstall -g zhfix     # 删本体(命令 + 依赖)
```

顺序别反 —— 卸了本体就没 `zhfix` 命令了。

## 排错

| 现象 | 怎么办 |
|---|---|
| 不确定有没有装好 | `zhfix status` |
| `/zhfix` 不触发 | 确认重启过 Claude Code(skill 要重启才加载) |
| `zhfix` 命令找不到 | 重开终端；还不行检查 npm 全局 bin 在不在 PATH |
| 配置坏了 | `zhfix init` 重写 (同时清旧 hook 残留) |
| 想紧急关掉 | `zhfix uninstall` |

## 命令清单

```
zhfix install                首次接入 Claude Code
zhfix init [tool 路径]       重新绑定 / 修复配置(同时清旧 hook 残留)
zhfix status                 看状态 + 今日活动 + 旧版残留检测
zhfix restore <文件>         还原文件到 /zhfix 改之前的备份
zhfix clear-backups [--yes]  清理备份
zhfix update                 升级到最新版并刷新接入
zhfix uninstall [--all]      卸载接入(本体另跑 npm uninstall -g zhfix)
zhfix help                   帮助
```

---

## 给维护者

- 本地开发：repo 根目录 `node install/install.mjs`，再 `npm link` 拿全局命令。
- 不要随便升级 `autocorrect-node`。补丁规则是按 2.14.0 的行为写死的，升级容易双改或反向破坏，升级前用真实样本验证残留。
- 不要手改 `~/.zhfix/config.json`，`zhfix init` 会覆盖。
- 0.3.0 拆除了自动 hook(0.1.x PostToolUse / 0.2.0 PreToolUse)，只保留 skill 主动触发。架构、规则实现见 [`AGENTS.md`](./AGENTS.md) 和 `tool/` 源码。

## License

MIT
