import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { cleanPrompt, clip, filterIndexes, widthOf } from '../hooks/toc'

/** 介面語言固定中文，不看這台機器的地區設定。 */
const ZH = { options: { language: 'zh-TW', tickRowPosition: 'above' } } as const

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

const row = (uuid: string, text: string, extra: Partial<SessionMessage> = {}) =>
  ({ role: 'user', text, toolUses: [], uuid, ...extra }) as SessionMessage

const pane = (bodyColumns = 60) =>
  ({
    plugin: 'prompt-jump',
    component: 'Pane',
    requestId: 'prompt-jump',
    surface: 'terminal',
    props: {
      title: '對話目錄',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  }) as const

const start = async ($: T$, on: TOn, rows: SessionMessage[], placed = true) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 24, 1, 0) })
  on('session.messages', () => ({ value: rows }))
  on('command.register', () => ({ value: { command: 'jump' } }))
  on('ui.open', () => ({ value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }))
  on('ui.panes', () => ({
    value: [{ id: 'prompt-jump', title: '對話目錄', isShown: placed, isFocused: false, isPlaced: placed }],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  return clock
}

test('cleanPrompt 只留使用者自己打的字', ZH, () => {
  expect(cleanPrompt('  幫我\n看一下  ')).toBe('幫我 看一下')
  expect(cleanPrompt('修好它<system-reminder>x\ny</system-reminder>')).toBe('修好它')
  expect(cleanPrompt('<command-name>/jump</command-name>')).toBe('')
  expect(cleanPrompt('<task-notification>done</task-notification>')).toBe('')
  expect(cleanPrompt('[Request interrupted by user]')).toBe('')
})

test('中文佔兩欄，截斷不超過欄數', ZH, () => {
  expect(widthOf('ab中文')).toBe(6)
  expect(clip('中文中文中文', 7)).toBe('中文中…')
  expect(widthOf(clip('中文中文中文', 7))).toBeLessThanOrEqual(7)
  expect(clip('short', 10)).toBe('short')
})

test('篩選：不分大小寫、每個詞都要有、數字比對編號', ZH, () => {
  const list = [
    { id: 'a', text: 'Fix the Login bug' },
    { id: 'b', text: '會議室 查詢' },
    { id: 'c', text: 'login page style' },
  ]
  expect(filterIndexes(list, 'login')).toEqual([0, 2])
  expect(filterIndexes(list, 'login bug')).toEqual([0])
  expect(filterIndexes(list, '會議室')).toEqual([1])
  expect(filterIndexes(list, '2')).toEqual([1])
  expect(filterIndexes(list, '')).toEqual([0, 1, 2])
})

test('載入前就有的舊訊息直接從對話紀錄進目錄，順序照紀錄', ZH, async ($, on) => {
  await start($, on, [
    row('u-1', 'first question'),
    { role: 'assistant', text: 'answer', toolUses: [], uuid: 'a-1' },
    row('u-2', '', { toolResults: [] }),
    row('u-3', '<command-name>/jump</command-name>'),
    row('u-4', 'second question'),
  ])
  // 沒有任何一則被畫過。
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'p-u-1' }))?.text).toContain('1  first question')
  expect((await ui.find({ key: 'p-u-4' }))?.text).toContain('2  second question')
  expect(await ui.find({ key: 'p-u-3' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '2 則' })).toBeDefined()
  await ui.unmount()
})

test('每列不印時間；舊訊息不知道時間，不畫分段線', ZH, async ($, on) => {
  const rows = [row('u-1', 'old one')]
  const clock = await start($, on, rows)
  rows.push(row('u-2', 'new one'))
  await clock.advance(600)
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'p-u-2' }))?.text).not.toMatch(/\d\d:\d\d/)
  expect((await ui.find({ key: 'p-u-1' }))?.text).not.toMatch(/\d\d:\d\d/)
  expect(await ui.find({ type: 'Text', text: /^── / })).toBeUndefined()
  await ui.unmount()
})

test('新的 session（紀錄一開始是空的）：第一則也記下時間', ZH, async ($, on) => {
  const rows: SessionMessage[] = []
  const clock = await start($, on, rows)
  rows.push(row('u-1', 'first one'))
  await clock.advance(600)
  const ui = await $.ui.mount(pane())
  expect((await ui.find({ key: 'p-u-1' }))?.text ?? '').not.toMatch(/\d\d:\d\d/)
  // 時間在分段線上。
  expect(await ui.find({ type: 'Text', text: /^── \d\d:\d\d ─+$/ })).toBeDefined()
  await ui.unmount()
})

test('篩選框打字後只列出符合的', ZH, async ($, on) => {
  await start($, on, [row('u-1', 'alpha'), row('u-2', 'beta'), row('u-3', 'alpha again')])
  const ui = await $.ui.mount(pane())
  await ui.input({ key: 'q', text: 'alpha', kind: 'change' })
  expect(await ui.find({ key: 'p-u-2' })).toBeUndefined()
  expect(await ui.find({ key: 'p-u-3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '符合 2 / 3' })).toBeDefined()
  await ui.input({ key: 'q', text: 'zzz', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /沒有符合「zzz」/ })).toBeDefined()
  await ui.unmount()
})

test('長訊息截在窗格寬度內', ZH, async ($, on) => {
  await start($, on, [row('u-1', '這是一則非常非常長的中文訊息'.repeat(5))])
  const ui = await $.ui.mount(pane(30))
  const text = (await ui.find({ key: 'p-u-1' }))?.text ?? ''
  expect(text.endsWith('…')).toBe(true)
  // 沒有外框，整列不超過窗格寬度。
  expect(widthOf(text)).toBeLessThanOrEqual(30)
  await ui.unmount()
})

test('窄畫面窗格放不上去時，輸入框上方有一行目錄', ZH, async ($, on) => {
  const clock = await start($, on, [row('u-1', 'alpha'), row('u-2', 'beta')], false)
  await clock.advance(600)
  const band = await $.ui.mount({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 5,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 5 },
      view: {},
    },
  })
  // 不知道目前位置時，左邊只寫則數，第二列是用法提示。
  expect(await band.find({ type: 'Text', text: '2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^指到刻度/ })).toBeDefined()
  expect(await band.find({ key: 't-u-1' })).toBeDefined()
  expect(await band.find({ key: 'band-prev' })).toBeDefined()
  expect(await band.find({ key: 'band-open' })).toBeDefined()
  await band.unmount()
})

test('/jump 沒有這個編號或關鍵字時說找不到', ZH, async ($, on) => {
  await start($, on, [row('u-1', 'alpha')])
  const run = (args: string) =>
    $.command.run({
      command: 'jump',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 80 },
    })
  expect((await run('9')).text).toBe('沒有第 9 則（目前共 1 則）。')
  expect((await run('zzz')).text).toBe('找不到「zzz」。')
})
