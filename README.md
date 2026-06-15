# zh-fix

<p align="center">
  <img src="docs/assets/header.png" alt="zh-fix" width="100%">
</p>

Claude Code 写中文 `.md` / `.html` 时，自动把半角标点改成全角。装好后在后台运行，平时不用管。

```
before: 你好,世界.这是一个测试,带边界(英文),还有.
after:  你好，世界。这是一个测试，带边界 (英文)，还有。
```

需要 [Claude Code](https://claude.com/claude-code)——它是 Claude Code 的一个 hook，没有 Claude Code 不会触发。

## 安装

推荐直接让 AI 代劳——把这句发给你的 Claude Code，它会装好并告诉你怎么用：

> 帮我装一下 zhfix（npm i -g zhfix 再 zhfix install），装好告诉我怎么用

想自己敲也行，就两条命令：

```powershell
npm i -g zhfix     # 装命令 + 依赖，工作区零残留
zhfix install      # 接入 Claude Code
```

装完重启 Claude Code 生效。

## 怎么用

平时不用管，照常写文档就行，每次写 `.md` / `.html` 都会自动处理。

需要时也能主动调：

```
# Claude Code 里 —— 对已有文件跑一次(改前自动备份)
/zhfix <文件>      说"把 prd.md 改成中文标点"也能触发

# 终端任意位置
zhfix status       看是否启用 / 是否暂停 / 今日改了多少
zhfix pause        当前目录先别处理(写英文或代码示例时)
zhfix resume       恢复处理
```

## 能改 / 不改什么

- ✅ `.md` `.markdown` `.html` `.htm`
- ✅ 补上 AutoCorrect 漏掉的 `;` `:` 边界 `,`
- ✅ 不碰 markdown 结构、代码块、URL、HTML 里的 JS 和属性值
- ❌ 不动纯英文、纯代码、纯数字
- ❌ 不把引号强行改成西式弯引号 `""`，保留你自己的引号风格（`「」` `""` 等）

实测一份 PRD：AutoCorrect 单跑残留 32 处，配合 zh-fix 后剩 5 处（修正率 84%），日常使用基本是 0。

## 安全性

- 出错时直接放行，不阻塞 Claude
- 写文件用临时文件 + 原子替换，失败不会留下半个文件
- 拒绝可疑路径（危险字符、网络路径、软链等），跳过 100MB 以上的大文件
- 每次操作都记日志：`~/.claude/zh-fix.log`

不想让某个文件被处理：首行加 `<!-- zh-fix: off -->`，或在那个目录 `zhfix pause`。

## 卸载

```powershell
zhfix uninstall            # ① 清掉接入(hook、配置、skill)
npm uninstall -g zhfix     # ② 删掉本体(命令 + 依赖)
```

顺序别反——卸了本体就没 `zhfix` 命令了。`zhfix uninstall` 会删掉 `~/.zhfix/`（含备份），想留的先 `cp` 出来。

## 排错

| 现象 | 怎么办 |
|---|---|
| 不确定有没有生效 | `zhfix status` |
| 改完没反应 | 确认重启过 Claude Code（hook 要重启才加载） |
| `zhfix` 命令找不到 | 重开终端；还不行检查 npm 全局 bin 在不在 PATH |
| 想紧急关掉 | 看 [`tool/EMERGENCY-OFF.md`](tool/EMERGENCY-OFF.md)，或 `zhfix uninstall` |
| 配置坏了 | `zhfix init` 重写接入配置（不动备份和暂停列表） |

## 命令清单

```
zhfix install                首次接入 Claude Code
zhfix init [tool 路径]       重新绑定 / 修复配置
zhfix pause / resume         暂停 / 恢复当前目录
zhfix status                 看状态 + 今日活动
zhfix restore <文件>         还原文件到 /zhfix 改之前的备份
zhfix clear-backups [--yes]  清理备份
zhfix update                 升级到最新版并刷新接入(之后重启 Claude Code)
zhfix uninstall [--all]      卸载接入(本体另跑 npm uninstall -g zhfix)
zhfix help                   帮助
```

---

## 给维护者

- 本地开发：repo 根目录 `node install/install.mjs`，再 `npm link` 拿全局命令。
- 不要随便升级 `autocorrect-node`。补丁规则是按 2.14.0 的行为写死的，升级容易双改或反向破坏，升级前用真实样本验证残留。
- 不要手改 `~/.zhfix/` 或 `~/.claude/hooks/zh-fix-auto.sh`，`zhfix init` 会覆盖。
- 安装流程、架构、规则实现见 [`AGENTS.md`](./AGENTS.md) 和 `tool/` 源码。

## License

MIT
