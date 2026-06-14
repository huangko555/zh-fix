// rules/boundary.mjs
// Rule 2: 结构边界后接半角标点接 CJK → 半角转全角。
// 覆盖:**强调**,中文 / *斜体*,中文 / `code`,中文 / [link](url),中文 / (括号),中文
//      "引文",中文 / 「方引号」,中文 / 《书名》,中文 / 弯引号 "" '' 闭引号,中文
//
// 设计:不在 mask 上做(因为 ** 不被 mask),直接对原文本扫,
// 但前后字符判定时,如果落在 mask 区(\x00),视为"边界"(不参与判定),
// 跳过 mask 区里的所有匹配。

import { CJK } from './cjk.mjs'

// 半角 → 全角映射表。用 \uXXXX 显式 codepoint 避免编辑器/Write 工具误转。
const HALF_TO_FULL = {
  ',': '，',  // ，
  '.': '。',  // 。
  ';': '；',  // ；
  ':': '：',  // ：
  '!': '！',  // !
  '?': '？',  // ?
}

// 右收尾结构(它的"最右一个字符"形态),包含半角和中文边界。
// 全角字符用 \uXXXX 显式写,避免编辑器静默转 ASCII。
const CLOSING_CHARS = new Set([
  '*', '`',         // markdown 强调 / inline code 闭合
  ')',              // 半角右括号
  ']',              // 半角右方括号
  '"', "'",         // 半角直引号
  '”',         // " 右双弯引号
  '’',         // ' 右单弯引号
  '」',         // 」中文右方引号
  '』',         // 』中文右双方引号
  '》',         // 》右书名号
  '）',         // )全角右括号
])

/**
 * @param {string} text 原文本
 * @param {string} masked 同长度的 masked 文本
 * @returns {string} 修过的文本
 */
export function applyBoundaryRule(text, masked) {
  const chars = Array.from(text)
  const maskedChars = Array.from(masked)
  const n = maskedChars.length

  for (let i = 0; i < n; i++) {
    const ch = maskedChars[i]
    if (!HALF_TO_FULL[ch]) continue
    if (ch === '\x00') continue

    // 看左侧第一个非空白字符(在原文本上看,这样能识别 ** ` 等)
    // 注意:** 不会被 mask,所以原文本和 masked 在 ** 位置一样
    let leftCh = ''
    for (let j = i - 1; j >= 0; j--) {
      const c = chars[j]
      if (/\s/.test(c)) continue
      leftCh = c
      break
    }
    if (!CLOSING_CHARS.has(leftCh)) continue

    // 右侧第一个非空白字符是 CJK → 直接触发
    let rightCh = ''
    for (let j = i + 1; j < n; j++) {
      const c = maskedChars[j]
      if (c === '\x00') break
      if (/\s/.test(c)) continue
      rightCh = c
      break
    }
    const rightIsCjk = CJK.test(rightCh)

    // 右侧不是 CJK 时,看左侧近距离(50 字内)有没有 CJK
    // 处理 `**中文**:English` 这种"中文加粗后接半角再接英文"的常见模式
    //
    // F1 修订(限制回看,避免跨段 / 穿过长 mask 区误改):
    //   - 遇 \n\n(空行 = 段落边界)立即停
    //   - 累计跨过的 \x00 (代码块/URL/script 等)字符 > 10 → 停
    //   - 累计跨过的换行 > 1 → 停(避免跨多行未空行的相邻 lines)
    let leftHasNearbyCjk = false
    if (!rightIsCjk) {
      const lookback = Math.max(0, i - 50)
      let maskedCrossed = 0
      let newlineCrossed = 0
      let prevWasNewline = false
      for (let j = i - 1; j >= lookback; j--) {
        const c = maskedChars[j]
        if (c === '\n') {
          if (prevWasNewline) break  // \n\n 段落边界
          prevWasNewline = true
          newlineCrossed++
          if (newlineCrossed > 1) break
          continue
        }
        prevWasNewline = false
        if (c === '\x00') {
          maskedCrossed++
          if (maskedCrossed > 10) break
          continue
        }
        if (CJK.test(c)) { leftHasNearbyCjk = true; break }
      }
    }

    if (!rightIsCjk && !leftHasNearbyCjk) continue

    chars[i] = HALF_TO_FULL[ch]
  }

  return chars.join('')
}
