import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

/** 介面語言固定中文，不看這台機器的地區設定。 */
const ZH = { options: { language: 'zh-TW' } } as const

// 測試環境沒有真的對話畫面：外掛的 $.ui.scroll 捲對話列時拿不到實作，
// 外掛照實回報「捲不過去」並附上目標。所以這裡用回報文字裡的目標確認它要跳去
// 哪一則；真的捲動要在真畫面上看。

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]
type Seen = { first: number; last: number; of: number }

const user = (uuid: string, text: string): SessionMessage => ({ role: 'user', text, toolUses: [], uuid })
const said = (uuid: string, text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses,
  uuid,
})

/** 三則提問；第 1、2 則有回答，第 2 則改了一個檔。 */
const ROWS = (): SessionMessage[] => [
  user('u1', '登入頁壞了'),
  said('a1', '我看看'),
  user('u2', '幫我改 tiles.tsx'),
  said('a2', '', [{ tool_use_id: 't2', tool: 'Edit', input: { file_path: '/p/tiles.tsx' } }]),
  { role: 'user', text: '', toolUses: [], uuid: 'r2', toolResults: [{ tool_use_id: 't2', text: 'ok', isError: false }] },
  said('a2b', '改好了'),
  user('u3', '登入 API 要加 token'),
]

const BAND = {
  plugin: 'prompt-jump',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const replyBlock = (id: string, onScreen?: Seen) =>
  ({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: id,
    props: { text: '改好了', isFirstOfReply: false, ...(onScreen ? { onScreen } : {}) },
  }) as const

const toasts: string[] = []

const start = async ($: T$, on: TOn, rows = ROWS(), placed = true) => {
  toasts.length = 0
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 24, 1, 0) })
  on('session.messages', () => ({ value: rows }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }))
  on('ui.panes', () => ({
    value: [{ id: 'prompt-jump', title: '對話目錄', isShown: placed, isFocused: false, isPlaced: placed }],
  }))
  on('ui.toast', (_, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  return { clock, rows }
}

const run = ($: T$, command: string, args = '', isFullscreen = true) =>
  $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen, columns: 120 },
  })

const first = (text: string | undefined) => text?.split('\n')[0]

test('/jump 編號、/prev、/next 依序指向對的那一則', ZH, async ($, on) => {
  await start($, on)
  expect(first((await run($, 'jump', '2')).text)).toBe('2. 幫我改 tiles.tsx')
  expect(first((await run($, 'prev')).text)).toBe('1. 登入頁壞了')
  expect(first((await run($, 'next')).text)).toBe('2. 幫我改 tiles.tsx')
  expect(first((await run($, 'jump', 'next')).text)).toBe('3. 登入 API 要加 token')
  expect((await run($, 'next')).text).toBe('已經是最後一則。')
  expect(first((await run($, 'jump', '-3')).text)).toBe('1. 登入頁壞了')
  expect((await run($, 'jump', '9')).text).toBe('沒有第 9 則（目前共 3 則）。')
})

test('還沒跳過時，/prev 從最後一則開始', ZH, async ($, on) => {
  await start($, on)
  expect(first((await run($, 'prev')).text)).toBe('3. 登入 API 要加 token')
})

test('捲不動時照實說原因，並印出那一則的全文', ZH, async ($, on) => {
  await start($, on)
  const text = (await run($, 'jump', '1')).text ?? ''
  expect(text).toContain('捲不過去')
})

test('/jump 關鍵字：一筆直接跳；多筆給選單，選了就跳', ZH, async ($, on) => {
  await start($, on)
  expect(first((await run($, 'jump', 'token')).text)).toBe('3. 登入 API 要加 token')
  const many = await run($, 'jump', '登入')
  expect(many.text).toContain('有 2 則符合')

  const band = await $.ui.mount(BAND)
  expect(await band.find({ key: 'jump-pick' })).toBeDefined()
  await band.select({ key: 'jump-pick', value: 'u1' })
  await band.unmount()
  // 選了第 1 則：下一則是第 2 則，選單收起來。
  expect(first((await run($, 'next')).text)).toBe('2. 幫我改 tiles.tsx')
  const again = await $.ui.mount(BAND)
  expect(await again.find({ key: 'jump-pick' })).toBeUndefined()
  expect(await again.find({ key: 'band-prev' })).toBeDefined()
  await again.unmount()
})

test('一般版面：多筆符合只印清單，不出選單', ZH, async ($, on) => {
  await start($, on)
  const many = await run($, 'jump', '登入', false)
  expect(many.text).toContain('有 2 則符合')
  expect(many.text).not.toContain('選單')
})

test('/jump 不帶參數：開窗格；窗格放不下時改給選單', ZH, async ($, on) => {
  await start($, on, ROWS(), false)
  const text = (await run($, 'jump')).text ?? ''
  expect(text).toContain('放不下')
  const band = await $.ui.mount(BAND)
  expect(await band.find({ key: 'jump-pick' })).toBeDefined()
  await band.unmount()
})

test('/jump 不帶參數、窗格放得下：說已開啟', ZH, async ($, on) => {
  await start($, on)
  expect((await run($, 'jump')).text).toBe('對話目錄已開啟。')
})

test('/ans 指向最後一個回答的開頭；還沒回答時照實說', ZH, async ($, on) => {
  const { clock, rows } = await start($, on)
  expect((await run($, 'ans')).text).toBe('最後一則還沒有回答。')
  rows.push(said('a3', '加好了'))
  await clock.advance(600)
  expect(first((await run($, 'ans')).text)).toBe('第 3 則的回答開頭')
})

test('/mark 記下畫面最上方那一列，/jump @名稱、/marks 名稱 跳回去', ZH, async ($, on) => {
  await start($, on)
  // 全螢幕版面回報：第 2 則的回答捲到一半在最上面。
  const block = await $.ui.mount(replyBlock('a2b', { first: 5, last: 20, of: 30 }))
  await block.unmount()

  expect((await run($, 'mark', '改檔')).text).toBeUndefined()
  expect(toasts.at(-1)).toContain('畫面最上方的2. 幫我改 tiles.tsx')
  expect(first((await run($, 'jump', '@改檔')).text)).toBe('書籤「改檔」')
  expect(first((await run($, 'marks', '改')).text)).toBe('書籤「改檔」')

  await run($, 'mark')
  expect(toasts.at(-1)).toContain('書籤 1')
  const list = await run($, 'marks')
  expect(list.text).toContain('書籤 2 個')
  // 兩個書籤記在同一列：選單的值仍然不能重複。
  const band = await $.ui.mount(BAND)
  expect(await band.find({ key: 'jump-pick' })).toBeDefined()
  await band.unmount()

  expect((await run($, 'unmark', '改檔')).text).toBe('已刪除書籤「改檔」。')
  await run($, 'unmark', '書籤 1')
  expect((await run($, 'marks')).text).toContain('還沒有書籤')
  // 書籤選單裡的都刪光了：選單收起來，不留已刪的書籤。
  const after = await $.ui.mount(BAND)
  expect(await after.find({ key: 'jump-pick' })).toBeUndefined()
  await after.unmount()
})

test('上方列：位置、上一則／下一則／回答／清單，按鈕在各畫面都能按', ZH, async ($, on) => {
  await start($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: '3' })).toBeDefined()
    await band.press({ key: 'band-prev' })
    await band.unmount()
  }
  // 按了兩次「上一則」：第 3 則、再第 2 則。
  expect(first((await run($, 'next')).text)).toBe('3. 登入 API 要加 token')
  expect(toasts.some(t => t.includes('捲不回去'))).toBe(true)
})

test('一般版面（非全螢幕）捲不動對話：上方列不出現', ZH, async ($, on) => {
  await start($, on)
  const band = await $.ui.mount({ ...BAND, viewport: { columns: 120, rows: 40, isFullscreen: false } })
  expect(await band.find({ key: 'band-prev' })).toBeUndefined()
  await band.unmount()
})

test('打 /jump 關鍵字 時，自動完成列出符合的訊息', ZH, async ($, on) => {
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  await start($, on)
  const text = '/jump 登入'
  // 型別上 test 的 $.prompt 沒列 autocomplete，執行期有；照引擎呼叫的形狀給。
  const engine = $.prompt as unknown as {
    autocomplete: (e: { text: string; cursor: number; token: string; start: number }) => Promise<{
      suggestions: { text: string }[]
    }>
  }
  const result = await engine.autocomplete({ text, cursor: text.length, token: '登入', start: 6 })
  expect(result.suggestions.map(one => one.text)).toEqual(['3', '1'])
})
