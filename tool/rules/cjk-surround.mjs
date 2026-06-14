// rules/cjk-surround.mjs
// 补 autocorrect 自己偶尔漏掉的"纯 CJK 包围"情况:
//   `材,以` `图,以` 这种,左右都是 CJK,中间是半角标点。
//   autocorrect 在某些有 `<` 或其它干扰字符的行上会跳过整段处理。
//
// 严格条件:左 CJK + 半角标点 + 右 CJK(都紧贴,不允许中间有空格)
// 这是保守策略——只补最确定的 CJK 紧贴情况,避免误改代码/数字混排。

import { CJK } from './cjk.mjs'

const HALF_TO_FULL = {
  ',': '，',
  '.': '。',
  ';': '；',
  ':': '：',
  '!': '！',
  '?': '？',
}

export function applyCjkSurroundRule(text, masked) {
  const chars = Array.from(text)
  const maskedChars = Array.from(masked)
  const n = maskedChars.length

  for (let i = 1; i < n - 1; i++) {
    const ch = maskedChars[i]
    if (!HALF_TO_FULL[ch]) continue
    if (ch === '\x00') continue
    // 严格紧贴:i-1 和 i+1 必须都是 CJK,且不是 \x00
    const prev = maskedChars[i - 1]
    const next = maskedChars[i + 1]
    if (prev === '\x00' || next === '\x00') continue
    if (!CJK.test(prev) || !CJK.test(next)) continue
    chars[i] = HALF_TO_FULL[ch]
  }

  return chars.join('')
}
