// mask.mjs
// 跳过区域引擎。给定文本,返回一个"被遮罩"的版本——所有"不应被规则处理"的区域被替换为占位符 \x00。
// 占位符保留 \n,以确保行号一致。长度严格不变,index 可与原文本对齐。
//
// v2 修订(对抗审查后):
//  - 顺序:HTML 块标签先于注释(避免 script 内 "<!--" 跨段吞文)
//  - 围栏代码块:扫到 EOF 未闭合则回滚 fence 区(防 Edit 中途触发整篇漏检)
//  - 行内 code:用 N 个反引号 + 至少 1 个非反引号字符 + 同 N 个反引号(CommonMark 风格)
//  - URL:含中文 query 时,跨过 ASCII 范围或匹配到结束 — 保守扩展范围

const PLACEHOLDER = '\x00'

function maskRange(buf, start, end) {
  for (let i = start; i < end && i < buf.length; i++) {
    if (buf[i] !== '\n') buf[i] = PLACEHOLDER
  }
}

// HTML 块标签 <script> <style> <pre> <code>(必须先于注释)
function maskHtmlBlocks(text, buf) {
  const re = /<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
  let m
  while ((m = re.exec(text)) !== null) {
    maskRange(buf, m.index, m.index + m[0].length)
  }
}

// HTML 注释(块标签后,已 mask 区不会再被吃)
function maskHtmlComments(text, buf) {
  const re = /<!--[\s\S]*?-->/g
  let m
  while ((m = re.exec(text)) !== null) {
    // 已 mask 区(buf 里是 \x00)就跳过——避免在 script 内残段命中
    if (buf[m.index] === PLACEHOLDER) continue
    maskRange(buf, m.index, m.index + m[0].length)
  }
}

// HTML 属性值
function maskHtmlAttributeValues(text, buf) {
  const tagRe = /<\/?[a-zA-Z][^>]*>/g
  const attrRe = /(\s[\w-]+\s*=\s*)(["'])((?:(?!\2)[^])*?)\2/g
  let m
  while ((m = tagRe.exec(text)) !== null) {
    if (buf[m.index] === PLACEHOLDER) continue
    const tagStart = m.index
    const tagText = m[0]
    let a
    attrRe.lastIndex = 0
    while ((a = attrRe.exec(tagText)) !== null) {
      const valueStart = a.index + a[1].length + 1
      const valueEnd = valueStart + a[3].length
      maskRange(buf, tagStart + valueStart, tagStart + valueEnd)
    }
  }
}

// Markdown 围栏代码块(状态机,扫到 EOF 未闭合则回滚)
function maskFencedCodeBlocks(text, buf) {
  // B1 修:进入函数时先存 buf 快照,回滚只回到本函数自己写入前的状态
  // (避免误恢复前面 maskHtmlBlocks / maskHtmlComments 的 mask)
  const bufSnapshotForRollback = buf.slice()

  const lines = text.split('\n')
  let pos = 0
  let fence = null
  let fenceMaskStart = -1
  const fenceRanges = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineEnd = pos + line.length

    if (!fence) {
      const m = /^[ ]{0,3}(`{3,}|~{3,})/.exec(line)
      if (m) {
        fence = { char: m[1][0], count: m[1].length }
        fenceMaskStart = pos
        maskRange(buf, pos, lineEnd)
      }
    } else {
      maskRange(buf, pos, lineEnd)
      // eslint-disable-next-line no-useless-escape
      const closePattern = new RegExp('^[ ]{0,3}\\' + fence.char + '{' + fence.count + ',}\\s*$')
      if (closePattern.test(line)) {
        fenceRanges.push([fenceMaskStart, lineEnd])
        fence = null
        fenceMaskStart = -1
      }
    }
    pos = lineEnd + 1
  }

  // 若 fence 未闭合 → 回滚到进入函数时的状态(保留之前函数的 mask),再补已闭合 fence 段
  if (fence && fenceMaskStart >= 0) {
    for (let i = fenceMaskStart; i < buf.length; i++) {
      buf[i] = bufSnapshotForRollback[i]
    }
    for (const [s, e] of fenceRanges) {
      maskRange(buf, s, e)
    }
  }
}

// 行内 code:严格 CommonMark 风格,N 个反引号 + 内容 + 同 N 个反引号
function maskInlineCode(text, buf) {
  const openRe = /(`+)/g
  let m
  while ((m = openRe.exec(text)) !== null) {
    const start = m.index
    const len = m[1].length
    if (buf[start] === PLACEHOLDER) continue
    const restStart = start + len
    let searchPos = restStart
    let found = -1
    while (searchPos < text.length) {
      const next = text.indexOf('`'.repeat(len), searchPos)
      if (next < 0) break
      // B2 修:next 之前/之后还有 backtick 表明是更长串的一部分 — 跳到整个串末尾
      // (修前是 +1,长 backtick 串会 O(n²) 卡顿)
      const beforeIsBacktick = next > 0 && text[next - 1] === '`'
      const afterIsBacktick = text[next + len] === '`'
      if (beforeIsBacktick || afterIsBacktick) {
        let runEnd = next + len
        while (text[runEnd] === '`') runEnd++
        searchPos = runEnd
        continue
      }
      if (buf[next] === PLACEHOLDER) { searchPos = next + len; continue }
      if (text.slice(restStart, next).includes('\n')) break
      found = next
      break
    }
    if (found > 0) {
      maskRange(buf, start, found + len)
      openRe.lastIndex = found + len
    }
  }
}

// URL:扩展到中文/Han 字符也可以在 URL 里(支持知乎/百度类含中文 query 的 URL)
function maskUrls(text, buf) {
  const re = /\b(?:https?|ftp|file):\/\/[^\s<>"'`]+/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (buf[m.index] === PLACEHOLDER) continue
    let end = m.index + m[0].length
    // B3 修:只剪 ASCII 句末标点(它们大概率是句末)
    // 中文标点放进 TRAIL 会误伤含中文 query 的 URL(如 ?q=中文。)
    const TRAIL = new Set([',', '.', ';', ':', '!', '?', ')', ']'])
    while (end > m.index && TRAIL.has(text[end - 1])) end--
    maskRange(buf, m.index, end)
  }
}

/**
 * 给定原文本,返回 masked 文本(长度一致,跳过区域被 \x00 替换,换行符保留)。
 */
export function computeMaskedText(text) {
  const buf = Array.from(text)

  // 顺序(修订版):
  // 1. HTML 块标签(必须先 — 防注释 regex 吃跨 script 文本)
  // 2. HTML 注释(只在未 mask 区匹配)
  // 3. HTML 属性值
  // 4. Markdown 围栏代码块(扫到 EOF 未闭合则回滚)
  // 5. Markdown 行内 code(只在未 mask 区匹配)
  // 6. URL(只在未 mask 区匹配)

  maskHtmlBlocks(text, buf)
  maskHtmlComments(text, buf)
  maskHtmlAttributeValues(text, buf)
  maskFencedCodeBlocks(text, buf)
  maskInlineCode(text, buf)
  maskUrls(text, buf)

  return buf.join('')
}

export function isUnmasked(maskedText, index) {
  return maskedText[index] !== PLACEHOLDER
}

export const MASK_PLACEHOLDER = PLACEHOLDER
