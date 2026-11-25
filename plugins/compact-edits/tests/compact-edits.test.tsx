import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// 改檔縮行：裝了就生效，Edit／Write／MultiEdit 的結果縮成一行；
// 展開（Ctrl+O）、出錯、別的工具、看不懂的輸出，都交回引擎原本的畫法。

const SURFACES = ['terminal', 'desktop'] as const
const ON = { options: { language: 'en' } } as const

const patch = {
  filePath: 'C:\\work\\src\\tiles.tsx',
  type: 'update',
  structuredPatch: [
    { lines: [' keep', '-old one', '-old two', '+new one', '+new two', '+new three'] },
    { lines: ['+added', ' keep'] },
  ],
}

const result = (props: object) =>
  ({
    plugin: 'compact-edits',
    component: 'ToolResult',
    requestId: 'toolu_1',
    props: {
      tool_use_id: 'toolu_1',
      tool: 'Edit',
      output: patch,
      isErrored: false,
      isExpanded: false,
      ...props,
    },
  }) as const

/** 代替引擎畫原本的結果，讓測試分得出「交回去了」。 */
const engineDraws = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine diff</Text>
  })

test('an edit shows as one line with added and removed counts', ON, async ($, on) => {
  engineDraws(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...result({}), surface })
    const line = await ui.find({ type: 'Text', text: /Edited/ })
    expect(line?.text).toBe('Edited tiles.tsx +4 −2')
    await ui.unmount()
  }
})

test('MultiEdit and a path with forward slashes', ON, async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({
    ...result({ tool: 'MultiEdit', output: { ...patch, filePath: '/repo/a/b.ts' } }),
    surface: 'terminal',
  })
  expect((await ui.find({ type: 'Text', text: /Edited/ }))?.text).toBe('Edited b.ts +4 −2')
  await ui.unmount()
})

test('a new file shows as Created', ON, async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({
    ...result({ tool: 'Write', output: { filePath: '/repo/new.md', type: 'create' } }),
    surface: 'terminal',
  })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Created new.md')
  await ui.unmount()
})

test('Chinese summary when the language is zh-TW', { options: { language: 'zh-TW' } }, async ($, on) => {
  engineDraws(on)
  const ui = await $.ui.mount({ ...result({}), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /改了/ }))?.text).toBe('改了 tiles.tsx +4 −2')
  await ui.unmount()
})

const handedBack: [string, object, object][] = [
  ['expanded (Ctrl+O)', ON, { isExpanded: true }],
  ['errored', ON, { isErrored: true }],
  ['another tool', ON, { tool: 'Bash', output: { stdout: 'x' } }],
  ['an output without filePath', ON, { output: { message: 'odd' } }],
]

for (const [why, options, props] of handedBack) {
  test(`hands back to the engine when ${why}`, options, async ($, on) => {
    engineDraws(on)
    const ui = await $.ui.mount({ ...result(props), surface: 'terminal' })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine diff')
    await ui.unmount()
  })
}
