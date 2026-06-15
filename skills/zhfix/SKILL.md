---
name: zhfix
description: |
  把用户指定的一份 .md / .html 文档的中文标点改成符合 zh-fix 规范 (半角→全角、加盘古空格)。

  **必须同时满足这两条才触发**：
  1. 用户**明确**要求"把标点改成中文标点 / 全角 / 半角换全角 / 标点格式规范化 / 标点统一"，或**明确**说要改某个标点的全/半角形式 (如"半角逗号改全角"、"句号统一")。
  2. 用户给出**单个具体文件**(明确的路径或文件名)。

  **不触发**(即使用户提到了文件 + 某种标点)：
  - 用户要"把引号改成『 』" / "把括号改成《 》" / "把破折号换成 emoji" 等**指定一个非标准目标**的改写——这不是 zh-fix 的职责
  - 用户只说"改一下 X 文件 / 修一下 X / 优化 X" 这种**没指明改什么的泛改**
  - 用户想改**文档内容、错别字、样式、排版、结构、措辞**
  - 用户想改**英文标点 / 代码格式 / 数据格式**
  - 用户想批量处理 (目录 / 通配符 / "所有 / 全部")
  - Claude Code 自动 PreToolUse hook 写盘前的自动规范化 — 那是另一套独立机制，跟本 skill 无关

  **触发示例**：
  - "/zhfix prd.md"
  - "把 prd.md 改成中文标点"
  - "改一下 prd.md 的标点" / "改一下 prd.md 的标点格式"
  - "prd.md 里全角化一下"
  - "修一下 docs/api.md 的半角逗号"
  - "把 prd.md 第三段的标点改成全角" (范围 + 文件)

  **不触发示例**：
  - "改一下 prd.md" (没说改什么)
  - "修一下这个文档" (既没文件也没说改什么)
  - "把 prd.md 里的错字改一下" (改错字，不是标点)
  - "改一下文档结构" (改结构)
  - "把 docs/ 里所有 md 都改了" (批量)
  - "把 prd.md 里的引号改成『 』" (指定非标准目标)
---

# zhfix skill

用户想用 zh-fix 规则改一份文档的中文标点。处理**单个文件**，可选范围限定。改前自动备份，事后给个 `zhfix restore` 入口。

## 硬约束

1. **必须有具体文件路径。** 没说哪个文件 → 问"想改哪个文件？给我个路径。"，不要瞎猜。
2. **不接受目录、通配符、"所有"。** → 拒绝，要求单个。
3. **扩展名必须 `.md/.markdown/.html/.htm`。** 别的拒绝。
4. **改前必须备份。** 备份失败 → 停下报错，不要继续。
5. **不做 yes/no 确认。** 直接改，用备份兜底。
6. **不要在报告里告诉用户备份的具体路径。** 告诉他"已备份，不满意可以 `zhfix restore` 还原"就够。

## 步骤

### 1. 解析参数

- `$FILE` = 用户给的文件路径 (转成绝对路径)
- `$RANGE` = 用户提到的范围 (可能是 `L20-L40`、`## 用户故事 那节`、`第三段`、特定句子等)
  - 没提范围 → `$RANGE = "full"`(整文件)

### 2. 校验

- 文件存在 → 否则拒绝
- 扩展名在 `.md/.markdown/.html/.htm` → 否则拒绝

### 3. 找工具位置

```bash
cat ~/.zhfix/config.json
```

读 `tool_root` 字段。工具入口 = `<tool_root>/zh-fix.mjs`。

config 不存在 → 告诉用户 zh-fix 没装，看 README 装好再来。

### 4. 备份原文件 (无条件)

用 Bash 工具 (跨平台都通过 Bash tool)：

```bash
mkdir -p ~/.zhfix/backups
# 时间戳带毫秒,避免秒级冲突
TS=$(date +%Y%m%d-%H%M%S-%3N 2>/dev/null || date +%Y%m%d-%H%M%S-000)
# 路径编码:SHA1 前 8 位 + basename,确保不同目录的同名文件不撞
HASH=$(printf %s "$FILE_ABS" | sha1sum | head -c 8)
BNAME=$(basename "$FILE_ABS")
BACKUP_PATH="$HOME/.zhfix/backups/${HASH}.${BNAME}.${TS}.bak"
# 用 && 短路 + test -s 校验备份文件存在且非空,任何一步失败立即 exit 1
cp -- "$FILE_ABS" "$BACKUP_PATH" && test -s "$BACKUP_PATH" && echo "backup_ok: $BACKUP_PATH" || { echo "backup_fail"; exit 1; }
```

**关键**：看到 `backup_fail` 或 Bash exit code 非 0 → 停下，告诉用户备份失败、原文件未动。**绝不能进下一步改原文件**。

### 5. 处理

**关键设计**(F8 修)：**永远先对整文件跑 zh-fix.mjs**，这样 mask 引擎有完整上下文 (代码块边界、HTML 结构等都识别正确)。再根据 `$RANGE` 决定要不要 splice 回原文件的部分行。

#### 5a. 整文件处理 (`$RANGE === "full"`)

直接对原文件跑：

```bash
node "<tool_root>/zh-fix.mjs" "$FILE_ABS"
```

工具会做 atomic write，改完落盘。

#### 5b. 范围处理 (`$RANGE` 是某段)

1. **复制原文件到临时位置**，在临时副本上跑工具 (这样原文件等到我们 splice 完才动)：

```bash
TMP="$(mktemp --suffix=.${BNAME##*.} 2>/dev/null || echo "/tmp/zhfix-$$.${BNAME##*.}")"
cp -- "$FILE_ABS" "$TMP"
node "<tool_root>/zh-fix.mjs" "$TMP"
```

2. **用 Read 工具读两份文件的相同行号区间**：
   - 用户要求的范围 → 折成 `L_start, L_end`(行号：章节就找 heading 行；段落就按空行数；特定文本就 Grep 找)
   - Read 原文件 L_start..L_end
   - Read 临时副本 L_start..L_end
   - 检查行数一致 (zh-fix 不改行数；不一致就退化为整文件处理)

3. **用 Edit 工具把原文件 L_start..L_end 替换为临时副本对应行**：
   - `old_string` = 原文件 L_start..L_end 内容
   - `new_string` = 临时副本 L_start..L_end 内容

4. **删临时副本**：`rm -- "$TMP"`

5. 这样最终效果：整文件 mask 上下文正确，但只有用户指定范围内的改动被写回原文件。

### 6. 报告 (不暴露备份路径)

```
✅ 已改:<file 路径>
范围:整个文件 / L20-L40(第三段)/ ## 用户故事 那节
改动:N 处(可以举 1-2 个 before→after 例子)

原文件已备份。不满意可以 `zhfix restore "<file 路径>"` 还原。
```

**关键**：**不要**写出备份的具体路径——用户用 `zhfix restore` 即可，知道路径反而是噪音。

## 别做的事

- ❌ 不要先 diff 后问 yes/no(直接改，用备份兜底)
- ❌ 不要批量 (多文件 / 目录 / 通配符)
- ❌ 不要在范围解析不清时硬猜 (问)
- ❌ 不要跳过备份 (备份失败必须停)
- ❌ 不要触发不属于"标点全/半角规范化"的请求
- ❌ 不要直接对原文件做范围处理 (抽片段会丢失 markdown 上下文，代码块/HTML 边界会乱)
- ❌ 不要写出备份路径

## 平台说明

本 skill 用 Bash 工具 (`cat`， `cp`， `date`， `mkdir`， `sha1sum`， `mktemp`)。
Windows 上 Claude Code 通过 Git Bash(zh-fix 装时已检测) 能跑这些。如果你在 PowerShell 直跑，自己翻译成对应命令。
