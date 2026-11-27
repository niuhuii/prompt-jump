import { expect, mock, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { isChinese, resolveLang } from '../hooks/i18n'

test('an explicit setting wins over every hint', () => {
  expect(resolveLang('zh-TW', ['en_US.UTF-8'])).toBe('zh-TW')
  expect(resolveLang('en', ['zh_TW.UTF-8'])).toBe('en')
})

test('auto takes the first hint that says something', () => {
  // Claude Code 的 language 設定排第一。
  expect(resolveLang('auto', ['繁體中文', 'en_US.UTF-8'])).toBe('zh-TW')
  expect(resolveLang('auto', ['japanese', 'zh_TW.UTF-8'])).toBe('en')
  // 沒設定、空白、C／POSIX 都跳過。
  expect(resolveLang('auto', [undefined, '', 'C.UTF-8', 'POSIX', 'zh_TW.UTF-8'])).toBe('zh-TW')
})

test('auto falls back to English when nothing is known', () => {
  expect(resolveLang('auto', [])).toBe('en')
  expect(resolveLang(undefined, [undefined])).toBe('en')
})

test('what counts as Chinese', () => {
  for (const yes of ['zh', 'zh-TW', 'zh_CN.UTF-8', 'zh-Hant', 'Chinese', 'traditional chinese', '中文', '繁體中文', '简体中文']) {
    expect(isChinese(yes)).toBe(true)
  }
  for (const no of ['en_US.UTF-8', 'ja-JP', 'english', 'zhuang-ish']) {
    expect(isChinese(no)).toBe(false)
  }
})

const EN = { options: { language: 'en', tickRowPosition: 'above' } } as const

test('English interface: pane, the row above the prompt and command replies', EN, async ($, on) => {
  const rows = [
    { role: 'user', text: 'fix the login page', toolUses: [], uuid: 'u1' },
    { role: 'assistant', text: 'done', toolUses: [], uuid: 'a1' },
  ] as SessionMessage[]
  const clock = mock.clock(on)
  on('session.messages', () => ({ value: rows }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(600)

  const pane = await $.ui.mount({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-jump',
    props: { title: 'Prompts', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ type: 'Text', text: '1 prompt' })).toBeDefined()
  await pane.unmount()

  const band = await $.ui.mount({
    plugin: 'prompt-jump',
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  })
  expect((await band.find({ key: 'band-ans' }))?.text).toContain('Answer')
  expect((await band.find({ key: 'band-open' }))?.text).toContain('List')
  expect(await band.find({ type: 'Text', text: /^Point at a tick/ })).toBeDefined()
  await band.unmount()

  expect((await $.command.run({ command: 'jump-help', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })).text).toContain(
    '/tui fullscreen',
  )

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })
  expect((await run('jump', '7')).text).toBe('There is no #7 (1 so far).')
  expect((await run('next')).text).toBe('Already at the last prompt.')
})
