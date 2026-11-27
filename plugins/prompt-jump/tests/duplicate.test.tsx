import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

/** 介面語言固定中文，不看這台機器的地區設定。 */
const ZH = { options: { language: 'zh-TW', tickRowPosition: 'above' } } as const

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]

// 一則訊息送出當下先以暫時 id "placeholder" 畫一次，寫進紀錄後再以紀錄列的
// uuid 畫一次。目錄只能收後者，而且不能靠文字去重。

const PANE = {
  plugin: 'prompt-jump',
  component: 'Pane',
  requestId: 'prompt-jump',
  props: {
    title: '對話目錄',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const userMessage = (requestId: string, text: string) =>
  ({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'UserMessage',
    requestId,
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
  }) as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`暫時 id 不進目錄、相同文字送兩次顯示兩筆（${surface}）`, ZH, async ($, on) => {
    const clock = mock.clock(on)
    // 對話紀錄裡真的有的列：placeholder 永遠不在裡面。
    const rows: SessionMessage[] = [
      { role: 'user', text: 'alpha', toolUses: [], uuid: 'u-1' },
      { role: 'assistant', text: 'ok', toolUses: [], uuid: 'a-1' },
      { role: 'user', text: 'same', toolUses: [], uuid: 'u-2' },
      { role: 'assistant', text: 'ok', toolUses: [], uuid: 'a-2' },
      { role: 'user', text: 'same', toolUses: [], uuid: 'u-3' },
    ]
    on('session.messages', () => ({ value: rows }))
    on('command.register', () => ({ value: { command: 'jump' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({ value: [] }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/', surface, isInteractive: true })

    // 每一則都是先畫暫時 id、再畫真的 uuid。
    for (const [id, text] of [
      ['placeholder', 'alpha'],
      ['u-1', 'alpha'],
      ['placeholder', 'same'],
      ['u-2', 'same'],
      ['placeholder', 'same'],
      ['u-3', 'same'],
    ] as const) {
      const ui = await $.ui.mount(userMessage(id, text))
      await ui.unmount()
    }
    // 讓計時器跑過，也超過暫存的等待上限。
    await clock.advance(20_000)

    const pane = await $.ui.mount({ ...PANE, surface })
    // 每一則一顆按鈕，按鈕的 key 帶著捲得回去的紀錄列 uuid。
    for (const id of ['u-1', 'u-2', 'u-3'])
      expect(await pane.find({ key: `p-${id}` })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^4\./ })).toBeUndefined()
    expect(await pane.find({ key: 'p-placeholder' })).toBeUndefined()
    await pane.unmount()
  })
}

// state 的 key 與舊版存下的值（shape 標籤要跟 atom 的一樣才讀得到）。
const seedState = (on: TOn, value: unknown) => {
  let cell = { value: { shape: 'prompts-1', value } as unknown, version: 1 }
  const ref = { plugin: 'prompt-jump', key: 'prompts' } as const
  on('state.get', ref, () => ({ value: cell }))
  on('state.set', ref, (_, e) => {
    cell = { value: e.value, version: cell.version + 1 }
    return { value: { isSet: true, version: cell.version } }
  })
}

const startSession = async (
  $: T$,
  on: TOn,
) => {
  on('command.register', () => ({ value: { command: 'jump' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const row = (uuid: string, text: string): SessionMessage => ({
  role: 'user',
  text,
  toolUses: [],
  uuid,
})

test('已開著的 session：舊版存下的 placeholder 那筆會被清掉', ZH, async ($, on) => {
  const clock = mock.clock(on)
  seedState(on, [
    { id: 'placeholder', text: 'alpha' },
    { id: 'u-1', text: 'alpha' },
  ])
  on('session.messages', () => ({ value: [row('u-1', 'alpha')] }))
  await startSession($, on)
  await clock.advance(1_000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'p-placeholder' })).toBeUndefined()
  expect(await pane.find({ key: 'p-u-1' })).toBeDefined()
  await pane.unmount()
})

test('讀對話紀錄被拒很久，恢復後還是會收進來', ZH, async ($, on) => {
  const clock = mock.clock(on)
  let rows: SessionMessage[] | undefined
  on('session.messages', () =>
    rows === undefined ? { value: { deny: 'not now' } } : { value: rows },
  )
  await startSession($, on)
  const ui = await $.ui.mount(userMessage('u-9', 'late'))
  await ui.unmount()
  // 被拒 30 秒，接著讀得到但這一列還沒寫進去，再過一下才出現。
  await clock.advance(30_000)
  rows = []
  await clock.advance(500)
  rows = [row('u-9', 'late')]
  await clock.advance(1_000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'p-u-9' })).toBeDefined()
  await pane.unmount()
})

test('對話紀錄晚很久才出現的一則，出現後還是會收進來', ZH, async ($, on) => {
  const clock = mock.clock(on)
  let rows: SessionMessage[] = []
  on('session.messages', () => ({ value: rows }))
  await startSession($, on)
  const first = await $.ui.mount(userMessage('u-7', 'slow'))
  await first.unmount()
  await clock.advance(30_000)
  rows = [row('u-7', 'slow')]
  const again = await $.ui.mount(userMessage('u-7', 'slow'))
  await again.unmount()
  await clock.advance(1_000)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'p-u-7' })).toBeDefined()
  await pane.unmount()
})
