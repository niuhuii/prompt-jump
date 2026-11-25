// 目錄用的純函式：整理訊息文字、算終端機寬度、截斷、篩選。不碰 $。

import type { PromptEntry } from '../types'

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/**
 * 對話紀錄裡一則 user 列的文字，整理成目錄要顯示的一行；不是使用者自己打的
 * 訊息（斜線指令、指令輸出、背景通知、引擎附加的提醒）回空字串。
 */
export const cleanPrompt = (text: string): string => {
  const line = text.replace(REMINDER, ' ').replace(/\s+/g, ' ').trim()
  if (line === '' || line.startsWith('<')) return ''
  if (line.startsWith('[Request interrupted')) return ''
  return line
}

// 東亞全形字元（中日韓、全形符號、大部分 emoji）在終端機佔兩欄。
const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)

const cellsOf = (ch: string) => (isWide(ch.codePointAt(0) ?? 0) ? 2 : 1)

/** 字串在終端機上佔幾欄。 */
export const widthOf = (text: string) => {
  let cells = 0
  for (const ch of text) cells += cellsOf(ch)
  return cells
}

/** 截到最多 `cols` 欄，超過時尾巴換成「…」。 */
export const clip = (text: string, cols: number) => {
  if (cols <= 0) return ''
  if (widthOf(text) <= cols) return text
  let out = ''
  let cells = 0
  for (const ch of text) {
    const w = cellsOf(ch)
    if (cells + w > cols - 1) break
    out += ch
    cells += w
  }
  return `${out}…`
}

/** 時間顯示成 HH:MM（本機時區）。 */
export const hhmm = (ms: number) => {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * 依關鍵字篩選，回傳符合的項目在完整清單裡的位置（0 起算）。
 * 不分大小寫、空白分開的每個詞都要出現；純數字也比對編號。
 */
export const filterIndexes = (list: readonly PromptEntry[], query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '')
  const all = list.map((_, i) => i)
  if (words.length === 0) return all
  return all.filter(i => {
    const text = list[i]!.text.toLowerCase()
    const num = String(i + 1)
    return words.every(w => text.includes(w) || w === num || w === `#${num}`)
  })
}
