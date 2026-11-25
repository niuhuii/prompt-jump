// 每一則「這輪做了什麼」的事實：改了幾個檔、跑了幾個指令、幾個失敗。
// 全部從對話紀錄數出來，不靠模型。不碰 $，方便測試。

import type { SessionMessage } from 'claude-code'

import type { Facts } from '../types'

const FILE_TOOLS: Record<string, 'file_path' | 'notebook_path'> = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
}
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
/** 每則最多記幾個檔名。 */
export const MAX_FILES = 20

export const emptyFacts = (): Facts => ({ files: [], commands: 0, failures: 0 })

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path

/** 依序讀對話紀錄的列，把事實算進各列所屬的那一則。 */
export class FactsBook {
  readonly byPrompt = new Map<string, Facts>()
  /** 還沒拿到結果的改檔呼叫：成功了才算改過那個檔。 */
  private readonly edits = new Map<string, { owner: string; path: string }>()
  private readonly callOwner = new Map<string, string>()

  reset() {
    this.byPrompt.clear()
    this.edits.clear()
    this.callOwner.clear()
  }

  /** owner：這一列屬於哪一則（提問本身傳自己的 id）；undefined 是第一則之前的列。 */
  add(row: SessionMessage, owner: string | undefined, isPrompt: boolean) {
    if (owner === undefined) return
    if (isPrompt) {
      this.byPrompt.set(owner, emptyFacts())
      return
    }
    const facts = this.byPrompt.get(owner)
    if (facts === undefined) return
    if (row.role === 'assistant') {
      for (const use of row.toolUses) {
        this.callOwner.set(use.tool_use_id, owner)
        if (SHELL_TOOLS.has(use.tool)) facts.commands++
        const key = FILE_TOOLS[use.tool]
        const path = key === undefined ? undefined : use.input[key]
        if (typeof path === 'string') this.edits.set(use.tool_use_id, { owner, path })
      }
      return
    }
    if (row.text.startsWith('[Request interrupted')) facts.isAborted = true
    for (const result of row.toolResults ?? []) {
      const of = this.byPrompt.get(this.callOwner.get(result.tool_use_id) ?? owner)
      if (of === undefined) continue
      if (result.isError) of.failures++
      const edit = this.edits.get(result.tool_use_id)
      if (edit === undefined) continue
      this.edits.delete(result.tool_use_id)
      if (!result.isError && !of.files.includes(edit.path) && of.files.length < MAX_FILES) {
        of.files.push(edit.path)
      }
    }
  }
}

export type FactsWords = {
  file: (name: string) => string
  files: (n: number) => string
  commands: (n: number) => string
  failures: (n: number) => string
  aborted: string
  running: string
}

/** 目錄裡每則下面那一行灰字；沒有可說的回空字串。 */
export const factsLine = (f: Facts | undefined, isRunning: boolean, w: FactsWords): string => {
  const parts: string[] = []
  if (f !== undefined) {
    if (f.files.length === 1) parts.push(w.file(baseName(f.files[0]!)))
    else if (f.files.length > 1) parts.push(w.files(f.files.length))
    if (f.commands > 0) parts.push(w.commands(f.commands))
    if (f.failures > 0) parts.push(w.failures(f.failures))
    if (f.isAborted) parts.push(w.aborted)
  }
  if (isRunning) parts.push(w.running)
  return parts.join(' · ')
}

export type Chapter<T> = { index: number; gapMs?: number; items: T[] }

/** 兩輪之間停超過這麼久，就算新的一段。 */
export const CHAPTER_GAP_MS = 15 * 60 * 1000

/**
 * 連續幾則歸成一段：跟上一則最後的動靜隔超過 gapMs 就開新的一段。
 * 沒有時間的（載入前的舊訊息）跟著前一則。
 */
export const groupChapters = <T>(
  items: readonly T[],
  timeOf: (item: T) => { start?: number; end?: number },
  gapMs = CHAPTER_GAP_MS,
): Chapter<T>[] => {
  const chapters: Chapter<T>[] = []
  let lastEnd: number | undefined
  for (const item of items) {
    const { start, end } = timeOf(item)
    const gap = start !== undefined && lastEnd !== undefined ? start - lastEnd : undefined
    if (chapters.length === 0 || (gap !== undefined && gap > gapMs)) {
      chapters.push({ index: chapters.length + 1, gapMs: chapters.length ? gap : undefined, items: [] })
    }
    chapters[chapters.length - 1]!.items.push(item)
    if (end !== undefined || start !== undefined) lastEnd = end ?? start
  }
  return chapters
}
