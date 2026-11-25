import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

type Engine = EngineInterface

import type { Facts, Mark, PromptEntry } from '../types'
import { factsLine, groupChapters } from './facts'
import { STRINGS, resolveLang, runtimeLocale } from './i18n'
import type { Strings } from './i18n'
import { markName, parseJump, positionOf, resolveIndex, stepTarget, topRow } from './nav'
import type { Seen } from './nav'
import { cleanPrompt, clip, filterIndexes, hhmm, widthOf } from './toc'
import { cleanTitle, titleRequest } from './titles'
import { TranscriptIndex } from './transcript'

const PANE = 'prompt-jump'
const prompts = atom({ plugin: 'prompt-jump', key: 'prompts' } as const, [], {
  shape: 'prompts-1',
})
const times = atom({ plugin: 'prompt-jump', key: 'times' } as const, {})
const query = atom({ plugin: 'prompt-jump', key: 'query' } as const, '')
const current = atom({ plugin: 'prompt-jump', key: 'current' } as const, '')
const isPaneWaiting = atom({ plugin: 'prompt-jump', key: 'isPaneWaiting' } as const, false)
const marks = atom({ plugin: 'prompt-jump', key: 'marks' } as const, [], { shape: 'marks-1' })
const picker = atom({ plugin: 'prompt-jump', key: 'picker' } as const, null)
const facts = atom({ plugin: 'prompt-jump', key: 'facts' } as const, {}, { shape: 'facts-1' })
const activity = atom({ plugin: 'prompt-jump', key: 'activity' } as const, {})
const isBusy = atom({ plugin: 'prompt-jump', key: 'isBusy' } as const, false)
const titles = atom({ plugin: 'prompt-jump', key: 'titles' } as const, {})
const titleTokens = atom({ plugin: 'prompt-jump', key: 'titleTokens' } as const, 0)

/** 設定選項（plugin.json 的 userConfig）。 */
type Config = {
  autoOpenPane: boolean
  language: unknown
  titles: boolean
  titleModel: string
}
let cfg: Config = { autoOpenPane: true, language: 'auto', titles: false, titleModel: 'haiku' }

const MAX_ENTRIES = 500
/** 選單最多列幾則。 */
const LIST_MAX = 30

// 語言設成 auto 時要等 session.start 讀過設定與環境才知道；先用英文。
let s: Strings = STRINGS.en

/** 語言 auto：依序看 Claude Code 的 language 設定、LC_ALL、LC_MESSAGES、執行環境地區、LANG。 */
const pickLanguage = async ($: Engine) => {
  if (cfg.language === 'zh-TW' || cfg.language === 'en') {
    s = STRINGS[cfg.language]
    return
  }
  // 讀不到（沒權限、環境不提供）就當沒設定，不讓語言判斷擋住啟動。
  const quiet = <T,>(p: Promise<T>) => p.catch(() => undefined)
  const fromSettings = await quiet($.settings.read({ key: 'language' }))
  s =
    STRINGS[
      resolveLang(cfg.language, [
        typeof fromSettings === 'string' ? fromSettings : undefined,
        await quiet($.env.get('LC_ALL')),
        await quiet($.env.get('LC_MESSAGES')),
        runtimeLocale(),
        await quiet($.env.get('LANG')),
      ])
    ]
}

// 目錄直接從對話紀錄建：$.session.messages 帶 uuid 的讀法（last／after）給的
// 每一列 id，就是畫面上那則訊息的 requestId，$.ui.scroll 拿它捲得回去。
// mod 載入前就在對話裡的訊息也在紀錄裡，順序就是紀錄的順序，不必等畫面重畫。
//
// 畫面上一則訊息送出當下會先以暫時的 requestId "placeholder" 畫一次，
// 那個 id 不在紀錄裡、也捲不回去；舊版曾把它存進目錄，載入時清掉。
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 增量讀取的起點：最後讀到那一列的 uuid。
let cursor: string | undefined
// 紀錄裡看過的列（判斷舊項目還在不在）。
const stored = new Set<string>()
// 畫面說不是使用者自己送的（背景通知、別的 agent 傳來的）列。
const foreign = new Set<string>()
let isForeignDirty = false
// 畫面上露出的列（全螢幕版面才回報）：提問、回答區塊、工具列。
const visible = new Map<string, Seen>()
// 目錄與書籤的最新內容（state 為準，這裡是同一份的副本）：按鈕、選單、指令
// 要能不等 state 就算出目標，因為捲動必須是處理函式裡第一個 await。
let entries: PromptEntry[] = []
let markList: Mark[] = []
// 剛跳過去的那一則：還在畫面裡就算目前那一則（捲到底時它不一定在最上面）。
let pinned: string | undefined
// 上次跳到的那一則：一般版面沒有畫面位置時，上一則／下一則從這裡算。
let lastJumped: string | undefined

const isPrompt = (row: SessionMessage) =>
  row.role === 'user' &&
  row.uuid !== undefined &&
  !(row.toolResults?.length) &&
  cleanPrompt(row.text) !== ''

const transcript = new TranscriptIndex(isPrompt)

// 紀錄對不上畫面時的退路：畫出來的回答區塊與工具列算最近畫到的那一則提問的。
const drawn = new Set<string>()
const drawnOwner = new Map<string, string>()
const drawnAnswer = new Map<string, string>()
const drawnOrder = new Map<string, number>()
let lastDrawnPrompt: string | undefined

const ownerOf = (id: string) => transcript.ownerOf.get(id) ?? drawnOwner.get(id)

const readRows = async ($: Engine) => {
  if (cursor !== undefined) {
    const rows = await $.session.messages({ after: cursor })
    if (!('deny' in rows)) return { rows, isFull: false }
    cursor = undefined
  }
  const rows = await $.session.messages({ last: 4096 })
  return 'deny' in rows ? undefined : { rows, isFull: true }
}

/** 有新列的那幾則：事實換成最新的，並記下最後有動靜的時間（分段用）。 */
const syncFacts = async ($: Engine, touched: ReadonlySet<string>, isFull: boolean, isOld: boolean) => {
  if (touched.size === 0 && !isFull) return
  const book = transcript.facts.byPrompt
  const copy = (f: Facts): Facts => ({ ...f, files: [...f.files] })
  await update($, facts, all => {
    const next: Record<string, Facts> = isFull ? {} : { ...all }
    for (const id of isFull ? book.keys() : touched) {
      const f = book.get(id)
      if (f !== undefined) next[id] = copy(f)
    }
    return next
  })
  // 載入前的舊訊息，不知道是幾點的事。
  if (isOld || touched.size === 0) return
  const now = await $.clock.now()
  await update($, activity, all => {
    const next = { ...all }
    for (const id of touched) next[id] = now
    return next
  })
}

// 第一次成功讀過紀錄了沒有。
let isLoaded = false

/** 讀新的對話紀錄併進目錄。 */
const sync = async ($: Engine) => {
  const got = await readRows($)
  if (got === undefined) return
  const { rows, isFull } = got
  // 整段讀到的是舊訊息（不知道幾點送的）：載入時的第一次，或讀過東西之後被拒、重讀。
  // 紀錄原本是空的（還沒有 uuid 可以接著讀）時整段讀到的，是剛送出的。
  const isOld = isFull && (!isLoaded || stored.size > 0)
  isLoaded = true
  for (const row of rows) if (row.uuid !== undefined) stored.add(row.uuid)
  cursor = rows.at(-1)?.uuid ?? cursor
  if (isFull) transcript.reset()
  const touched = transcript.ingest(rows)
  await syncFacts($, touched, isFull, isOld)

  const fresh = rows
    .filter(isPrompt)
    .map(row => ({ id: row.uuid!, text: cleanPrompt(row.text) }))
  if (fresh.length === 0 && !isFull && !isForeignDirty) return
  isForeignDirty = false

  let added: string[] = []
  await update($, prompts, all => {
    const kept = all.filter(
      one => (stored.has(one.id) || UUID.test(one.id)) && !foreign.has(one.id),
    )
    const have = new Set(kept.map(one => one.id))
    const more = fresh.filter(one => !have.has(one.id) && !foreign.has(one.id))
    added = more.map(one => one.id)
    entries = [...kept, ...more].slice(-MAX_ENTRIES)
    return entries
  })
  if (!isOld && added.length > 0) {
    const now = await $.clock.now()
    await update($, times, all => {
      const next = { ...all }
      for (const id of added) next[id] ??= now
      return next
    })
  }
}

const position = () => positionOf(entries, visible, ownerOf, pinned)

const followScreen = async ($: Engine) => {
  const at = position()
  if (at === undefined) return
  const top = entries[at.index]!.id
  await update($, current, was => (was === top ? was : top))
}

// ── 跳轉 ──────────────────────────────────────────────────────────────

const label = (i: number, width = 60) => `${i + 1}. ${clip(entries[i]!.text, width)}`

/** 要捲到哪一列、跳完算停在哪一則，或為什麼不能跳。 */
type Plan =
  | { id: string; promptId: string | undefined; label: string; full?: string }
  | { error: string }

const planIndex = (i: number): Plan => ({
  id: entries[i]!.id,
  promptId: entries[i]!.id,
  label: label(i),
  full: entries[i]!.text,
})

const jumpedIndex = () => {
  const at = entries.findIndex(one => one.id === lastJumped)
  return at < 0 ? null : at
}

const planStep = (direction: 'prev' | 'next'): Plan => {
  const target = stepTarget(direction, entries.length, position(), jumpedIndex())
  if (target === undefined) {
    return {
      error: entries.length === 0 ? s.noPrompts : direction === 'prev' ? s.atFirst : s.atLast,
    }
  }
  return planIndex(target)
}

/** 最後一個回答的開頭：紀錄裡的那一列畫過就用它，否則用畫面記到的。 */
const planAnswer = (): Plan => {
  const last = entries.at(-1)
  if (last === undefined) return { error: s.noPrompts }
  const fromLog = transcript.answerOf.get(last.id)
  const fromDraw = drawnAnswer.get(last.id)
  const id = fromLog !== undefined && drawn.has(fromLog) ? fromLog : (fromDraw ?? fromLog)
  if (id === undefined) return { error: s.noAnswer }
  return { id, promptId: last.id, label: s.answerLabel(entries.length) }
}

const planMark = (name: string): Plan => {
  const hit =
    markList.find(one => one.name === name) ??
    markList.find(one => one.name.toLowerCase().includes(name.toLowerCase()))
  if (!hit) return { error: s.noMark(name) }
  return { id: hit.id, promptId: ownerOf(hit.id) ?? hit.id, label: s.markLabel(hit.name) }
}

/** 選單的值：`@名稱` 是書籤，其他是提問的列 id。 */
const planValue = (value: string): Plan => {
  if (value.startsWith('@')) return planMark(value.slice(1))
  const at = entries.findIndex(one => one.id === value)
  return at < 0 ? { error: s.gone } : planIndex(at)
}

type Outcome = { isMoved: boolean; text: string; reason?: string }

const explain = (deny: string) =>
  /not scrollable|none scrolls|no-surface/.test(deny) ? s.withWhy(deny, s.mainScreenReason) : deny

/**
 * 照計畫捲過去。捲動一定是第一個 await：按鈕、選單只有在「回應使用者動作」
 * 的當下才准捲對話，先等別的 state 讀寫再捲，引擎會回 not person-initiated。
 * 一般版面（CLAUDE_CODE_NO_FLICKER 沒開、tmux 預設）的對話在終端機自己的
 * 捲動區，引擎捲不動，這時一定會被拒：照實說，並印出那一則的全文。
 */
const go = async ($: Engine, plan: Plan): Promise<Outcome> => {
  if ('error' in plan) return { isMoved: false, text: plan.error }
  let deny: string | undefined
  try {
    deny = (await $.ui.scroll({ to: { requestId: plan.id }, block: 'start' })).deny
  } catch (error) {
    deny = error instanceof Error ? error.message : String(error)
  }
  if (plan.promptId !== undefined) lastJumped = plan.promptId
  if (deny !== undefined) {
    const full = plan.full !== undefined && !plan.label.endsWith(plan.full) ? clip(plan.full, 600) : undefined
    return { isMoved: false, text: s.cantScroll(plan.label, explain(deny), full), reason: deny }
  }
  // 跳到回答或書籤時記它所屬的那一則：還看得到那一則就以它為目前位置。
  pinned = plan.promptId ?? plan.id
  const promptId = plan.promptId
  if (promptId !== undefined) await update($, current, () => promptId)
  return { isMoved: true, text: s.jumped(plan.label) }
}

/** 按鈕、選單：跳不過去時用提示說原因。 */
const press = ($: Engine, plan: Plan) =>
  void go($, plan).then(r => {
    if (!r.isMoved) $.ui.toast(r.reason === undefined ? r.text : s.scrollToast(explain(r.reason)))
  })

/** 指令：跳過去時只跳提示，不在對話底部多加一列（那會把畫面拉回最底下）。 */
const reply = ($: Engine, outcome: Outcome) => {
  if (outcome.isMoved) {
    $.ui.toast(outcome.text)
    return {}
  }
  return { text: outcome.text }
}

const openPane = async ($: Engine) => {
  const opened = await $.ui.open({ id: PANE, title: s.paneTitle })
  if (opened.isPlaced) {
    await update($, isPaneWaiting, () => false)
    // 清單長的時候先讓窗格捲到目前那一則（或最後一則）。
    const id = (await read($, current)) || entries.at(-1)?.id
    if (id !== undefined) void $.ui.scroll({ to: { key: `p-${id}` }, in: PANE }).catch(() => undefined)
  }
  return opened
}

/** 提示框上方的選單：最近幾則，新的在上。 */
const recentPicker = () => {
  const from = Math.max(0, entries.length - LIST_MAX)
  const indexes = entries.map((_, i) => i).slice(from).reverse()
  return {
    title: s.pickerJump,
    options: indexes.map(i => ({ value: entries[i]!.id, label: label(i) })),
  }
}

/** 窗格沒放上去時，改給選單（全螢幕）或一段文字清單（一般版面）。 */
const listFallback = async ($: Engine, isFullscreen: boolean, reason: string) => {
  if (isFullscreen) {
    await update($, picker, () => recentPicker())
    return s.paneWaiting(reason)
  }
  const from = Math.max(0, entries.length - 10)
  const lines = entries.slice(from).map((_, k) => `  ${label(from + k, 70)}`)
  return [s.paneUnavailable(reason), ...lines].join('\n')
}

const COMMANDS = () =>
  [
    { name: 'jump', description: s.cmdJump, argumentHint: s.cmdJumpHint },
    { name: 'prev', description: s.cmdPrev },
    { name: 'next', description: s.cmdNext },
    { name: 'ans', description: s.cmdAns },
    { name: 'mark', description: s.cmdMark, argumentHint: s.cmdMarkHint },
    { name: 'marks', description: s.cmdMarks, argumentHint: s.cmdMarkHint },
    { name: 'unmark', description: s.cmdUnmark, argumentHint: s.cmdUnmarkHint },
  ] as const

/** 記下一列在畫面上露出的範圍；undefined 代表這個畫面不回報。 */
const track = (id: string, onScreen: Seen | null | undefined) => {
  if (onScreen) visible.set(id, onScreen)
  else if (onScreen === null) {
    visible.delete(id)
    if (id === pinned) pinned = undefined
  }
}

const remember = (id: string) => {
  if (!drawnOrder.has(id)) drawnOrder.set(id, drawnOrder.size)
}

// ── 自動標題（設定 titles 開啟時才做）──────────────────────────────────
// 每輪結束後，把提問、改過的檔名、指令數、回答開頭各截短，送給小模型寫一行標題。
// 標題存在 $.store（每個 session 一份，留最近 20 個），resume 後還在。

const STORE_SESSIONS = 'title-sessions'
const STORE_KEEP = 20
const storeKey = (id: string) => `titles:${id}`

type TitleJob = { promptId: string; answer: string }
const titleJobs: TitleJob[] = []
let isTitling = false
let sessionId = ''
/** session.start 時記下有沒有人在畫面前（-p／SDK 沒有窗格，不花 token）。 */
let isInteractive = true

const saveTitles = async ($: Engine) => {
  if (sessionId === '') return
  await $.store.set(storeKey(sessionId), { titles: await read($, titles), tokens: await read($, titleTokens) })
  const was = await $.store.get(STORE_SESSIONS)
  const ids = (Array.isArray(was) ? (was as string[]) : []).filter(one => one !== sessionId)
  ids.push(sessionId)
  for (const old of ids.splice(0, Math.max(0, ids.length - STORE_KEEP))) await $.store.delete(storeKey(old))
  await $.store.set(STORE_SESSIONS, ids)
}

const loadTitles = async ($: Engine) => {
  sessionId = await $.session.id()
  const kept = (await $.store.get(storeKey(sessionId))) as { titles?: Record<string, string>; tokens?: number } | undefined
  await update($, titles, () => ({ ...(kept?.titles ?? {}) }))
  await update($, titleTokens, () => kept?.tokens ?? 0)
}

/** 幫一則產生標題；任何失敗都只是沒標題，目錄照常顯示原本的提問。 */
const makeTitle = async ($: Engine, job: TitleJob) => {
  const entry = entries.find(one => one.id === job.promptId)
  if (entry === undefined) return
  // 有資料規則（HIPAA、ZDR 或不認得的）就不外送；沒說也當有。
  const { dataRules } = await $.session.info()
  if (dataRules?.length !== 0) return
  try {
    const prompt = await $.session.redact(
      titleRequest(s.title, entry.text, transcript.facts.byPrompt.get(entry.id), job.answer),
    )
    const r = await $.model.complete({
      model: cfg.titleModel,
      system: s.title.system,
      prompt,
      maxTokens: 60,
      effort: 'low',
      timeoutMs: 20000,
    })
    const u = r.usage
    const spent = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
    await update($, titleTokens, n => n + spent)
    const title = r.isAnswered ? cleanTitle(r.text) : undefined
    if (title !== undefined) await update($, titles, all => ({ ...all, [entry.id]: title }))
  } catch {
    // 模型被擋（例如不在允許清單）會丟例外；目錄照常，只是沒標題。
    return
  }
  await saveTitles($)
}

export const register: Register = (on, options) => {
  cfg = {
    autoOpenPane: options.autoOpenPane !== false,
    language: options.language,
    titles: options.titles === true,
    titleModel:
      typeof options.titleModel === 'string' && options.titleModel.trim() !== '' ? options.titleModel : 'haiku',
  }
  // 指定了語言就馬上用（熱重載後畫面不必等 session.start）；auto 等 session.start 判斷。
  if (cfg.language === 'zh-TW' || cfg.language === 'en') s = STRINGS[cfg.language]

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await pickLanguage($)
    if (cfg.titles) await loadTitles($).catch(() => undefined)
    $.clock.every(500, async () => {
      // 標題一次做一個，不擋住對話。
      if (!isTitling && titleJobs.length > 0) {
        isTitling = true
        void makeTitle($, titleJobs.shift()!).finally(() => {
          isTitling = false
        })
      }
      await sync($)
      await followScreen($)
      const pane = (await $.ui.panes()).find(one => one.id === PANE)
      const isWaiting = pane !== undefined && !pane.isPlaced
      await update($, isPaneWaiting, was => (was === isWaiting ? was : isWaiting))
    })
    markList = await read($, marks)
    for (const command of COMMANDS()) {
      // 名稱被內建指令或別的外掛占用時會被拒，不影響其他指令。
      await $.command.register(command).catch(() => undefined)
    }
    if (cfg.autoOpenPane) void $.ui.open({ id: PANE, title: s.paneTitle })

    return next(e)
  })

  // /clear 之後是新的對話，目錄從頭來。
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      cursor = undefined
      stored.clear()
      visible.clear()
      transcript.reset()
      drawn.clear()
      drawnOwner.clear()
      drawnAnswer.clear()
      drawnOrder.clear()
      pinned = undefined
      lastJumped = undefined
      entries = []
      markList = []
      await update($, prompts, () => [])
      await update($, times, () => ({}))
      await update($, current, () => '')
      await update($, marks, () => [])
      await update($, picker, () => null)
      await update($, facts, () => ({}))
      await update($, activity, () => ({}))
      await update($, titles, () => ({}))
      await update($, titleTokens, () => 0)
      titleJobs.length = 0
      sessionId = ''
    }
    return next(e)
  })

  // 主對話一輪開始／結束：目錄最後一則顯示「進行中…」；結束後（設定開啟時）排一個標題。
  on('turn.start', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId === undefined) await update($, isBusy, () => true)
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId !== undefined) return res
    await update($, isBusy, () => false)
    if (!cfg.titles || !isInteractive || e.reason !== 'answer') return res
    await sync($)
    if (sessionId === '') await loadTitles($).catch(() => undefined)
    const last = entries.at(-1)
    const named = await read($, titles)
    if (last !== undefined && named[last.id] === undefined && !titleJobs.some(j => j.promptId === last.id)) {
      titleJobs.push({ promptId: last.id, answer: e.answer })
    }
    return res
  })

  on('command.run', { command: 'jump' }, async ($, e) => {
    const q = parseJump(e.args)
    await sync($)
    const isFullscreen = e.presentation.isFullscreen !== false

    if (q.kind === 'pane') {
      const opened = await openPane($)
      if (opened.isPlaced) return { text: s.paneOpened }
      if (entries.length === 0) return { text: s.noPrompts }
      return { text: await listFallback($, isFullscreen, opened.reason) }
    }
    if (q.kind === 'step') return reply($, await go($, planStep(q.direction)))
    if (q.kind === 'answer') return reply($, await go($, planAnswer()))
    if (q.kind === 'mark') return reply($, await go($, planMark(q.name)))
    if (entries.length === 0) return { text: s.noPrompts }
    if (q.kind === 'index') {
      const at = resolveIndex(q.index, entries.length)
      if (at === undefined) {
        return { text: s.noSuchIndex(q.index < 0 ? q.index : q.index + 1, entries.length) }
      }
      return reply($, await go($, planIndex(at)))
    }

    const hits = filterIndexes(entries, q.words)
    if (hits.length === 0) return { text: s.notFound(q.words) }
    if (hits.length === 1) return reply($, await go($, planIndex(hits[0]!)))
    const shown = hits.slice(-LIST_MAX).reverse()
    if (isFullscreen) {
      await update($, picker, () => ({
        title: s.searchTitle(q.words),
        options: shown.map(i => ({ value: entries[i]!.id, label: label(i) })),
      }))
    }
    return {
      text: [
        s.hits(q.words, hits.length),
        ...shown.slice(0, 10).map(i => `  ${label(i, 70)}`),
        shown.length > 10 ? `  ${s.hitsMore}` : '',
        isFullscreen ? s.pickerHint : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  })

  on('command.run', { command: 'prev' }, async $ => (await sync($), reply($, await go($, planStep('prev')))))
  on('command.run', { command: 'next' }, async $ => (await sync($), reply($, await go($, planStep('next')))))
  on('command.run', { command: 'ans' }, async $ => (await sync($), reply($, await go($, planAnswer()))))

  on('command.run', { command: 'mark' }, async ($, e) => {
    await sync($)
    if (entries.length === 0) return { text: s.noPrompts }
    const at = position()
    const index = at?.index ?? jumpedIndex()
    if (index === null) return { text: s.unknownPosition }
    const target = entries[index]!
    // 全螢幕時記下畫面最上方那一列本身（可能是回答的中段），跳回來更準；否則記那一則提問。
    const row =
      (at && (topRow(visible, transcript.order) ?? topRow(visible, drawnOrder))) || target.id
    const name = markName(e.args, markList.map(one => one.name), s.defaultMarkBase)
    const mark: Mark = { name, id: row, text: target.text }
    markList = [...markList.filter(one => one.name !== name), mark]
    await update($, marks, () => markList)

    // 送出斜線指令時引擎會先把畫面拉到最底下，記完把畫面捲回原處。
    // 只跳提示、不印文字：印出來會在底部多一列。
    if (at) await $.ui.scroll({ to: { requestId: row }, block: 'start' }).catch(() => undefined)
    $.ui.toast(s.markSaved(name, label(index, 40), at !== undefined))
    return {}
  })

  on('command.run', { command: 'marks' }, async ($, e) => {
    const wanted = e.args.trim()
    if (wanted !== '') return reply($, await go($, planMark(wanted)))
    if (markList.length === 0) return { text: s.noMarks }
    if (e.presentation.isFullscreen !== false) {
      await update($, picker, () => ({
        title: s.pickerMarks,
        options: markList.map(one => ({ value: `@${one.name}`, label: `${one.name}: ${clip(one.text, 50)}` })),
      }))
    }
    return {
      text: [
        s.marksHeader(markList.length),
        ...markList.map(one => `  @${one.name}: ${clip(one.text, 60)}`),
        e.presentation.isFullscreen !== false ? s.pickerHint : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  })

  on('command.run', { command: 'unmark' }, async ($, e) => {
    const name = e.args.trim()
    if (name === '') return { text: s.unmarkWhich }
    if (!markList.some(one => one.name === name)) return { text: s.noMark(name) }
    markList = markList.filter(one => one.name !== name)
    await update($, marks, () => markList)
    // 開著的選單裡也拿掉它；拿完是空的就收起來。
    await update($, picker, menu => {
      if (!menu) return menu
      const options = menu.options.filter(one => one.value !== `@${name}`)
      return options.length === 0 ? null : options.length === menu.options.length ? menu : { ...menu, options }
    })
    return { text: s.unmarked(name) }
  })

  // 打 `/jump 關鍵字` 時，提示框下方的自動完成列出符合的訊息，↑↓ 選、Tab 帶入編號。
  on('prompt.autocomplete', async ($, e, next) => {
    const base = await next(e)
    const match = /^\/jump\s+(.*)$/.exec(e.text.slice(0, e.cursor))
    if (!match || match[1]!.startsWith('@')) return base
    const words = match[1]!.trim()
    if (words === '' || /^#?\d+$/.test(words) || /^-\d+$/.test(words)) return base
    // 帶入後整個參數換成編號：token 前面不能還有別的字。
    const typedBefore = e.text.slice(e.text.indexOf(match[1]!), e.start)
    if (typedBefore.trim() !== '') return base
    const hits = filterIndexes(entries, words).slice(-8).reverse()
    if (hits.length === 0) return base
    return {
      suggestions: [
        ...base.suggestions,
        ...hits.map(i => ({ text: String(i + 1), label: label(i, 60) })),
      ],
    }
  })

  // 記下畫面認得的事：哪些列不是使用者自己送的、每一列此刻在不在畫面裡。
  // 畫的時候不能寫 state，交給計時器處理。
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const { task, from, onScreen } = e.props
    const kind = e.props.origin.kind
    const isMine = !task && !from && (kind === 'composer' || kind === 'unclassified')
    if (!isMine && !foreign.has(e.requestId)) {
      foreign.add(e.requestId)
      isForeignDirty = true
    }
    if (isMine) lastDrawnPrompt = e.requestId
    remember(e.requestId)
    track(e.requestId, onScreen)

    return next(e)
  })

  // 回答區塊：記下每一則的回答從哪裡開始（紀錄對不上時的退路），以及露出的位置。
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    drawn.add(e.requestId)
    if (!transcript.ownerOf.has(e.requestId) && !drawnOwner.has(e.requestId) && lastDrawnPrompt) {
      drawnOwner.set(e.requestId, lastDrawnPrompt)
      if (e.props.isFirstOfReply && !drawnAnswer.has(lastDrawnPrompt)) {
        drawnAnswer.set(lastDrawnPrompt, e.requestId)
      }
    }
    remember(e.requestId)
    track(e.requestId, e.props.onScreen)

    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!transcript.ownerOf.has(e.requestId) && !drawnOwner.has(e.requestId) && lastDrawnPrompt) {
      drawnOwner.set(e.requestId, lastDrawnPrompt)
    }
    remember(e.requestId)
    track(e.requestId, e.props.onScreen)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const list = await read($, prompts)
    const stamps = await read($, times)
    const q = await read($, query)
    const here = await read($, current)
    const shown = filterIndexes(list, q)
    const hereAt = list.findIndex(one => one.id === here)
    const factsOf = await read($, facts)
    const lastAt = await read($, activity)
    const isRunning = await read($, isBusy)
    const named = cfg.titles ? await read($, titles) : {}
    const spent = cfg.titles ? await read($, titleTokens) : 0

    // 每列：記號、編號、時間、內容。Button 在終端機會加「[ 」「 ]」四欄。
    const numCols = String(Math.max(1, list.length)).length
    const hasTimes = shown.some(i => stamps[list[i]!.id] !== undefined)
    const prefixCols = 2 + numCols + 1 + (hasTimes ? 6 : 0)
    const textCols = Math.max(8, e.props.bodyColumns - 4 - prefixCols)

    const status =
      list.length === 0
        ? s.statusEmpty
        : q.trim() !== ''
          ? s.statusFiltered(shown.length, list.length)
          : s.statusAll(list.length, hereAt >= 0 ? hereAt + 1 : undefined)

    // 每則：一顆按鈕（記號、編號、時間、標題或提問），下面一行灰字的事實（有才顯示）。
    // 事實那行對齊到內容開頭：按鈕外框「[ 」兩欄，加記號、編號。
    const factsIndent = 2 + 2 + numCols + 1
    const row = (i: number) => {
      const one = list[i]!
      const isHere = one.id === here
      const at = stamps[one.id]
      const num = String(i + 1).padStart(numCols, ' ')
      const f = factsOf[one.id]
      const line = factsLine(f, isRunning && i === list.length - 1, s.facts)
      return (
        <Box key={`r-${one.id}`} flexDirection="column">
          <Button key={`p-${one.id}`} onPress={() => press($, planValue(one.id))}>
            <Text color="cyan">{isHere ? '▶ ' : '  '}</Text>
            <Text dimColor={!isHere} bold={isHere}>
              {num}
            </Text>{' '}
            {hasTimes && <Text dimColor>{at === undefined ? '     ' : hhmm(at)} </Text>}
            <Text bold={isHere}>{clip(named[one.id] ?? one.text, textCols)}</Text>
          </Button>
          {line !== '' && (
            <Text key={`f-${one.id}`} dimColor color={f !== undefined && f.failures > 0 ? 'red' : undefined}>
              {' '.repeat(factsIndent)}
              {clip(line, Math.max(8, e.props.bodyColumns - factsIndent))}
            </Text>
          )}
        </Box>
      )
    }
    // 篩選時不分段；兩則之間停超過 15 分鐘就開新的一段（只有一段時不顯示段落標題）。
    const chapters =
      q.trim() === ''
        ? groupChapters(shown, i => ({ start: stamps[list[i]!.id], end: lastAt[list[i]!.id] }))
        : [{ index: 1, items: shown }]

    return (
      <Box flexDirection="column">
        <Input
          key="q"
          placeholder={s.filterPlaceholder}
          value={q}
          onInput={value => void update($, query, () => value)}
          onSubmit={value => {
            // Enter：跳到最新一則符合的，並清掉篩選（輸入框送出後本來就會清空）。
            const hit = filterIndexes(list, value).at(-1)
            if (hit !== undefined) press($, planValue(list[hit]!.id))
            void update($, query, () => '')
          }}
        />
        <Text dimColor>{status}</Text>
        {e.viewport?.isFullscreen === false && <Text color="yellow">{s.mainScreenNote}</Text>}
        {list.length > 0 && shown.length === 0 && <Text dimColor>{s.noMatch(q.trim())}</Text>}
        {chapters.map(ch => (
          <Box key={`c-${ch.index}`} flexDirection="column">
            {chapters.length > 1 && (
              <Text bold color="cyan">
                {clip(
                  s.chapter(ch.index, ch.gapMs === undefined ? undefined : s.gap(ch.gapMs), ch.items.length),
                  e.props.bodyColumns,
                )}
              </Text>
            )}
            {ch.items.map(row)}
          </Box>
        ))}
        {spent > 0 && <Text dimColor>{clip(s.titleUsage(spent), e.props.bodyColumns)}</Text>}
      </Box>
    )
  })

  // 提示框上方一列：目前第幾則、上一則／下一則／回答開頭／清單；
  // /jump、/marks 叫出的選單也畫在這裡。ctrl+x tab 移過來後 k／j／a／l 是快捷鍵。
  // 一般版面捲不動對話，這一列沒有用，不占位置。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.viewport?.isFullscreen === false) return next(e)
    const list = await read($, prompts)
    const menu = await read($, picker)
    if (list.length === 0 && !menu) return next(e)
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)

    if (menu) {
      return (
        <Box flexDirection="column">
          <Select
            key="jump-pick"
            label={menu.title}
            value={menu.options[0]?.value}
            autoFocus
            options={menu.options.map(one => ({
              value: one.value,
              label: clip(one.label, width - widthOf(menu.title) - 6),
            }))}
            onSelect={value => {
              press($, planValue(value))
              void update($, picker, () => null)
            }}
          />
          <Button key="jump-close" plain hotkey="x" onPress={() => void update($, picker, () => null)}>
            {s.pickerClose}
          </Button>
        </Box>
      )
    }

    const here = await read($, current)
    const at = list.findIndex(one => one.id === here)
    // 不加框的按鈕畫成「k: 上一則」：快捷鍵、冒號、空白、文字，加上按鈕之間的一格。
    const buttons = [s.bandPrev, s.bandNext, s.bandAnswer, s.bandList]
    const buttonCols = buttons.reduce((n, b) => n + widthOf(b) + 4, 0)
    // 引擎在這一列右邊另有收合鈕（約 4 欄）。
    const free = width - buttonCols - 5
    const long = s.bandLabel(at < 0 ? undefined : at + 1, list.length)
    // 太窄時只留「8/12」，不讓標籤被擠成兩行。
    const tag = widthOf(long) <= free ? long : at < 0 ? String(list.length) : `${at + 1}/${list.length}`
    const hintCols = widthOf(s.bandHint) + 2
    const isHintShown = free - widthOf(tag) - hintCols > 12
    const room = free - widthOf(tag) - (isHintShown ? hintCols : 0) - 1

    return (
      <Box flexDirection="row">
        {/* 字尾的空白在窄畫面會被吃掉，間隔一律用獨立的一格。 */}
        <Box flexShrink={0}>
          <Text dimColor>{tag}</Text>
        </Box>
        <Text> </Text>
        {at >= 0 && room > 6 && <Text>{clip(list[at]!.text, room)}</Text>}
        {at >= 0 && room > 6 && <Text> </Text>}
        <Button key="band-prev" plain hotkey="k" onPress={() => press($, planStep('prev'))}>
          {s.bandPrev}
        </Button>
        <Text> </Text>
        <Button key="band-next" plain hotkey="j" onPress={() => press($, planStep('next'))}>
          {s.bandNext}
        </Button>
        <Text> </Text>
        <Button key="band-ans" plain hotkey="a" onPress={() => press($, planAnswer())}>
          {s.bandAnswer}
        </Button>
        <Text> </Text>
        <Button
          key="band-open"
          plain
          hotkey="l"
          onPress={() =>
            void openPane($).then(opened =>
              opened.isPlaced ? undefined : update($, picker, () => recentPicker()),
            )
          }
        >
          {s.bandList}
        </Button>
        {isHintShown && <Text dimColor>  {s.bandHint}</Text>}
      </Box>
    )
  })
}
