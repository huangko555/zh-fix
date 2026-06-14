// rules/cjk.mjs
// 共享 CJK 检测。v2 扩展:含 Han + Hiragana + Katakana + Enclosed Alphanumerics (①②③) + CJK Symbols
// 来源:对抗审查指出原 \p{Script=Han} 漏假名/圆圈数字等

export const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}①-⓿　-〿㈠-㉃]/u

export function isCjk(ch) {
  return ch && CJK.test(ch)
}

// 已全角化的中文句末标点。连续标点(如 `?!`)autocorrect 只转头一个,
// 剩下那个的"左邻"是全角标点而非 CJK,规则会漏。把它们也当作"左邻成立"的触发。
export const FULLWIDTH_SENT_PUNCT = new Set(['？', '！', '，', '。', '；', '：'])

// emoji(星体象形符号)。emoji 不算 CJK,导致 `💪!` / `😄,` 这类相邻标点漏转。
// 把 emoji 当作"中文一侧邻居"参与触发判定。Extended_Pictographic 是标准 emoji 类,
// 会含 ©®™ 等(极少出现在中文正文相邻标点位),风险低。
export const EMOJI = /\p{Extended_Pictographic}/u

export function isCjkOrEmoji(ch) {
  return ch && (CJK.test(ch) || EMOJI.test(ch))
}
