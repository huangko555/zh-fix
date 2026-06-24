# 紧急关闭 zh-fix(0.3.0+)

0.3.0 起 zh-fix **不会自动改任何文件**，只有用户主动调 `/zhfix <文件>` 时才会改。
所以 0.3.0 几乎不存在"需要紧急关闭"的场景 —— 你不调它就不动。

如果还是想彻底卸掉：

## 方法 1:zhfix 命令 (最简，无脑)

```bash
zhfix uninstall
```

会清掉 `~/.zhfix/` 目录 + `/zhfix` skill + 任何残留的旧版 hook 注册和 bash wrapper。
**不会**碰 `tool/` 源、`autocorrect-node` 包、历史日志。

## 方法 2:单文件免疫 (只让某份文件不被 /zhfix 改)

在那份文档**第一行**加：

```
<!-- zh-fix: off -->
```

`/zhfix` 检测到就跳过这个文件。

## 0.1.x / 0.2.0 残留怎么办

老版本的自动 hook(`PreToolUse` / `PostToolUse`) 如果还挂在 `~/.claude/settings.json` 里，跑：

```bash
zhfix update      # 升 npm 包 + 自动清干净
# 或
zhfix init        # 不升包,只清残留
```

会扫 `~/.claude/settings.json` 删旧 hook 条目，删 `~/.claude/hooks/zh-fix-auto.sh`，
并清掉 config 里的 `paused_paths` / `protocol_version` 旧字段。

---

## 出问题怎么 trace

看 `~/.claude/zh-fix.log`，每次 `/zhfix` 跑都会写一行：

```
2026-06-14T10:30:15.000Z  OK <file>: +12 chars        ← 正常
2026-06-14T10:30:20.000Z  AC_FAIL <file>: ...         ← autocorrect 失败
2026-06-14T10:30:25.000Z  SKIP <file>: opt-out        ← opt-out 生效
2026-06-14T10:30:30.000Z  REJECT <file>: ...          ← 安全拒绝
2026-06-14T10:30:40.000Z  AC_ONLY <file>              ← autocorrect 改了,我们没追加改
```

日志能让你定位"这份产物是不是工具改的、什么时候改的、改了多少处"。
