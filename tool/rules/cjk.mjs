// rules/cjk.mjs
// 共享 CJK 检测。v2 扩展:含 Han + Hiragana + Katakana + Enclosed Alphanumerics (①②③) + CJK Symbols
// 来源:对抗审查指出原 \p{Script=Han} 漏假名/圆圈数字等

export const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}①-⓿　-〿㈠-㉃]/u

export function isCjk(ch) {
  return ch && CJK.test(ch)
}
