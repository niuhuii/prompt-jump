// 把 Edit／Write／MultiEdit 的結果算成一行摘要要用的數字。不碰 $，方便測試。

export const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
])

export type EditSummary =
  | { kind: 'create'; name: string }
  | { kind: 'edit'; name: string; added: number; removed: number }

/** 看得懂就回摘要；不是改檔結果的形狀就回 undefined（交回原本的畫法）。 */
export const summarizeEdit = (output: unknown): EditSummary | undefined => {
  const out = output as {
    filePath?: unknown
    type?: unknown
    structuredPatch?: unknown
  } | null
  if (!out || typeof out.filePath !== 'string') return undefined

  const name = out.filePath.split(/[\\/]/).pop() || out.filePath
  if (out.type === 'create') return { kind: 'create', name }

  let added = 0
  let removed = 0
  const hunks = Array.isArray(out.structuredPatch) ? out.structuredPatch : []
  for (const hunk of hunks) {
    const lines = (hunk as { lines?: unknown })?.lines
    if (!Array.isArray(lines)) continue
    for (const l of lines) {
      if (typeof l !== 'string') continue
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
  }

  return { kind: 'edit', name, added, removed }
}
