// 搜尋：篩選框和 `/jump 關鍵字` 共用。比對提問、那一輪回答的開頭、那一輪改過的檔名，
// 並記下是哪一種符合，讓畫面說得出「為什麼這一則被列出來」。不碰 $，方便測試。

import { baseName } from './facts'
import { clip, widthOf } from './toc'

/** 一則可以被搜的東西。 */
export type Searchable = {
  /** 提問（或自動標題）的文字。 */
  text: string
  /** 回答開頭。 */
  answer?: string
  /** 這一輪改過的檔（完整路徑）。 */
  files?: readonly string[]
}

/** 符合的原因：提問、回答、檔名。 */
export type Source = 'prompt' | 'answer' | 'file'

export type Hit = {
  /** 在完整清單裡的位置（0 起算）。 */
  index: number
  /** 哪些來源有詞符合，依提問、回答、檔名的順序。 */
  sources: Source[]
  /** 第一個符合的檔名（只有檔名，不含路徑）。 */
  file?: string
  /** 提問裡第一個符合的詞。 */
  promptWord?: string
  /** 回答裡第一個符合的詞。 */
  answerWord?: string
}

const wordsOf = (query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w !== '')

/**
 * 依關鍵字找，回傳符合的那幾則（依原本順序）。不分大小寫；空白分開的每個詞都要
 * 出現在提問、回答開頭或檔名其中一處（不必同一處）；純數字也比對編號。
 */
export const search = (list: readonly Searchable[], query: string): Hit[] => {
  const words = wordsOf(query)
  if (words.length === 0) return list.map((_, index) => ({ index, sources: [] }))
  const hits: Hit[] = []
  list.forEach((one, index) => {
    const text = one.text.toLowerCase()
    const answer = (one.answer ?? '').toLowerCase()
    const names = (one.files ?? []).map(baseName)
    const num = String(index + 1)
    let promptWord: string | undefined
    let answerWord: string | undefined
    let file: string | undefined
    for (const w of words) {
      const inPrompt = text.includes(w) || w === num || w === `#${num}`
      const inAnswer = answer.includes(w)
      const name = names.find(n => n.toLowerCase().includes(w))
      if (!inPrompt && !inAnswer && name === undefined) return
      if (inPrompt) promptWord ??= w
      if (inAnswer) answerWord ??= w
      if (name !== undefined) file ??= name
    }
    const sources: Source[] = []
    if (promptWord !== undefined) sources.push('prompt')
    if (answerWord !== undefined) sources.push('answer')
    if (file !== undefined) sources.push('file')
    hits.push({ index, sources, file, promptWord, answerWord })
  })
  return hits
}

/** 一段文字裡，以某個詞為中心截出最多 `cols` 欄；前後被截掉的地方用「…」。 */
export const snippet = (text: string, word: string, cols: number): string => {
  const at = text.toLowerCase().indexOf(word.toLowerCase())
  if (at < 0 || widthOf(text) <= cols) return clip(text, cols)
  // 詞前面留大約三分之一的寬度。
  const chars = [...text]
  const startChar = [...text.slice(0, at)].length
  let from = startChar
  let lead = 0
  const want = Math.floor(cols / 3)
  while (from > 0 && lead + widthOf(chars[from - 1]!) <= want) {
    from--
    lead += widthOf(chars[from]!)
  }
  const rest = chars.slice(from).join('')
  return from === 0 ? clip(rest, cols) : `…${clip(rest, cols - 1)}`
}

export type ReasonWords = {
  inPrompt: (excerpt: string) => string
  inAnswer: (excerpt: string) => string
  inFile: (name: string) => string
}

/**
 * 符合原因的說明，最多 `cols` 欄：檔名優先（最短最準），再來回答，最後是提問
 * （只有提問符合、但那個詞在畫面上被截掉時才會用到）。
 */
export const reasonText = (hit: Hit, one: Searchable, cols: number, w: ReasonWords): string => {
  const parts: string[] = []
  if (hit.file !== undefined) parts.push(w.inFile(hit.file))
  if (hit.answerWord !== undefined && one.answer && !hit.sources.includes('prompt')) {
    const fixed = widthOf(w.inAnswer('')) + parts.reduce((n, p) => n + widthOf(p) + 2, 0)
    parts.push(w.inAnswer(snippet(one.answer, hit.answerWord, Math.max(8, cols - fixed))))
  }
  if (parts.length === 0 && hit.promptWord !== undefined) {
    const fixed = widthOf(w.inPrompt(''))
    parts.push(w.inPrompt(snippet(one.text, hit.promptWord, Math.max(8, cols - fixed))))
  }
  return clip(parts.join('  '), cols)
}

/**
 * 要不要另外說明符合的原因：檔名、回答一定要說；提問符合但那個詞被截掉、
 * 畫面上看不到時也要說。`shown` 是畫面上那一列實際顯示的提問文字（截過的）。
 */
export const needsNote = (hit: Hit, shown: string): boolean => {
  if (hit.sources.length === 0) return false
  if (!hit.sources.includes('prompt')) return true
  return hit.promptWord !== undefined && !/^#?\d+$/.test(hit.promptWord) && !shown.toLowerCase().includes(hit.promptWord)
}
