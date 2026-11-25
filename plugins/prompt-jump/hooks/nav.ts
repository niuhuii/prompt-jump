// 鍵盤流跳轉的純邏輯：不碰 `$`，方便測試。

import type { PromptEntry } from '../types'

/** 一列在畫面上露出的範圍（UserMessage／AssistantMessage／ToolUse 的 `onScreen`）。 */
export type Seen = { first: number; last: number; of: number }

/**
 * 目前捲到哪：視窗最上方屬於第幾則提問（0 起算），以及那一則的開頭是不是
 * 正好在最上面。不知道時（一般畫面不回報 onScreen）為 undefined。
 */
export type Position = { index: number; isAtStart: boolean }

/**
 * 從「畫面上看得到哪些列」推算目前位置。
 *
 * prompts：依序的提問。visible：列 id → 露出範圍（只放看得到的）。
 * ownerOf：回答區塊、工具列的 id → 它屬於哪一則提問的 id。
 * pinned：剛跳過去的那一則；還看得到就以它為準（最後幾則捲不到畫面頂端）。
 */
export const positionOf = (
  prompts: readonly PromptEntry[],
  visible: ReadonlyMap<string, Seen>,
  ownerOf: (id: string) => string | undefined,
  pinned?: string,
): Position | undefined => {
  const indexOf = new Map(prompts.map((one, i) => [one.id, i]))
  if (pinned !== undefined && visible.has(pinned)) {
    const at = indexOf.get(pinned)
    if (at !== undefined) return { index: at, isAtStart: true }
  }
  let best: (Position & { isPrompt: boolean }) | undefined
  for (const [id, seen] of visible) {
    const own = indexOf.get(id)
    const owner = ownerOf(id)
    const index = own ?? (owner === undefined ? undefined : indexOf.get(owner))
    if (index === undefined) continue
    const isPrompt = own !== undefined
    // 同一則裡提問排在回答前面，所以提問露出時以它為準。
    const isHigher =
      !best || index < best.index || (index === best.index && isPrompt && !best.isPrompt)
    if (isHigher) best = { index, isPrompt, isAtStart: isPrompt && seen.first <= 1 }
  }

  return best && { index: best.index, isAtStart: best.isAtStart }
}

/**
 * 上一則／下一則的目標編號（0 起算），沒有就 undefined。
 *
 * 有畫面位置時以它為準；沒有時用上次跳到的那一則（null 代表還沒跳過，
 * 視為停在最底下）。上一則：目前這一則的開頭不在最上面時，先回到它的開頭。
 */
export const stepTarget = (
  direction: 'prev' | 'next',
  count: number,
  position: Position | undefined,
  cursor: number | null,
): number | undefined => {
  if (count === 0) return undefined
  if (position) {
    const target =
      direction === 'prev'
        ? position.isAtStart
          ? position.index - 1
          : position.index
        : position.index + 1

    return target >= 0 && target < count ? target : undefined
  }
  const from = cursor === null || cursor >= count ? count : cursor
  const target = direction === 'prev' ? from - 1 : from + 1

  return target >= 0 && target < count ? target : undefined
}

export type JumpQuery =
  | { kind: 'pane' }
  | { kind: 'index'; index: number }
  | { kind: 'step'; direction: 'prev' | 'next' }
  | { kind: 'answer' }
  | { kind: 'mark'; name: string }
  | { kind: 'search'; words: string }

/** 解析 `/jump` 後面的參數。 */
export const parseJump = (args: string): JumpQuery => {
  const text = args.trim()
  if (text === '') return { kind: 'pane' }
  const num = /^#?(\d+)$/.exec(text)
  if (num) return { kind: 'index', index: Number(num[1]) - 1 }
  if (/^-\d+$/.test(text)) return { kind: 'index', index: -Number(text.slice(1)) }
  const word = text.toLowerCase()
  if (word === 'prev' || word === '上' || word === '上一則') {
    return { kind: 'step', direction: 'prev' }
  }
  if (word === 'next' || word === '下' || word === '下一則') {
    return { kind: 'step', direction: 'next' }
  }
  if (word === 'answer' || word === 'ans' || word === '回答') return { kind: 'answer' }
  if (text.startsWith('@') && text.length > 1) {
    return { kind: 'mark', name: text.slice(1).trim() }
  }

  return { kind: 'search', words: text }
}

/** 把 `-2` 這種倒數編號換成正向編號；超出範圍為 undefined。 */
export const resolveIndex = (index: number, count: number): number | undefined => {
  const real = index < 0 ? count + index : index

  return real >= 0 && real < count ? real : undefined
}

/** 書籤名稱：沒給就用「<base> N」，N 取第一個沒被用掉的。 */
export const markName = (wanted: string, taken: readonly string[], base: string) => {
  const name = wanted.trim()
  if (name !== '') return name
  for (let n = 1; ; n++) {
    if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`
  }
}

/**
 * 畫面最上方那一列的 id：露出的列裡順序最前面的。
 * order 是列在對話裡的先後；不在 order 裡的列不算。
 */
export const topRow = (
  visible: ReadonlyMap<string, Seen>,
  order: ReadonlyMap<string, number>,
): string | undefined => {
  let best: string | undefined
  for (const id of visible.keys()) {
    const at = order.get(id)
    if (at === undefined) continue
    if (best === undefined || at < order.get(best)!) best = id
  }

  return best
}
