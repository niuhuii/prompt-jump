import type { ModelCompleteResult, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { FactsBook, factsLine, groupChapters } from '../hooks/facts'
import { STRINGS } from '../hooks/i18n'
import { cleanTitle, titleRequest } from '../hooks/titles'

/** 介面語言固定中文，不看這台機器的地區設定。 */
const ZH = { options: { language: 'zh-TW', tickRowPosition: 'above' } } as const

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

const zh = STRINGS['zh-TW']
const user = (uuid: string, text: string): SessionMessage => ({ role: 'user', text, toolUses: [], uuid })
const said = (uuid: string, text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses,
  uuid,
})
const results = (uuid: string, ...r: [string, boolean][]): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  uuid,
  toolResults: r.map(([tool_use_id, isError]) => ({ tool_use_id, text: isError ? 'boom' : 'ok', isError })),
})

/** 一則：改兩個檔（一個失敗）、跑兩個指令（一個失敗）。 */
const busyTurn = (): SessionMessage[] => [
  user('u1', '幫我修 a.ts'),
  said('a1', '', [
    { tool_use_id: 'e1', tool: 'Edit', input: { file_path: '/w/a.ts' } },
    { tool_use_id: 'e2', tool: 'Write', input: { file_path: '/w/b.ts' } },
    { tool_use_id: 'b1', tool: 'Bash', input: { command: 'npm test' } },
    { tool_use_id: 'b2', tool: 'PowerShell', input: { command: 'false' } },
  ]),
  results('r1', ['e1', false], ['e2', true], ['b1', false], ['b2', true]),
  said('a2', '修好了，有一個測試失敗。'),
  user('u2', '謝謝'),
  said('a3', '不客氣'),
]

test('事實從對話紀錄數：成功改過的檔、指令、失敗', ZH, () => {
  const book = new FactsBook()
  let owner: string | undefined
  for (const row of busyTurn()) {
    const isPrompt = row.role === 'user' && row.text !== '' && !row.toolResults
    if (isPrompt) owner = row.uuid
    book.add(row, owner, isPrompt)
  }
  expect(book.byPrompt.get('u1')).toEqual({ files: ['/w/a.ts'], commands: 2, failures: 2 })
  expect(book.byPrompt.get('u2')).toEqual({ files: [], commands: 0, failures: 0 })
})

test('卡片的事實那一行：三個檔以內列檔名、更多顯示數量、沒事就空白', ZH, () => {
  expect(factsLine({ files: ['/w/a.ts'], commands: 2, failures: 1 }, false, zh.facts)).toBe('改 a.ts  2 個指令  1 個失敗')
  expect(factsLine({ files: ['/a', '/b'], commands: 0, failures: 0 }, false, zh.facts)).toBe('改 a、b')
  expect(factsLine({ files: ['/a', '/b', '/c', '/d'], commands: 0, failures: 0 }, false, zh.facts)).toBe('改 4 檔')
  expect(factsLine({ files: [], commands: 0, failures: 0, isAborted: true }, false, zh.facts)).toBe('中斷')
  expect(factsLine({ files: [], commands: 0, failures: 0 }, false, zh.facts)).toBe('')
  expect(factsLine(undefined, true, zh.facts)).toBe('進行中…')
})

test('分段：停超過 15 分鐘開新的一段，沒有時間的跟著前一則', ZH, () => {
  const min = 60_000
  const items = [
    { start: 0, end: 5 * min },
    { start: undefined, end: undefined },
    { start: 10 * min, end: 12 * min },
    { start: 40 * min, end: 41 * min },
  ]
  const ch = groupChapters(items, one => one)
  expect(ch.map(c => c.items.length)).toEqual([3, 1])
  expect(ch[1]!.gapMs).toBe(28 * min)
})

test('標題：送出的內容截短；模型回答太長就不當標題', ZH, () => {
  const req = titleRequest(zh.title, 'x'.repeat(1000), { files: ['/w/a.ts'], commands: 1, failures: 0 }, 'y'.repeat(1000))
  expect(req).toContain('改的檔：a.ts')
  expect(req.length).toBeLessThan(1000)
  expect(cleanTitle('標題：「修好 a.ts 的錯誤」。')).toBe('修好 a.ts 的錯誤')
  expect(cleanTitle('這是一段很長很長的回答，模型沒有照指示寫標題，而是直接開始回答使用者的問題了')).toBeUndefined()
  expect(cleanTitle('   ')).toBeUndefined()
})

// ── 窗格 ──────────────────────────────────────────────────────────────

const PANE = {
  plugin: 'prompt-jump',
  component: 'Pane',
  requestId: 'prompt-jump',
  props: {
    title: '對話目錄',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

type Model = { text?: string; throws?: boolean }

const start = async ($: T$, on: TOn, rows: SessionMessage[], model: Model = {}, dataRules: string[] = []) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 24, 1, 0) })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.info', () => ({ value: { transcriptPath: '', dataRules } }))
  on('session.redact', (_, e) => ({ value: e.text }))
  on('session.messages', () => ({ value: rows }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const calls: string[] = []
  on('model.complete', (_, e) => {
    calls.push(e.prompt)
    if (model.throws) throw new Error('blocked model')
    const usage = { input_tokens: 180, output_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    const value = (
      model.text !== undefined
        ? { isAnswered: true, text: model.text, usage }
        : { isAnswered: false, reason: 'empty-reply', usage }
    ) as ModelCompleteResult
    return { value }
  })
  return { clock, calls, store }
}

/** 一輪：開始 → 紀錄裡多了列 → 答完。 */
const turn = async ($: T$, clock: ReturnType<typeof mock.clock>, rows: SessionMessage[], more: SessionMessage[]) => {
  const id = more[0]!.uuid!
  await $.turn.start({ text: more[0]!.text, turnId: id })
  rows.push(...more)
  await clock.advance(600)
  await $.turn.complete({ answer: '修好了。', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer' })
  await clock.advance(1000)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}：每列右邊有短標記，卡片寫出改了哪個檔`, ZH, async ($, on) => {
    const { clock } = await start($, on, busyTurn())
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    await clock.advance(600)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'p-u1' }))?.text).toMatch(/±1 \$2 ✗2$/)
    expect((await ui.find({ key: 'p-u2' }))?.text).not.toMatch(/[±$✗]/)
    expect(await ui.find({ type: 'Text', text: /改 a\.ts  2 個指令  2 個失敗/ })).toBeDefined()
    await ui.unmount()
  })
}

test('模型在回答時，最後一則顯示進行中', ZH, async ($, on) => {
  const rows = [user('u1', 'hi')]
  const { clock } = await start($, on, rows)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(600)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /進行中…/ })).toBeDefined()
  await ui.unmount()
  // 答完就不再顯示。
  await $.turn.complete({ answer: 'hello', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /進行中…/ })).toBeUndefined()
  await after.unmount()
})

test('自動標題預設關：不呼叫模型', ZH, async ($, on) => {
  const rows: SessionMessage[] = []
  const { clock, calls } = await start($, on, rows, { text: '修好 a.ts' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await turn($, clock, rows, [user('u1', '幫我修 a.ts'), said('a1', '修好了')])
  expect(calls.length).toBe(0)
})

test('自動標題開啟：每輪呼叫一次，標題取代提問，顯示用量', { options: { titles: true, language: 'zh-TW' } }, async ($, on) => {
  const rows: SessionMessage[] = []
  const { clock, calls, store } = await start($, on, rows, { text: '「修好 a.ts 的錯誤」' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await turn($, clock, rows, [user('u1', '幫我修 a.ts'), said('a1', '修好了')])
  expect(calls.length).toBe(1)
  expect(calls[0]).toContain('使用者：幫我修 a.ts')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'p-u1' }))?.text).toContain('修好 a.ts 的錯誤')
  expect(await ui.find({ type: 'Text', text: /用量約 192 tokens/ })).toBeDefined()
  await ui.unmount()
  expect(store.get('titles:S1')).toEqual({ titles: { u1: '修好 a.ts 的錯誤' }, tokens: 192 })
})

test('自動標題開啟但有資料規則（ZDR）：不呼叫模型', { options: { titles: true, language: 'zh-TW' } }, async ($, on) => {
  const rows: SessionMessage[] = []
  const { clock, calls } = await start($, on, rows, { text: 'x' }, ['zdr'])
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await turn($, clock, rows, [user('u1', '幫我修 a.ts'), said('a1', '修好了')])
  expect(calls.length).toBe(0)
})

test('自動標題開啟但沒人在畫面前（-p）：不呼叫模型', { options: { titles: true, language: 'zh-TW' } }, async ($, on) => {
  const rows: SessionMessage[] = []
  const { clock, calls } = await start($, on, rows, { text: 'x' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: false })
  await turn($, clock, rows, [user('u1', '幫我修 a.ts'), said('a1', '修好了')])
  expect(calls.length).toBe(0)
})

test('模型呼叫失敗：目錄照常顯示提問', { options: { titles: true, language: 'zh-TW' } }, async ($, on) => {
  const rows: SessionMessage[] = []
  const { clock } = await start($, on, rows, { throws: true })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await turn($, clock, rows, [user('u1', '幫我修 a.ts'), said('a1', '修好了')])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'p-u1' }))?.text).toContain('幫我修 a.ts')
  await ui.unmount()
})
