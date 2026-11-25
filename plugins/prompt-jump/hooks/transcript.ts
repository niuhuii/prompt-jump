// 從對話紀錄（$.session.messages 的列）整理出跳轉要用的索引。不碰 $，方便測試。
//
// 紀錄裡每一列都有 uuid（畫面上那一列的 requestId），工具呼叫有 tool_use_id
// （畫面上工具列的 requestId）。依序讀過去，就知道每一列屬於哪一則提問、
// 每一則的回答從哪一列開始、列在對話裡的先後。

import type { SessionMessage } from 'claude-code'

import type { AnswerHead } from '../types'
import { FactsBook } from './facts'

/** 回答開頭最多存幾個字（預覽與搜尋用）。 */
export const ANSWER_HEAD = 300

export class TranscriptIndex {
  /** 每一則的事實（改了幾個檔、幾個指令、幾個失敗）。 */
  readonly facts = new FactsBook()
  /** 列 id（含工具列）→ 所屬提問的列 id。 */
  readonly ownerOf = new Map<string, string>()
  /** 列 id → 在對話裡的先後。 */
  readonly order = new Map<string, number>()
  /** 提問的列 id → 它的回答第一個有文字的區塊的列 id。 */
  readonly answerOf = new Map<string, string>()
  /** 提問的列 id → 回答開頭（空白收成一格，最多 ANSWER_HEAD 字）與回答全部的字數。 */
  readonly answers = new Map<string, AnswerHead>()
  private owner: string | undefined

  constructor(private readonly isPrompt: (row: SessionMessage) => boolean) {}

  reset() {
    this.ownerOf.clear()
    this.order.clear()
    this.answerOf.clear()
    this.answers.clear()
    this.facts.reset()
    this.owner = undefined
  }

  /** 依序讀進新的列；回傳這批列各自屬於哪一則提問（有新動靜的提問 id）。 */
  ingest(rows: readonly SessionMessage[]): Set<string> {
    const touched = new Set<string>()
    for (const row of rows) {
      const id = row.uuid
      if (id === undefined) continue
      // 同一列讀到第二次（重讀、讀取範圍重疊）時不重複累加回答。
      const isSeen = this.order.has(id)
      this.mark(id)
      if (this.isPrompt(row)) {
        this.owner = id
        touched.add(id)
        this.facts.add(row, id, true)
        continue
      }
      const owner = this.owner
      if (owner === undefined) continue
      touched.add(owner)
      this.facts.add(row, owner, false)
      this.ownerOf.set(id, owner)
      if (row.role === 'assistant') {
        if (row.text.trim() !== '' && !this.answerOf.has(owner)) this.answerOf.set(owner, id)
        if (!isSeen) this.addAnswer(owner, row.text)
        for (const use of row.toolUses) {
          this.mark(use.tool_use_id)
          this.ownerOf.set(use.tool_use_id, owner)
        }
      }
    }

    return touched
  }

  private addAnswer(owner: string, text: string) {
    const line = text.replace(/\s+/g, ' ').trim()
    if (line === '') return
    const was = this.answers.get(owner)
    const head = was === undefined ? line : was.head.length >= ANSWER_HEAD ? was.head : `${was.head} ${line}`
    this.answers.set(owner, {
      head: [...head].slice(0, ANSWER_HEAD).join(''),
      size: (was?.size ?? 0) + [...line].length,
    })
  }

  private mark(id: string) {
    if (!this.order.has(id)) this.order.set(id, this.order.size)
  }
}
