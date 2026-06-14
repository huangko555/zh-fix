// rules/semicolon.mjs
// 中文上下文里的半角 ; : ! → 全角 ；：！。autocorrect 对这三个在"中文+标点+英文/数字"场景会漏。
// 规则:只看标点【左边】第一个非空白字符——是 CJK 才转。
//   标点的全/半角归属看它左边结束的那个词:中文词后→全角;英文/数字后→保持半角。
//   于是 时间:10:30 → 时间：10:30(第一个冒号左是"间"→全角;10:30 左是数字→半角),
//        key:value / http:// / width:100px / 10:30 / 50:50 都因左侧非 CJK 自然不动。
// 不含:逗号 , 问号 ?(autocorrect 已处理);句号 .(中文文件名.扩展名风险)。

import { FULLWIDTH_SENT_PUNCT, isCjkOrEmoji } from './cjk.mjs'

const TARGETS = { ';': '；', ':': '：', '!': '！' }

export function applySemicolonRule(text, masked) {
  const chars = Array.from(text)
  const maskedChars = Array.from(masked)
  for (let i = 0; i < maskedChars.length; i++) {
    const full = TARGETS[maskedChars[i]]
    if (!full) continue
    // 颜文字护栏:冒号紧跟 ) 视作 :) 笑脸,不动
    if (maskedChars[i] === ':' && maskedChars[i + 1] === ')') continue
    // 只看左边:第一个非空白字符(遇 mask 区 \x00 停)。
    // 读 chars(本趟已改的也算进去):连续标点 `!!` 里前一个被本规则转成 ！后,
    // 后一个据此左邻也能触发(#4);mask 边界仍以 maskedChars 的 \x00 为准。
    let before = ''
    for (let j = i - 1; j >= 0; j--) {
      if (maskedChars[j] === '\x00') break
      const c = chars[j]
      if (!/\s/.test(c)) { before = c; break }
    }
    // 左邻是 CJK / emoji(#5),或已全角的中文句末标点(#4,连续标点 ?! 的第二个)→ 转
    if (isCjkOrEmoji(before) || FULLWIDTH_SENT_PUNCT.has(before)) chars[i] = full
  }
  return chars.join('')
}
