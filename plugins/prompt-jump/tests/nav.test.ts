import { expect, test } from 'claude-code/testing'

import { markName, parseJump, positionOf, resolveIndex, stepTarget, topRow } from '../hooks/nav'

const P = [
  { id: 'u1', text: '登入頁壞了' },
  { id: 'u2', text: '幫我改 tiles.tsx' },
  { id: 'u3', text: '登入 API 要加 token' },
]
const seen = (first: number) => ({ first, last: first + 10, of: 40 })
const owners = (m: Record<string, string>) => (id: string) => m[id]

test('parseJump 認得編號、倒數、方向、書籤、關鍵字；不帶參數是開窗格', () => {
  expect(parseJump('')).toEqual({ kind: 'pane' })
  expect(parseJump(' 3 ')).toEqual({ kind: 'index', index: 2 })
  expect(parseJump('#3')).toEqual({ kind: 'index', index: 2 })
  expect(parseJump('-1')).toEqual({ kind: 'index', index: -1 })
  expect(parseJump('prev')).toEqual({ kind: 'step', direction: 'prev' })
  expect(parseJump('下一則')).toEqual({ kind: 'step', direction: 'next' })
  expect(parseJump('ans')).toEqual({ kind: 'answer' })
  expect(parseJump('@重點')).toEqual({ kind: 'mark', name: '重點' })
  expect(parseJump('登入 token')).toEqual({ kind: 'search', words: '登入 token' })
})

test('resolveIndex 處理倒數與超出範圍', () => {
  expect(resolveIndex(0, 3)).toBe(0)
  expect(resolveIndex(-1, 3)).toBe(2)
  expect(resolveIndex(3, 3)).toBeUndefined()
  expect(resolveIndex(-4, 3)).toBeUndefined()
})

test('沒有畫面位置時，上一則從最底下往回走', () => {
  expect(stepTarget('prev', 3, undefined, null)).toBe(2)
  expect(stepTarget('prev', 3, undefined, 2)).toBe(1)
  expect(stepTarget('prev', 3, undefined, 0)).toBeUndefined()
  expect(stepTarget('next', 3, undefined, 1)).toBe(2)
  expect(stepTarget('next', 3, undefined, null)).toBeUndefined()
  expect(stepTarget('prev', 0, undefined, null)).toBeUndefined()
})

test('有畫面位置時：上一則先回到這一則的開頭', () => {
  expect(stepTarget('prev', 3, { index: 1, isAtStart: false }, null)).toBe(1)
  expect(stepTarget('prev', 3, { index: 1, isAtStart: true }, null)).toBe(0)
  expect(stepTarget('next', 3, { index: 1, isAtStart: false }, null)).toBe(2)
})

test('目前位置：畫面最上方那一列屬於哪一則', () => {
  const own = owners({ a1: 'u1', a2: 'u2', t2: 'u2' })
  // 第 1 則的回答捲到一半在最上面，第 2 則也露出來。
  const v1 = new Map([['a1', seen(5)], ['u2', seen(0)]])
  expect(positionOf(P, v1, own)).toEqual({ index: 0, isAtStart: false })
  // 第 2 則的提問就在最上面。
  const v2 = new Map([['u2', seen(0)], ['a2', seen(0)]])
  expect(positionOf(P, v2, own)).toEqual({ index: 1, isAtStart: true })
  // 只看得到第 2 則的工具列。
  expect(positionOf(P, new Map([['t2', seen(0)]]), own)).toEqual({ index: 1, isAtStart: false })
  // 一則都看不到。
  expect(positionOf(P, new Map(), own)).toBeUndefined()
  // 剛跳到第 3 則（在畫面下半）而且還看得到：以它為準。
  const v3 = new Map([['a2', seen(3)], ['u3', seen(0)]])
  expect(positionOf(P, v3, own, 'u3')).toEqual({ index: 2, isAtStart: true })
})

test('書籤名稱沒給就編號，不撞已有的', () => {
  expect(markName(' 重點 ', [], '書籤')).toBe('重點')
  expect(markName('', ['書籤 1'], '書籤')).toBe('書籤 2')
  expect(markName('', [], 'mark')).toBe('mark 1')
})

test('topRow 取露出的列裡最前面的', () => {
  const order = new Map([['u1', 0], ['a1', 1], ['u2', 2]])
  expect(topRow(new Map([['u2', seen(0)], ['a1', seen(4)]]), order)).toBe('a1')
  expect(topRow(new Map([['zz', seen(0)]]), order)).toBeUndefined()
})
