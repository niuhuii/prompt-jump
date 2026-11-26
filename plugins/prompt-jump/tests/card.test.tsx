// 0.3.1：清單的預覽卡片不蓋住相鄰的列；/jump 與刻度列看的是同一個對話。

import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { cardTop } from '../hooks/card'
import { STRINGS } from '../hooks/i18n'

const ZH = { options: { language: 'zh-TW' } } as const
const zh = STRINGS['zh-TW']

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]
type Found = { props: Record<string, unknown>; children: unknown[]; text?: string }

const user = (uuid: string, text: string): SessionMessage => ({ role: 'user', text, toolUses: [], uuid })
const said = (uuid: string, text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [], uuid })

/** n 則提問，每則一句回答。 */
const many = (n: number) => {
  const rows: SessionMessage[] = []
  for (let i = 1; i <= n; i++) rows.push(user(`u${i}`, `第 ${i} 個問題`), said(`a${i}`, `第 ${i} 個回答`))
  return rows
}

const PANE = (bodyRows: number, placement: 'dock' | 'inline' = 'dock', offset = 0) =>
  ({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-jump',
    viewport: { columns: 160, rows: 44, isFullscreen: true },
    props: {
      title: '對話目錄',
      isFocused: false,
      bodyColumns: 44,
      placement,
      scroll: { offset, bodyRows },
      view: {},
    },
  }) as const

const BAND = {
  plugin: 'prompt-jump',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'band',
  viewport: { columns: 100, rows: 30, isFullscreen: true },
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 5,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const start = async ($: T$, on: TOn, rows: SessionMessage[], isPlaced = true) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 9, 0) })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.messages', () => ({ value: rows }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({
    value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is 84 columns; the pane needs 110' },
  }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  return clock
}

const run = ($: T$, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 84 } })

/** 一張卡片蓋住的列（內容的第幾列）。 */
const covered = (card: Found) => {
  const top = card.props.top as number
  const height = card.props.height as number
  return { top, end: top + height }
}

// ── 純函式 ──────────────────────────────────────────────────────────

test('卡片：清單底下的空白放得下時放在清單正下方，什麼都不蓋', () => {
  for (let rowY = 2; rowY < 12; rowY++) {
    expect(cardTop({ rowY, height: 7, offset: 0, windowRows: 40, contentRows: 12, hasRoomBelow: true })).toBe(12)
  }
  // 提示框上方的窗格框貼著內容：底下沒有空白可放。
  expect(cardTop({ rowY: 2, height: 1, offset: 0, windowRows: 8, contentRows: 8, hasRoomBelow: false })).toBe(7)
})

test('卡片：指標一列一列往下或往上移，下一個位置永遠不在目前那張卡片底下', () => {
  const bad: string[] = []
  let placed = 0
  for (const hasRoomBelow of [true, false]) {
    for (let windowRows = 4; windowRows <= 50; windowRows++) {
      for (const contentRows of [windowRows, windowRows + 3, windowRows * 3]) {
        for (const offset of [0, 1, Math.max(0, contentRows - windowRows)]) {
          for (let height = 1; height <= 7; height++) {
            const last = Math.min(contentRows, offset + windowRows) - 1
            for (let rowY = offset; rowY <= last; rowY++) {
              const top = cardTop({ rowY, height, offset, windowRows, contentRows, hasRoomBelow })
              if (top === undefined) continue
              placed++
              const end = top + height
              const at = `${JSON.stringify({ rowY, height, offset, windowRows, contentRows, hasRoomBelow })} -> ${top}`
              // 卡片整張在視窗裡。
              if (top < offset || end > offset + windowRows) bad.push(`outside ${at}`)
              // 不蓋住指到的那一列，也不蓋住指標往上、往下的下一個位置。
              for (const next of [rowY - 1, rowY, rowY + 1]) {
                if (next < offset || next > last) continue
                if (next >= top && next < end) bad.push(`covers ${next}: ${at}`)
              }
            }
          }
        }
      }
    }
  }
  expect(bad.slice(0, 5)).toEqual([])
  expect(placed).toBeGreaterThan(1000)
})

test('卡片：視窗太矮、整張卡片放不下時回 undefined（改用一行的小卡片）', () => {
  expect(cardTop({ rowY: 3, height: 7, offset: 0, windowRows: 10, contentRows: 20, hasRoomBelow: true })).toBeUndefined()
  expect(cardTop({ rowY: 3, height: 1, offset: 0, windowRows: 10, contentRows: 20, hasRoomBelow: true })).toBe(9)
  expect(cardTop({ rowY: 7, height: 1, offset: 0, windowRows: 10, contentRows: 20, hasRoomBelow: true })).toBe(0)
  expect(cardTop({ rowY: 0, height: 1, offset: 0, windowRows: 3, contentRows: 20, hasRoomBelow: true })).toBeUndefined()
})

// ── 清單畫面 ────────────────────────────────────────────────────────

// 清單內容：第 0 列篩選框、第 1 列狀態，第 i 則提問在第 i + 1 列（載入前的舊訊息沒有時間，不分段）。
const rowOf = (n: number) => n + 1

test('清單比窗格長：每張卡片都不蓋住它那一列和上下相鄰的列', ZH, async ($, on) => {
  await start($, on, many(40))
  for (const offset of [0, 12, 22]) {
    const bodyRows = 20
    const ui = await $.ui.mount(PANE(bodyRows, 'dock', offset))
    for (let n = 1; n <= 40; n++) {
      const y = rowOf(n)
      if (y < offset || y >= offset + bodyRows) continue
      const card = (await ui.find({ key: `k-u${n}` })) as Found | undefined
      expect(card).toBeDefined()
      const { top, end } = covered(card!)
      expect(top >= offset && end <= offset + bodyRows).toBe(true)
      for (const next of [y - 1, y, y + 1]) expect(next >= top && next < end).toBe(false)
    }
    await ui.unmount()
  }
})

test('清單比窗格短：卡片放在清單底下的空白，不蓋任何一列', ZH, async ($, on) => {
  await start($, on, many(5))
  const ui = await $.ui.mount(PANE(30))
  for (let n = 1; n <= 5; n++) {
    const card = (await ui.find({ key: `k-u${n}` })) as Found
    expect(card.props.top).toBe(rowOf(5) + 1)
    // 卡片平常藏著，指到那一列（同一個 hover 群組）才出現；高度是算好的列數。
    expect(card.props.display).toBe('none')
    expect(card.props.height).toBe(4)
  }
  await ui.unmount()
})

test('提示框上方的矮窗格：一行的小卡片，寫編號和回答開頭，也不蓋相鄰的列', ZH, async ($, on) => {
  await start($, on, many(12))
  const bodyRows = 8
  const ui = await $.ui.mount(PANE(bodyRows, 'inline'))
  for (let n = 1; n <= 6; n++) {
    const y = rowOf(n)
    const card = (await ui.find({ key: `k-u${n}` })) as Found
    const { top, end } = covered(card)
    expect(end - top).toBe(1)
    expect(end <= bodyRows).toBe(true)
    for (const next of [y - 1, y, y + 1]) expect(next >= top && next < end).toBe(false)
    expect(JSON.stringify(card.children)).toContain(`第 ${n} 個回答`)
    expect(JSON.stringify(card.children)).toContain(`${n}  `)
  }
  await ui.unmount()
})

// ── /jump 與刻度列 ─────────────────────────────────────────────────

test('第一則還在進行中：刻度列和 /jump 都算到它（窗格放不下時給選單）', ZH, async ($, on) => {
  const rows = [user('u1', '設定檔有每個版本的備份嗎？ 看資料庫')]
  const clock = await start($, on, rows, false)
  await $.turn.start({ text: rows[0]!.text, turnId: 't1' })
  // 畫面回報那一則露在最上面（全螢幕版面的 onScreen），刻度列就知道目前在第 1 則。
  const shown = await $.ui.mount({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'u1',
    props: { text: '', origin: { kind: 'composer' }, isExpanded: false, onScreen: { first: 0, last: 2, of: 3 } },
  } as never)
  await shown.unmount()
  await clock.advance(600)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ key: 't-u1' })).toBeDefined()
  expect(JSON.stringify(((await band.find({ key: 'pv' })) as Found | undefined)?.children)).toContain('進行中')
  await band.unmount()

  const reply = (await run($, 'jump')).text ?? ''
  expect(reply).not.toBe(zh.noPrompts)
  expect(reply).toContain('放不下')
  const menu = await $.ui.mount(BAND)
  const pick = (await menu.find({ key: 'jump-pick' })) as Found | undefined
  expect((pick?.props.options as { label: string }[]).map(o => o.label)).toEqual(['1. 設定檔有每個版本的備份嗎？ 看資料庫'])
  await menu.unmount()
  expect((await run($, 'jump', '1')).text).toContain('1. 設定檔有每個版本')
})

test('還沒有提問的對話：/jump 說的是「這個對話」，刻度列也不畫', ZH, async ($, on) => {
  await start($, on, [], false)
  expect((await run($, 'jump')).text).toBe(zh.noPrompts)
  expect(zh.noPrompts).toContain('這個對話')
  expect(STRINGS.en.noPrompts).toContain('this conversation')
  const band = await $.ui.mount(BAND)
  expect(await band.find({ key: 'ticks' })).toBeUndefined()
  await band.unmount()
  // 清單打得開時，空的清單也說是「這個對話」。
  const pane = await $.ui.mount(PANE(20))
  expect(await pane.find({ type: 'Text', text: zh.statusEmpty })).toBeDefined()
  expect(zh.statusEmpty).toContain('這個對話')
  await pane.unmount()
})
