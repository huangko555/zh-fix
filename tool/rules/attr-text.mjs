// rules/attr-text.mjs
// 文案属性白名单:placeholder / title / alt / aria-label 的值是"给用户看的文字"。
// autocorrect 不碰属性值、mask 又整段跳过,所以这些 UI 文案的中文标点没人规范化。
// 这条规则专门处理它们,但必须尊重块级 mask:属性名落在 <script>/<style>/代码块(\x00)就跳过,
// 避免改到代码里 '<input title="...">' 这类字符串(对抗审查 high)。

import { CJK } from './cjk.mjs'

// 文案属性白名单(给用户看的 UI 文字)。导出供 zh-fix.mjs 回填层复用,保持单一来源。
export const ATTR_WHITELIST = new Set(['placeholder', 'title', 'alt', 'aria-label'])

const HALF_TO_FULL = { ',': '，', '.': '。', ':': '：', ';': '；', '!': '！', '?': '？' }
// (?<![-\w]) 防 data-placeholder / ng-title 这类带前缀属性被误匹配
const ATTR_RE = new RegExp(
  `(?<![-\\w])(${[...ATTR_WHITELIST].join('|')})(\\s*=\\s*)(["'])([\\s\\S]*?)\\3`,
  'gi'
)

// 半角标点左或右紧邻 CJK → 全角(只动中文语境的,放过 50,000 千分位、report.pdf 这类)
function fixText(val) {
  const chars = Array.from(val)
  for (let i = 0; i < chars.length; i++) {
    const full = HALF_TO_FULL[chars[i]]
    if (!full) continue
    if (CJK.test(chars[i - 1] || '') || CJK.test(chars[i + 1] || '')) chars[i] = full
  }
  return chars.join('')
}

export function applyAttrTextRule(text, masked) {
  const maskedArr = Array.from(masked)
  return text.replace(ATTR_RE, (m, name, eq, q, val, offset) => {
    // 把 UTF-16 offset 转成 code-point 下标,再查 masked(与其它规则的 Array.from 对齐,兼容 emoji)
    const cpIdx = Array.from(text.slice(0, offset)).length
    if (maskedArr[cpIdx] === '\x00') return m  // 属性名在代码块/script/style 内 → 跳过
    const fixed = fixText(val)
    return fixed === val ? m : `${name}${eq}${q}${fixed}${q}`
  })
}
