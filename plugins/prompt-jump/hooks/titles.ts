// 自動標題（設定 titles 開啟時）：每輪結束後請小模型替那一則寫一行標題。
// 純函式：組要送出的文字、整理模型回的字。不碰 $，方便測試。

import type { Facts } from '../types'
import { baseName } from './facts'
import { widthOf } from './toc'

export type TitleWords = {
  system: string
  /** 送給模型的整段文字。 */
  prompt: (input: { prompt: string; files: string; commands: number; failures: number; answer: string }) => string
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** 送出去的只有：提問、改過的檔名（最多 5 個）、指令數、失敗數、回答開頭，各自截短。 */
export const titleRequest = (w: TitleWords, prompt: string, facts: Facts | undefined, answer: string) =>
  w.prompt({
    prompt: oneLine(prompt).slice(0, 300),
    files: (facts?.files ?? []).map(baseName).slice(0, 5).join(', '),
    commands: facts?.commands ?? 0,
    failures: facts?.failures ?? 0,
    answer: oneLine(answer).slice(0, 300),
  })

/**
 * 模型回的字整理成能放進一行的標題。整理完是空的、或長到不像標題
 * （模型跑去回答問題了），就當沒有，目錄改顯示原本的提問。
 */
export const cleanTitle = (text: string): string | undefined => {
  const first =
    text
      .split('\n')
      .map(one => one.trim())
      .find(one => one !== '') ?? ''
  const cleaned = first
    .replace(/^(標題|title)\s*[:：]\s*/i, '')
    .replace(/^[#*\-\s「『"'`]+|[」』"'`*\s。．.！!]+$/g, '')
    .trim()
  // 中文一字兩欄：中文約 30 字、英文約 60 字以內才像標題。
  const cells = widthOf(cleaned)
  if (cells === 0 || cells > 60) return undefined
  return cleaned
}
