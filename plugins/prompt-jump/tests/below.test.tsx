// 0.3.2：刻度列＋預覽列在狀態列（輸入框下方、唯讀），上方只留一列按鈕；tickRowPosition=above 還是 0.3.1 的樣子。

import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { parseJump } from '../hooks/nav'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

const BELOW = { options: { language: 'zh-TW' } } as const
const ABOVE = { options: { language: 'zh-TW', tickRowPosition: 'above' } } as const

const user = (uuid: string, text: string): SessionMessage => ({ role: 'user', text, toolUses: [], uuid })
const said = (uuid: string, text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [], uuid })

const ROWS: SessionMessage[] = [
  user('u1', '登入頁壞了'),
  said('a1', '我看看'),
  user('u2', '把磚塊排整齊'),
  said('a2', '排好了'),
  user('u3', '為什麼又登出了'),
  said('a3', '因為 token 過期'),
]

const ABOVE_EVENT = (maxRows = 5) =>
  ({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: 100, rows: 30, isFullscreen: true },
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows,
      bodyColumns: 100,
      scroll: { offset: 0, bodyRows: maxRows },
      view: {},
    },
  }) as const

/** 狀態列：text 是 claude-hud 那幾行字。 */
const STATUS = (text: string | null, maxRows = 5, isFullscreen = true) =>
  ({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'StatusLine',
    requestId: 'status',
    viewport: { columns: 100, rows: 30, isFullscreen },
    props: { text, isManaged: false, isWorking: false, maxRows, columns: 100 },
  }) as const

const HUD3 = '[Haiku] │ proj\nContext ░░░ 0%\nUsage ░░░ 1%'

/** 讓某一則「露在畫面最上方」，目前位置就是它（預覽列才會是那一則）。 */
const standAt = async ($: T$, clock: { advance: (ms: number) => Promise<unknown> }, id: string) => {
  const row = await $.ui.mount({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: id,
    props: { text: '', origin: { kind: 'composer' }, isExpanded: false, onScreen: { first: 0, last: 2, of: 3 } },
  } as never)
  await row.unmount()
  await clock.advance(600)
}

const start = async ($: T$, on: TOn) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 24, 1, 0) })
  on('ui.focus', { plugin: '*' }, () => ({}))
  on('session.messages', () => ({ value: ROWS }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  await standAt($, clock, 'u2')
}

test('below（預設）：狀態列有刻度與預覽，刻度是唯讀的方塊不是按鈕', BELOW, async ($, on) => {
  await start($, on)
  const status = await $.ui.mount(STATUS(HUD3))
  for (const id of ['u1', 'u2', 'u3']) {
    expect(await status.find({ key: `t-${id}` })).toBeDefined()
    expect(await status.find({ type: 'Button', key: `t-${id}` })).toBeUndefined()
  }
  expect(await status.find({ key: 'pv' })).toBeDefined()
  // 沒有按鈕列的按鈕，也沒有熱鍵。
  expect(await status.find({ type: 'Button', key: 'band-prev' })).toBeUndefined()
  await status.unmount()
})

test('below：上方只留一列按鈕（k j a l），沒有刻度', BELOW, async ($, on) => {
  await start($, on)
  const band = await $.ui.mount(ABOVE_EVENT())
  for (const key of ['band-prev', 'band-next', 'band-ans', 'band-open']) {
    expect(await band.find({ type: 'Button', key })).toBeDefined()
  }
  expect(await band.find({ key: 't-u1' })).toBeUndefined()
  expect(await band.find({ key: 'pv' })).toBeUndefined()
  await band.unmount()
})

test('above：刻度、預覽、按鈕都在上方，狀態列不動', ABOVE, async ($, on) => {
  await start($, on)
  const band = await $.ui.mount(ABOVE_EVENT())
  expect(await band.find({ type: 'Button', key: 't-u2' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'band-prev' })).toBeDefined()
  await band.unmount()
  const status = await $.ui.mount(STATUS(HUD3))
  expect(await status.find({ key: 't-u1' })).toBeUndefined()
  await status.unmount()
})

test('below：claude-hud 太高時先拿掉預覽列，再拿掉刻度列', BELOW, async ($, on) => {
  await start($, on)
  // HUD 3 行：5 列放得下刻度＋預覽；4 列只放刻度；3 列都放不下。
  const five = await $.ui.mount(STATUS(HUD3, 5))
  expect(await five.find({ key: 't-u1' })).toBeDefined()
  expect(await five.find({ key: 'pv' })).toBeDefined()
  await five.unmount()
  const four = await $.ui.mount(STATUS(HUD3, 4))
  expect(await four.find({ key: 't-u1' })).toBeDefined()
  expect(await four.find({ key: 'pv' })).toBeUndefined()
  await four.unmount()
  const three = await $.ui.mount(STATUS(HUD3, 3))
  expect(await three.find({ key: 't-u1' })).toBeUndefined()
  await three.unmount()
})

test('below：沒有 claude-hud（text 為 null）時整段都給刻度與預覽；一般版面不畫', BELOW, async ($, on) => {
  await start($, on)
  const bare = await $.ui.mount(STATUS(null, 2))
  expect(await bare.find({ key: 't-u1' })).toBeDefined()
  expect(await bare.find({ key: 'pv' })).toBeDefined()
  await bare.unmount()
  const main = await $.ui.mount(STATUS(HUD3, 5, false))
  expect(await main.find({ key: 't-u1' })).toBeUndefined()
  await main.unmount()
})

test('/jump pane、/jump list 和 /jump 一樣開清單', BELOW, () => {
  expect(parseJump('pane')).toEqual({ kind: 'pane' })
  expect(parseJump('List')).toEqual({ kind: 'pane' })
  expect(parseJump('清單')).toEqual({ kind: 'pane' })
  expect(parseJump('')).toEqual({ kind: 'pane' })
})
