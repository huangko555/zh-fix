# 紧急关闭 zh-fix(三步)

如果 zh-fix 改坏了某份文档、或者出现你不确定的行为，**立即停用**:

## 方法 1:zhfix 命令 (最简，无脑)

```bash
zhfix uninstall
```

会清掉 settings.json 里的 hook、`~/.claude/hooks/zh-fix-auto.sh`、`zhfix` PATH 命令、`~/.zhfix/` 整个目录。
**不会**碰你的 `tool/` 源、`autocorrect-node` 包、历史日志。

## 方法 2:暂停当前目录 (保留全局 hook)

```bash
cd <出问题的目录>
zhfix pause
```

只在这个目录 (及子目录) 跳过，其他地方仍正常处理。

## 方法 3:单文件免疫 (保留全局 hook)

在那份文档**第一行**加：

```
<!-- zh-fix: off -->
```

工具检测到就跳过这个文件。

## 方法 4:手动改 settings.json(没有 zhfix 命令时)

打开 `~/.claude/settings.json`，删 `hooks.PostToolUse` 里包含 `zh-fix-auto.sh` 的那一项。
重启 Claude Code。

---

## 出问题怎么 trace

看 `~/.claude/zh-fix.log`，每次 hook 跑都会写一行：

```
2026-06-14T10:30:15.000Z  OK <file>: +12 chars        ← 正常
2026-06-14T10:30:20.000Z  AC_FAIL <file>: ...         ← autocorrect 失败
2026-06-14T10:30:25.000Z  SKIP <file>: opt-out        ← opt-out 生效
2026-06-14T10:30:30.000Z  REJECT <file>: ...          ← 安全拒绝
2026-06-14T10:30:35.000Z  PAUSED <file>               ← 路径在暂停列表
2026-06-14T10:30:40.000Z  AC_ONLY <file>              ← autocorrect 改了,我们没追加改
```

日志能让你定位"这份产物是不是工具改的、什么时候改的、改了多少处"。
