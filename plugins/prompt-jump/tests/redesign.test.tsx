// 0.3.0：刻度列＋預覽列、整理版清單、搜尋擴大到回答與檔名、一般版面的一次性說明。

import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { TICKS, factsTail, workLevel } from '../hooks/facts'
import { STRINGS } from '../hooks/i18n'
import { needsNote, reasonText, search, snippet } from '../hooks/search'
import { planTicks } from '../hooks/ticks'
import { widthOf } from '../hooks/toc'
import { TranscriptIndex } from '../hooks/transcript'

const ZH = { options: { language: 'zh-TW', tickRowPosition: 'above' } } as const
const zh = STRINGS['zh-TW']

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]
type Found = { props: Record<string, unknown>; children: unknown[] }

const user = (uuid: string, text: string): SessionMessage => ({ role: 'user', text, toolUses: [], uuid })
const said = (uuid: string, text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses,
  uuid,
})
const done = (uuid: string, id: string, isError = false): SessionMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  uuid,
  toolResults: [{ tool_use_id: id, text: isError ? 'error' : 'ok', isError }],
})

/** 第 2 則改了 tiles.tsx（提問裡沒有這個字），第 3 則的回答提到 token 過期，第 3 則有一個失敗。 */
const ROWS = (): SessionMessage[] => [
  user('u1', '登入頁壞了'),
  said('a1', '我看看，是樣式的問題'),
  user('u2', '把磚塊排整齊'),
  said('a2', '', [{ tool_use_id: 'e2', tool: 'Edit', input: { file_path: '/w/src/tiles.tsx' } }]),
  done('r2', 'e2'),
  said('a2b', '排好了'),
  user('u3', '為什麼又登出了'),
  said('a3', '', [{ tool_use_id: 'b3', tool: 'Bash', input: { command: 'npm test' } }]),
  done('r3', 'b3', true),
  said('a3b', '因為 token 過期，重新整理時沒有換新的 token'),
]

const BAND = (bodyColumns = 100, maxRows = 5) =>
  ({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows,
      bodyColumns,
      scroll: { offset: 0, bodyRows: maxRows },
      view: {},
    },
  }) as const

const PANE = (bodyColumns = 44, isFullscreen = true) =>
  ({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-jump',
    viewport: { columns: 160, rows: 40, isFullscreen },
    props: {
      title: '對話目錄',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  }) as const

const toasts: string[] = []
const opened: string[] = []

const start = async ($: T$, on: TOn, rows = ROWS()) => {
  toasts.length = 0
  opened.length = 0
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 24, 1, 0) })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  // 全螢幕版面捲得動；一般版面照引擎的說法拒絕。
  on('ui.focus', { plugin: '*' }, () => ({}))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('session.messages', () => ({ value: rows }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  return { clock, rows }
}

/**
 * 測試環境捲不了對話（$.ui.scroll 捲對話列沒有實作），所以用「那一則露在畫面
 * 最上方」讓目前位置變成它，跟全螢幕版面回報 onScreen 的路一樣。
 */
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

const run = ($: T$, command: string, args = '', isFullscreen = true) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 120 } })

/** 一顆刻度按鈕裡那個字的顏色。 */
const colorOf = (found: Found | undefined) => ((found?.children[0] as Found | undefined)?.props.color as string) ?? ''

// ── 純函式 ──────────────────────────────────────────────────────────

test('搜尋：每個詞可以在提問、回答或檔名其中一處，並記下是哪一種符合', ZH, () => {
  const list = [
    { text: '登入頁壞了', answer: '是樣式的問題' },
    { text: '把磚塊排整齊', files: ['/w/src/tiles.tsx'] },
    { text: '為什麼又登出了', answer: '因為 token 過期' },
  ]
  expect(search(list, 'tiles.tsx')).toEqual([{ index: 1, sources: ['file'], file: 'tiles.tsx' }])
  expect(search(list, 'TOKEN')).toEqual([{ index: 2, sources: ['answer'], answerWord: 'token' }])
  expect(search(list, '登入').map(h => h.sources)).toEqual([['prompt']])
  // 兩個詞分在兩處也算。
  expect(search(list, '磚塊 tiles').map(h => [h.index, h.sources])).toEqual([[1, ['prompt', 'file']]])
  // 檔名只比對最後一段，不比對資料夾。
  expect(search(list, 'src')).toEqual([])
  expect(search(list, '2').map(h => h.index)).toEqual([1])
  expect(search(list, '').map(h => h.index)).toEqual([0, 1, 2])
})

test('符合原因：檔名、回答一定寫出來；提問符合但被截掉時也寫', ZH, () => {
  const one = { text: '很長的一段提問'.repeat(6) + ' 結尾關鍵字', answer: '前面一大段說明'.repeat(4) + ' 換新的 token 就好' }
  const [byAnswer] = search([one], 'token')
  expect(needsNote(byAnswer!, '很長的…')).toBe(true)
  expect(reasonText(byAnswer!, one, 30, zh.reason)).toMatch(/^回答：…/)
  expect(reasonText(byAnswer!, one, 30, zh.reason)).toContain('token')
  expect(widthOf(reasonText(byAnswer!, one, 30, zh.reason))).toBeLessThanOrEqual(30)

  const [byPrompt] = search([one], '結尾關鍵字')
  expect(needsNote(byPrompt!, '很長的一段提問…')).toBe(true)
  expect(needsNote(byPrompt!, one.text)).toBe(false)
  expect(reasonText(byPrompt!, one, 30, zh.reason)).toContain('結尾關鍵字')

  const file = { text: '排整齊', files: ['/w/tiles.tsx'] }
  expect(reasonText(search([file], 'tiles')[0]!, file, 30, zh.reason)).toBe('檔名 tiles.tsx')
})

test('snippet 以那個詞為中心截，前面被截掉時加「…」', ZH, () => {
  expect(snippet('abcdefghij token xyz', 'token', 12)).toMatch(/^….*token/)
  expect(snippet('short', 'x', 12)).toBe('short')
})

test('短標記與刻度高度', ZH, () => {
  expect(factsTail({ files: ['/a', '/b'], commands: 4, failures: 1 }, false, zh.facts)).toEqual([
    { text: '±2' },
    { text: '$4' },
    { text: '✗1', isFailure: true },
  ])
  expect(factsTail(undefined, true, zh.facts)).toEqual([{ text: '進行中' }])
  expect(factsTail({ files: [], commands: 0, failures: 0 }, false, zh.facts)).toEqual([])
  expect(workLevel(undefined)).toBe(0)
  expect(workLevel({ files: [], commands: 1, failures: 0 })).toBe(1)
  expect(workLevel({ files: ['/a'], commands: 1, failures: 0 })).toBe(3)
  expect(workLevel({ files: ['/a', '/b'], commands: 2, failures: 0 })).toBe(4)
  expect(workLevel({ files: ['/a', '/b', '/c'], commands: 4, failures: 0 })).toBe(5)
  expect(workLevel({ files: [], commands: 0, failures: 0 }, 3000)).toBe(4)
  expect(workLevel({ files: Array(20).fill('/x'), commands: 200, failures: 0 })).toBe(TICKS.length - 1)
})

test('刻度排法：放得下時每根兩欄，停很久的地方空一格', ZH, () => {
  const plan = planTicks(5, 2, 40, i => i === 3)
  expect(plan.per).toBe(2)
  expect(plan.items.map(t => t.col)).toEqual([0, 2, 4, 8, 10])
  expect([plan.before, plan.after]).toEqual([0, 0])
})

test('刻度排法：60 則放不下時只畫目前附近一段，左右標還有幾則', ZH, () => {
  const plan = planTicks(60, 30, 40, () => false)
  expect(plan.per).toBe(1)
  expect(plan.items.some(t => t.index === 30)).toBe(true)
  expect(plan.before).toBeGreaterThan(0)
  expect(plan.after).toBeGreaterThan(0)
  expect(plan.width).toBeLessThanOrEqual(40)
  expect(plan.before + plan.items.length + plan.after).toBe(60)
  // 不知道目前位置時，從最後一則往前畫。
  const tail = planTicks(60, -1, 40, () => false)
  expect(tail.after).toBe(0)
  expect(tail.items.at(-1)?.index).toBe(59)
  // 60 則在寬畫面一列放得下。
  expect(planTicks(60, 10, 130, () => false).items.length).toBe(60)
})

test('對話紀錄記下每則回答的開頭和長度', ZH, () => {
  const index = new TranscriptIndex(row => row.role === 'user' && row.text !== '' && !row.toolResults)
  index.ingest(ROWS())
  expect(index.answers.get('u3')?.head).toBe('因為 token 過期，重新整理時沒有換新的 token')
  expect(index.answers.get('u2')?.head).toBe('排好了')
  expect(index.answers.get('u1')?.size).toBe([...'我看看，是樣式的問題'].length)
})

// ── 指令與畫面 ──────────────────────────────────────────────────────

test('/jump 檔名：跳到改過那個檔的那一輪，並寫出是檔名符合', ZH, async ($, on) => {
  await start($, on)
  const first = (await run($, 'jump', 'tiles.tsx')).text?.split('\n')[0]
  expect(first).toBe('2. 把磚塊排整齊（檔名 tiles.tsx）')
})

test('/jump 回答裡的字：跳到那一輪，並寫出回答的那一段', ZH, async ($, on) => {
  await start($, on)
  const first = (await run($, 'jump', '過期')).text?.split('\n')[0] ?? ''
  expect(first).toMatch(/^3\. 為什麼又登出了（回答：.*過期/)
})

test('/jump 多筆符合：清單和選單每一則都看得出原因', ZH, async ($, on) => {
  const rows = ROWS()
  rows.push(user('u4', 'tiles 再調一次間距'))
  await start($, on, rows)
  const many = await run($, 'jump', 'tiles')
  expect(many.text).toContain('有 2 則符合')
  expect(many.text).toContain('  4. tiles 再調一次間距')
  expect(many.text).toContain('  2. 把磚塊排整齊（檔名 tiles.tsx）')
  const band = await $.ui.mount(BAND())
  const pick = (await band.find({ key: 'jump-pick' })) as Found | undefined
  const labels = (pick?.props.options as { label: string }[]).map(o => o.label)
  expect(labels).toEqual(['4. tiles 再調一次間距', '2. 把磚塊排整齊（檔名 tiles.tsx）'])
  await band.unmount()
})

test('清單篩選框打檔名、回答裡的字也找得到，下面一行寫原因', ZH, async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount(PANE())
  await ui.input({ key: 'q', text: 'tiles', kind: 'change' })
  expect(await ui.find({ key: 'p-u2' })).toBeDefined()
  expect(await ui.find({ key: 'p-u1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^ +檔名 tiles\.tsx$/ })).toBeDefined()
  await ui.input({ key: 'q', text: 'token', kind: 'change' })
  expect(await ui.find({ key: 'p-u3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +回答：.*token/ })).toBeDefined()
  // 提問本身符合、看得到那個詞：不另外寫原因。
  await ui.input({ key: 'q', text: '登入', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /^ +(提問|回答|檔名)/ })).toBeUndefined()
  await ui.unmount()
})

test('清單：一則一列、右邊短標記、目前那一則有色條，預覽卡片有回答開頭', ZH, async ($, on) => {
  const { clock } = await start($, on)
  await standAt($, clock, 'u2')
  const ui = await $.ui.mount(PANE())
  const second = (await ui.find({ key: 'p-u2' }))?.text ?? ''
  expect(second).toMatch(/^▌2  把磚塊排整齊 +±1$/)
  // 右邊留一欄，標記靠右對齊。
  expect(widthOf(second)).toBe(43)
  expect((await ui.find({ key: 'p-u3' }))?.text).toMatch(/^ 3  為什麼又登出了 +\$1 ✗1$/)
  // 卡片平常藏著（hover 才出現），內容是提問、回答開頭、做了什麼。
  expect(await ui.find({ type: 'Text', text: '因為 token 過期，重新整理時沒有換新的 token' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '改 tiles.tsx' })).toBeDefined()
  await ui.unmount()
})

test('刻度列：每則一根，目前那一則青色、有失敗的紅色；預覽列是目前那一則', ZH, async ($, on) => {
  const { clock } = await start($, on)
  await standAt($, clock, 'u2')
  const band = await $.ui.mount(BAND())
  for (const id of ['u1', 'u2', 'u3']) expect(await band.find({ key: `t-${id}` })).toBeDefined()
  expect(colorOf((await band.find({ key: 't-u2' })) as Found)).toBe('cyan')
  expect(colorOf((await band.find({ key: 't-u3' })) as Found)).toBe('red')
  expect(colorOf((await band.find({ key: 't-u1' })) as Found)).toBe('')
  // 第一列左邊是「2/3」。
  expect(await band.find({ type: 'Text', text: '/3' })).toBeDefined()
  // 預覽列：目前那一則的提問和回答開頭；hover 用的預覽每根刻度各一份。
  expect((await band.findAll({ type: 'Text', text: '把磚塊排整齊' })).length).toBe(2)
  expect((await band.findAll({ type: 'Text', text: '排好了' })).length).toBe(2)
  await band.press({ key: 't-u1' })
  await band.unmount()
  // 點了第 1 根：要捲去第 1 則（測試環境捲不動，提示裡照實說）。
  expect(toasts.at(-1)).toContain('捲不回去')
})

test('鍵盤移到某一根刻度：預覽列換成那一則；送出提問後回到目前那一則', ZH, async ($, on) => {
  const { clock } = await start($, on)
  await standAt($, clock, 'u1')
  const band = await $.ui.mount(BAND())
  const ui = $.ui as unknown as { focus: (args: object) => Promise<unknown> }
  await ui.focus({ requestId: 'band', key: 't-u3', plugin: 'prompt-jump' })
  await band.unmount()
  const again = await $.ui.mount(BAND())
  const preview = (await again.find({ key: 'pv' })) as Found | undefined
  expect(JSON.stringify(preview?.children)).toContain('為什麼又登出了')
  await again.unmount()
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' }, wait: false } as never)
  const after = await $.ui.mount(BAND())
  expect(JSON.stringify(((await after.find({ key: 'pv' })) as Found | undefined)?.children)).toContain('登入頁壞了')
  await after.unmount()
})

test('60 則的長對話：寬畫面一列放得下，窄畫面只畫附近一段、拿掉「回答」「清單」', ZH, async ($, on) => {
  const rows: SessionMessage[] = []
  for (let i = 1; i <= 60; i++) rows.push(user(`u${i}`, `第 ${i} 個問題`), said(`a${i}`, `回答 ${i}`))
  const { clock } = await start($, on, rows)
  await standAt($, clock, 'u30')
  const wide = await $.ui.mount(BAND(160))
  let count = 0
  for (let i = 1; i <= 60; i++) if (await wide.find({ key: `t-u${i}` })) count++
  expect(count).toBe(60)
  await wide.unmount()

  const narrow = await $.ui.mount(BAND(40))
  expect(await narrow.find({ key: 't-u30' })).toBeDefined()
  expect(await narrow.find({ key: 't-u1' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /^‹\d+$/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /^\d+›$/ })).toBeDefined()
  expect(await narrow.find({ key: 'band-prev' })).toBeDefined()
  expect(await narrow.find({ key: 'band-ans' })).toBeUndefined()
  await narrow.unmount()
})

test('只剩一列高時不畫預覽列', ZH, async ($, on) => {
  await start($, on)
  const band = await $.ui.mount(BAND(100, 1))
  expect(await band.find({ key: 'pv' })).toBeUndefined()
  expect(await band.find({ key: 't-u1' })).toBeDefined()
  await band.unmount()
})

test('autoOpenPane 預設關：開始時不打開清單；按 l 才打開', ZH, async ($, on) => {
  await start($, on)
  expect(opened).toEqual([])
  const band = await $.ui.mount(BAND())
  await band.press({ key: 'band-open' })
  await band.unmount()
  expect(opened).toEqual(['prompt-jump'])
})

test('autoOpenPane 打開時，開始就打開清單', { options: { language: 'zh-TW', autoOpenPane: true } }, async ($, on) => {
  await start($, on)
  expect(opened).toEqual(['prompt-jump'])
})

test('一般版面第一次捲不動：附上完整說明；之後只說一句，/jump-help 隨時再看', ZH, async ($, on) => {
  await start($, on)
  const firstTry = (await run($, 'jump', '1', false)).text ?? ''
  expect(firstTry).toContain('捲不過去')
  expect(firstTry).toContain('/tui fullscreen')
  expect(firstTry).toContain('"tui": "fullscreen"')
  expect(firstTry).toContain('CLAUDE_CODE_NO_FLICKER=1')
  const second = (await run($, 'jump', '2', false)).text ?? ''
  expect(second).toContain('/jump-help')
  expect(second).not.toContain('/tui fullscreen')
  expect((await run($, 'jump-help')).text).toBe(zh.layoutHelp)
})

test('一般版面按清單的一列：提示帶 /jump-help，不占掉指令那一次完整說明', ZH, async ($, on) => {
  const session = mock.session(on)
  await start($, on)
  const ui = await $.ui.mount(PANE(44, false))
  expect(await ui.find({ type: 'Text', text: /\/jump-help/ })).toBeDefined()
  await ui.press({ key: 'p-u1' })
  await ui.unmount()
  expect(toasts.at(-1)).toContain('/jump-help')
  expect(session.appended()).toEqual([])
  // 之後第一次用指令捲不動，還是會附上完整說明。
  expect((await run($, 'jump', '2', false)).text).toContain('/tui fullscreen')
})
