// mask.mjs
// 跳过区域引擎。给定文本,返回一个"被遮罩"的版本——所有"不应被规则处理"的区域被替换为占位符 \x00。
// 占位符保留 \n,以确保行号一致。长度严格不变(按码点),index 可与 Array.from(text) 对齐。
//
// v2 修订(对抗审查后):
//  - 顺序:HTML 块标签先于注释(避免 script 内 "<!--" 跨段吞文)
//  - 围栏代码块:扫到 EOF 未闭合则回滚 fence 区(防 Edit 中途触发整篇漏检)
//  - 行内 code:用 N 个反引号 + 至少 1 个非反引号字符 + 同 N 个反引号(CommonMark 风格)
//  - URL:含中文 query 时,跨过 ASCII 范围或匹配到结束 — 保守扩展范围
//
// v3 修订(emoji 错位 bug):
//  - 内部遮罩缓冲改为 UTF-16 单元布尔数组(Uint8Array),所有正则/字符串索引(m.index、
//    indexOf、按 line.length 累加的 pos)都是 UTF-16 偏移,二者天然对齐,无需逐处换算。
//  - 末尾再按"码点"折回 \x00 占位串(星体字符=1 个 \x00),保证返回串与 Array.from(text)
//    一一对齐,供下游规则(semicolon/boundary/cjk-surround,均用 Array.from)消费。
//    修前 buf 用 Array.from(text)(码点)却写 UTF-16 索引,emoji 之后整段遮罩右移。

const PLACEHOLDER = '\x00'

// masked:Uint8Array(1=遮罩),下标为 UTF-16 单元偏移。不遮罩换行,保证行号/长度对齐。
function maskRange(masked, text, start, end) {
  const lim = Math.min(end, masked.length)
  for (let i = start; i < lim; i++) {
    if (text.charCodeAt(i) !== 10) masked[i] = 1 // 10 = '\n'
  }
}

// HTML 块标签 <script> <style> <pre> <code>(必须先于注释)
function maskHtmlBlocks(text, masked) {
  const re = /<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
  let m
  while ((m = re.exec(text)) !== null) {
    maskRange(masked, text, m.index, m.index + m[0].length)
  }
}

// HTML 注释(块标签后,已 mask 区不会再被吃)
function maskHtmlComments(text, masked) {
  const re = /<!--[\s\S]*?-->/g
  let m
  while ((m = re.exec(text)) !== null) {
    // 已 mask 区就跳过——避免在 script 内残段命中
    if (masked[m.index] === 1) continue
    maskRange(masked, text, m.index, m.index + m[0].length)
  }
}

// HTML 属性值
function maskHtmlAttributeValues(text, masked) {
  const tagRe = /<\/?[a-zA-Z][^>]*>/g
  const attrRe = /(\s[\w-]+\s*=\s*)(["'])((?:(?!\2)[^])*?)\2/g
  let m
  while ((m = tagRe.exec(text)) !== null) {
    if (masked[m.index] === 1) continue
    const tagStart = m.index
    const tagText = m[0]
    let a
    attrRe.lastIndex = 0
    while ((a = attrRe.exec(tagText)) !== null) {
      const valueStart = a.index + a[1].length + 1
      const valueEnd = valueStart + a[3].length
      maskRange(masked, text, tagStart + valueStart, tagStart + valueEnd)
    }
  }
}

// Markdown 围栏代码块(状态机,扫到 EOF 未闭合则回滚)
function maskFencedCodeBlocks(text, masked) {
  // B1 修:进入函数时先存快照,回滚只回到本函数自己写入前的状态
  // (避免误恢复前面 maskHtmlBlocks / maskHtmlComments 的 mask)
  const snapshot = masked.slice()

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
        maskRange(masked, text, pos, lineEnd)
      }
    } else {
      maskRange(masked, text, pos, lineEnd)
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
    for (let i = fenceMaskStart; i < masked.length; i++) {
      masked[i] = snapshot[i]
    }
    for (const [s, e] of fenceRanges) {
      maskRange(masked, text, s, e)
    }
  }
}

// 行内 code:严格 CommonMark 风格,N 个反引号 + 内容 + 同 N 个反引号
function maskInlineCode(text, masked) {
  const openRe = /(`+)/g
  let m
  while ((m = openRe.exec(text)) !== null) {
    const start = m.index
    const len = m[1].length
    if (masked[start] === 1) continue
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
      if (masked[next] === 1) { searchPos = next + len; continue }
      if (text.slice(restStart, next).includes('\n')) break
      found = next
      break
    }
    if (found > 0) {
      maskRange(masked, text, start, found + len)
      openRe.lastIndex = found + len
    }
  }
}

// URL:扩展到中文/Han 字符也可以在 URL 里(支持知乎/百度类含中文 query 的 URL)
function maskUrls(text, masked) {
  const re = /\b(?:https?|ftp|file):\/\/[^\s<>"'`]+/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (masked[m.index] === 1) continue
    let end = m.index + m[0].length
    // B3 修:只剪 ASCII 句末标点(它们大概率是句末)
    // 中文标点放进 TRAIL 会误伤含中文 query 的 URL(如 ?q=中文。)
    const TRAIL = new Set([',', '.', ';', ':', '!', '?', ')', ']'])
    while (end > m.index && TRAIL.has(text[end - 1])) end--
    maskRange(masked, text, m.index, end)
  }
}

/**
 * 给定原文本,返回 masked 文本(按码点长度一致,跳过区域被 \x00 替换,换行符保留)。
 */
export function computeMaskedText(text) {
  // UTF-16 单元布尔缓冲:所有正则/字符串索引天然对齐到这里。
  const masked = new Uint8Array(text.length)

  // 顺序(修订版):
  // 1. HTML 块标签(必须先 — 防注释 regex 吃跨 script 文本)
  // 2. HTML 注释(只在未 mask 区匹配)
  // 3. HTML 属性值
  // 4. Markdown 围栏代码块(扫到 EOF 未闭合则回滚)
  // 5. Markdown 行内 code(只在未 mask 区匹配)
  // 6. URL(只在未 mask 区匹配)

  maskHtmlBlocks(text, masked)
  maskHtmlComments(text, masked)
  maskHtmlAttributeValues(text, masked)
  maskFencedCodeBlocks(text, masked)
  maskInlineCode(text, masked)
  maskUrls(text, masked)

  // 折回"码点对齐"的字符串:某码点占用的任一 UTF-16 单元被标记 → 输出 1 个 \x00,
  // 否则输出原码点。星体字符(占 2 个 UTF-16 单元)→ 恰好 1 个 \x00,与 Array.from(text) 对齐。
  const out = []
  for (let u = 0; u < text.length;) {
    const cp = text.codePointAt(u)
    const size = cp > 0xffff ? 2 : 1
    const isMasked = masked[u] === 1 || (size === 2 && masked[u + 1] === 1)
    out.push(isMasked ? PLACEHOLDER : String.fromCodePoint(cp))
    u += size
  }
  return out.join('')
}

export function isUnmasked(maskedText, index) {
  return maskedText[index] !== PLACEHOLDER
}

export const MASK_PLACEHOLDER = PLACEHOLDER
