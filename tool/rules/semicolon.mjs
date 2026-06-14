// rules/semicolon.mjs
// Rule 1: 中文上下文里的半角分号 `;` → 全角 `；`。
// autocorrect 完全不处理这条(确认过的硬缺口)。

import { CJK } from './cjk.mjs'

/**
 * @param {string} text  原文本
 * @param {string} masked 已 mask 跳过区域的同长度文本
 * @returns {string} 修过的文本
 */
export function applySemicolonRule(text, masked) {
  const chars = Array.from(text)
  const maskedChars = Array.from(masked)
  for (let i = 0; i < maskedChars.length; i++) {
    if (maskedChars[i] !== ';') continue
    // 找前后非空白字符
    let before = ''
    for (let j = i - 1; j >= 0; j--) {
      const c = maskedChars[j]
      if (c === '\x00') break  // 进入跳过区,不算
      if (!/\s/.test(c)) { before = c; break }
    }
    let after = ''
    for (let j = i + 1; j < maskedChars.length; j++) {
      const c = maskedChars[j]
      if (c === '\x00') break
      if (!/\s/.test(c)) { after = c; break }
    }
    if (CJK.test(before) || CJK.test(after)) {
      chars[i] = '；'
    }
  }
  return chars.join('')
}
