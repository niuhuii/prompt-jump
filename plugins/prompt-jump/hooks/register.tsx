import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

type Engine = EngineInterface

import type { AnswerHead, Facts, Mark, PromptEntry } from '../types'
import { cardTop } from './card'
import { TICKS, factsLine, factsTail, groupChapters, workLevel } from './facts'
import { STRINGS, resolveLang, runtimeLocale } from './i18n'
import type { Strings } from './i18n'
import { markName, parseJump, positionOf, resolveIndex, stepTarget, topRow } from './nav'
import type { Seen } from './nav'
import { needsNote, reasonText, search } from './search'
import type { Hit, Searchable } from './search'
import { planTicks } from './ticks'
import { cleanPrompt, clip, hhmm, widthOf } from './toc'
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
const answers = atom({ plugin: 'prompt-jump', key: 'answers' } as const, {}, { shape: 'answers-1' })
const focused = atom({ plugin: 'prompt-jump', key: 'focused' } as const, '')

/** 設定選項（plugin.json 的 userConfig）。 */
type Config = {
  autoOpenPane: boolean
  language: unknown
  titles: boolean
  titleModel: string
}
let cfg: Config = { autoOpenPane: false, language: 'auto', titles: false, titleModel: 'haiku' }

/** 清單窗格想要的寬度（欄）；使用者拖過的寬度優先。 */
const PANE_COLUMNS = 44
/** 目前那一列、預覽與卡片的底色（跟著使用者的佈景主題）。 */
const SOFT_BG = 'userMessageBackground'
/** 清單一列和它的卡片共用的 hover 群組名稱。 */
const rowScope = (id: string) => `pj-row-${id}`.slice(0, 64)
/** 一般版面捲不動的說明出現過了沒有（跨 session 記在 $.store）。 */
const HELP_SHOWN = 'layout-help-shown'

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
  const heads = transcript.answers
  await update($, answers, all => {
    const next: Record<string, AnswerHead> = isFull ? {} : { ...all }
    for (const id of isFull ? heads.keys() : touched) {
      const a = heads.get(id)
      if (a !== undefined) next[id] = { ...a }
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

// 畫面最近一次說的版面：true 全螢幕、false 一般版面、undefined 還不知道。
let isFullscreenNow: boolean | undefined

const isMainScreenDeny = (deny: string) =>
  /not scrollable|none scrolls|no-surface/.test(deny) || isFullscreenNow === false

const explain = (deny: string) => (isMainScreenDeny(deny) ? s.withWhy(deny, s.mainScreenReason) : deny)

/** 說明還沒自動出現過就記下「出現過了」並回 true；只會回 true 一次（跨 session）。 */
const takeFirstHelp = async ($: Engine) => {
  try {
    if ((await $.store.get(HELP_SHOWN)) === true) return false
    await $.store.set(HELP_SHOWN, true)
    return true
  } catch {
    return false
  }
}

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

/**
 * 按鈕、選單：跳不過去時用提示說原因。一般版面的提示會帶「/jump-help」；
 * 一般版面沒有滑鼠，清單只能用鍵盤按，完整說明交給指令那一條路。
 */
const press = ($: Engine, plan: Plan) =>
  void go($, plan).then(r => {
    if (!r.isMoved) $.ui.toast(r.reason === undefined ? r.text : s.scrollToast(explain(r.reason)))
  })

/**
 * 指令：跳過去時只跳提示，不在對話底部多加一列（那會把畫面拉回最底下）。
 * 一般版面第一次捲不動（/jump 編號、/prev、/next…）時，回覆後面附上完整說明，只附一次。
 */
const reply = async ($: Engine, outcome: Outcome) => {
  if (outcome.isMoved) {
    $.ui.toast(outcome.text)
    return {}
  }
  const isFirstHelp = outcome.reason !== undefined && isMainScreenDeny(outcome.reason) && (await takeFirstHelp($))
  return { text: isFirstHelp ? `${outcome.text}\n\n${s.layoutHelp}` : outcome.text }
}

/** /prev、/next、/ans：記下版面、讀新紀錄、照計畫跳。 */
const runPlan = async ($: Engine, isFullscreen: boolean, plan: () => Plan) => {
  isFullscreenNow = isFullscreen
  await sync($)
  return reply($, await go($, plan()))
}

// ── 搜尋（篩選框、/jump 關鍵字、自動完成共用）────────────────────────

/** 目錄每一則可以被搜的東西：提問（有自動標題時連標題）、回答開頭、改過的檔。 */
const searchable = (
  list: readonly PromptEntry[],
  named: Record<string, string>,
  heads: ReadonlyMap<string, AnswerHead> | Record<string, AnswerHead>,
  factsOf: ReadonlyMap<string, Facts> | Record<string, Facts>,
): Searchable[] => {
  const get = <T,>(from: ReadonlyMap<string, T> | Record<string, T>, id: string) =>
    from instanceof Map ? from.get(id) : (from as Record<string, T>)[id]
  return list.map(one => ({
    text: named[one.id] === undefined ? one.text : `${named[one.id]} ${one.text}`,
    answer: get(heads, one.id)?.head,
    files: get(factsOf, one.id)?.files,
  }))
}

/** 指令用的搜尋：直接用記憶體裡的紀錄，不等 state。 */
const searchEntries = (words: string) =>
  search(searchable(entries, {}, transcript.answers, transcript.facts.byPrompt), words)

/** 一則加上符合原因（看得出原因時不加）：文字清單、選單、提示用。 */
const hitLabel = (hit: Hit, width = 60) => {
  const base = label(hit.index, width)
  const item = searchable([entries[hit.index]!], {}, transcript.answers, transcript.facts.byPrompt)[0]!
  return needsNote(hit, base) ? `${base}${s.hitReason(reasonText(hit, item, 40, s.reason))}` : base
}

const openPane = async ($: Engine) => {
  const opened = await $.ui.open({ id: PANE, title: s.paneTitle, columns: PANE_COLUMNS })
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
    { name: 'jump-help', description: s.cmdHelp },
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
    autoOpenPane: options.autoOpenPane === true,
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
    if (cfg.autoOpenPane) void $.ui.open({ id: PANE, title: s.paneTitle, columns: PANE_COLUMNS })

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
      await update($, answers, () => ({}))
      await update($, focused, () => '')
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
    isFullscreenNow = e.presentation.isFullscreen

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

    const hits = searchEntries(q.words)
    if (hits.length === 0) return { text: s.notFound(q.words) }
    if (hits.length === 1) return reply($, await go($, { ...planIndex(hits[0]!.index), label: hitLabel(hits[0]!) }))
    const shown = hits.slice(-LIST_MAX).reverse()
    if (isFullscreen) {
      await update($, picker, () => ({
        title: s.searchTitle(q.words),
        options: shown.map(hit => ({ value: entries[hit.index]!.id, label: hitLabel(hit) })),
      }))
    }
    return {
      text: [
        s.hits(q.words, hits.length),
        ...shown.slice(0, 10).map(hit => `  ${hitLabel(hit, 70)}`),
        shown.length > 10 ? `  ${s.hitsMore}` : '',
        isFullscreen ? s.pickerHint : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  })

  on('command.run', { command: 'prev' }, ($, e) => runPlan($, e.presentation.isFullscreen, () => planStep('prev')))
  on('command.run', { command: 'next' }, ($, e) => runPlan($, e.presentation.isFullscreen, () => planStep('next')))
  on('command.run', { command: 'ans' }, ($, e) => runPlan($, e.presentation.isFullscreen, planAnswer))

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
    const hits = searchEntries(words).slice(-8).reverse()
    if (hits.length === 0) return base
    return {
      suggestions: [
        ...base.suggestions,
        ...hits.map(hit => ({ text: String(hit.index + 1), label: hitLabel(hit, 60) })),
      ],
    }
  })

  on('command.run', { command: 'jump-help' }, async () => ({ text: s.layoutHelp }))

  // 鍵盤焦點移到刻度或清單的某一列：預覽跟著換成那一則。沒有指定 plugin 的
  // ui.focus hook 只聽得到自己畫的元素和引擎自己的停駐點（那時 element 沒有值）。
  on('ui.focus', async ($, e, next) => {
    // 引擎填 element；$.ui.focus({ requestId, key }) 直接傳下來時是 key。
    const element = e.element ?? (e as { key?: string }).key ?? ''
    const id = /^[tp]-(.+)$/.exec(element)?.[1] ?? ''
    await update($, focused, was => (was === id ? was : id))
    return next(e)
  })

  // 送出新的提問時，焦點已回到提示框：預覽回到目前那一則。
  on('prompt.submit', async ($, e, next) => {
    await update($, focused, was => (was === '' ? was : ''))
    return next(e)
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

  // ── 清單窗格（按 l 或 /jump 打開）──────────────────────────────────
  // 一則一列：左邊色條與編號、提問、右邊短標記（±改檔 $指令 ✗失敗）。目前那一則
  // 有色條、底色、粗體。時間只出現在分段線上。滑鼠指到或鍵盤移到某一列，下面
  // （太靠底時改在上面）浮出一張卡片：提問、回答開頭、這輪做了什麼。
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    if (e.viewport?.isFullscreen !== undefined) isFullscreenNow = e.viewport.isFullscreen
    const list = await read($, prompts)
    const stamps = await read($, times)
    const q = await read($, query)
    const here = await read($, current)
    const factsOf = await read($, facts)
    const lastAt = await read($, activity)
    const isRunning = await read($, isBusy)
    const heads = await read($, answers)
    const focusId = await read($, focused)
    const named = cfg.titles ? await read($, titles) : {}
    const spent = cfg.titles ? await read($, titleTokens) : 0
    const W = Math.max(16, e.props.bodyColumns)
    const isFiltering = q.trim() !== ''
    const items = searchable(list, named, heads, factsOf)
    const hits = search(items, q)
    const hitOf = new Map(hits.map(hit => [hit.index, hit]))
    const hereAt = list.findIndex(one => one.id === here)

    const status =
      list.length === 0
        ? s.statusEmpty
        : isFiltering
          ? s.statusFiltered(hits.length, list.length)
          : s.statusAll(list.length, hereAt >= 0 ? hereAt + 1 : undefined)

    const numCols = String(Math.max(1, list.length)).length
    // 色條一欄、編號、兩格空白。
    const prefix = 1 + numCols + 2
    const { offset, bodyRows } = e.props.scroll
    // 內容第幾列（放卡片要用）。
    let y = 0

    // 每一列在內容的第幾列、卡片要不要直接顯示（鍵盤焦點那一列）；列都排完、
    // 知道內容一共幾列後才放卡片。
    const rowsAt: { i: number; rowY: number; isShown: boolean }[] = []

    /**
     * 卡片：粗體提問兩行、灰字回答開頭兩行、這輪做了什麼一行；窗格太矮放不下時改成
     * 一行（編號＋回答開頭）。位置由 cardTop 決定：不蓋住指到的那一列和上下相鄰的列，
     * 否則指標往下移會落在卡片上（卡片跟那一列同一個 hover 群組，指著它群組就一直亮著），
     * 下一列指不到。
     */
    const card = (i: number, rowY: number, isShown: boolean, contentRows: number) => {
      const one = list[i]!
      const f = factsOf[one.id]
      const inner = Math.max(8, W - 3 - 4)
      // 提問、回答各最多兩行（maxLines）：一行放得下是一行，放不下就是兩行。
      const lines = (text: string) => (widthOf(text) <= inner ? 1 : 2)
      const title = `${i + 1}  ${named[one.id] ?? one.text}`
      const answer = heads[one.id]?.head ?? (isRunning && i === list.length - 1 ? s.facts.running : s.noAnswerYet)
      const done = factsLine(f, false, s.facts)
      // 已經顯示的（鍵盤焦點那一列）不能再掛 hover 顯示，引擎會拒絕整棵樹。
      const display = isShown ? ('flex' as const) : ('none' as const)
      const hover = isShown ? undefined : { scope: rowScope(one.id), display: 'flex' as const }
      // 提示框上方的窗格框貼著內容，底下沒有空白；側邊窗格的空白畫得出來。
      const isInline = e.props.placement === 'inline'
      const room = {
        rowY,
        offset,
        windowRows: isInline ? Math.min(bodyRows, contentRows) : bodyRows,
        contentRows,
        hasRoomBelow: !isInline,
      }
      const height = 2 + lines(title) + lines(answer) + (done === '' ? 0 : 1)
      const top = cardTop({ ...room, height })
      if (top !== undefined) {
        return (
          <Box
            key={`k-${one.id}`}
            position="absolute"
            top={top}
            left={2}
            width={W - 3}
            height={height}
            flexDirection="column"
            borderStyle="round"
            borderDimColor
            backgroundColor={SOFT_BG}
            paddingX={1}
            // 跟那一列同一個 hover 群組：指到那一列就顯示。
            display={display}
            hover={hover}
          >
            <Text bold maxLines={2}>
              {title}
            </Text>
            <Text dimColor maxLines={2}>
              {answer}
            </Text>
            {done !== '' && (
              <Text dimColor color={f !== undefined && f.failures > 0 ? 'red' : undefined}>
                {clip(done, inner)}
              </Text>
            )}
          </Box>
        )
      }
      const lineTop = cardTop({ ...room, height: 1 })
      // 矮到連一行都會蓋到相鄰的列：不放預覽。
      if (lineTop === undefined) return null
      const num = String(i + 1).padStart(numCols, ' ')
      return (
        <Box
          key={`k-${one.id}`}
          position="absolute"
          top={lineTop}
          left={0}
          width={W}
          height={1}
          backgroundColor={SOFT_BG}
          display={display}
          hover={hover}
        >
          <Text dimColor>{clip(` ${num}  ${answer}`, W)}</Text>
        </Box>
      )
    }

    const row = (i: number) => {
      const one = list[i]!
      const isHere = one.id === here
      const num = String(i + 1).padStart(numCols, ' ')
      const tail = factsTail(factsOf[one.id], isRunning && i === list.length - 1, s.facts)
      const tailCols = tail.reduce((n, part) => n + widthOf(part.text) + 1, 0)
      const room = Math.max(6, W - prefix - tailCols - 1)
      const shownText = clip(named[one.id] ?? one.text, room)
      const pad = Math.max(1, W - prefix - widthOf(shownText) - tailCols)
      const hit = hitOf.get(i)
      const note = isFiltering && hit !== undefined && needsNote(hit, shownText)
      rowsAt.push({ i, rowY: y, isShown: focusId === one.id })
      y += note ? 2 : 1
      return (
        <Box key={`r-${one.id}`} flexDirection="column" hover={{ scope: rowScope(one.id) }}>
          <Box backgroundColor={isHere ? SOFT_BG : undefined}>
            <Button key={`p-${one.id}`} plain onPress={() => press($, planValue(one.id))}>
              <Text color="cyan">{isHere ? '▌' : ' '}</Text>
              <Text color={isHere ? 'cyan' : undefined} dimColor={!isHere} bold={isHere}>
                {num}
              </Text>
              <Text>{'  '}</Text>
              <Text bold={isHere}>{shownText}</Text>
              {tail.length > 0 && <Text>{' '.repeat(pad)}</Text>}
              {tail.map((part, k) => (
                <Text key={`t${k}`} dimColor={!part.isFailure} color={part.isFailure ? 'red' : undefined}>
                  {k === 0 ? part.text : ` ${part.text}`}
                </Text>
              ))}
            </Button>
          </Box>
          {note && (
            <Text dimColor>
              {' '.repeat(prefix)}
              {reasonText(hit, items[i]!, W - prefix, s.reason)}
            </Text>
          )}
        </Box>
      )
    }

    const shown = hits.map(hit => hit.index)
    // 篩選時不分段；兩則之間停超過 15 分鐘就開新的一段，分段線上寫開始時間和停了多久。
    const chapters = isFiltering
      ? [{ index: 1, items: shown, gapMs: undefined }]
      : groupChapters(shown, i => ({ start: stamps[list[i]!.id], end: lastAt[list[i]!.id] }))
    const head = (ch: { gapMs?: number; items: number[] }) => {
      if (isFiltering) return undefined
      const first = ch.items[0]
      const at = first === undefined ? undefined : stamps[list[first]!.id]
      const text = s.chapter(at === undefined ? undefined : hhmm(at), ch.gapMs === undefined ? undefined : s.gap(ch.gapMs))
      return text === '' ? undefined : clip(`── ${text} ${'─'.repeat(Math.max(0, W - widthOf(text) - 4))}`, W)
    }

    // 輸入框一列、狀態一列。
    y = 2
    const isMainScreen = e.viewport?.isFullscreen === false
    if (isMainScreen) y++
    if (list.length > 0 && shown.length === 0) y++
    // 先排列（記下每一列在第幾列），再放卡片。
    const body = chapters.map((ch, k) => {
      const line = head(ch)
      if (line !== undefined) y++
      return (
        <Box key={`c-${k}`} flexDirection="column">
          {line !== undefined && <Text dimColor>{line}</Text>}
          {ch.items.map(row)}
        </Box>
      )
    })
    if (spent > 0) y++
    const contentRows = y
    // 卡片全部畫在清單最後面：absolute 的 Box 只蓋得住畫在它前面的東西。
    const cards = rowsAt.map(at => card(at.i, at.rowY, at.isShown, contentRows)).filter(one => one !== null)
    return (
      <Box flexDirection="column">
        <Input
          key="q"
          placeholder={s.filterPlaceholder}
          value={q}
          onInput={value => void update($, query, () => value)}
          onSubmit={value => {
            // Enter：跳到最新一則符合的，並清掉篩選（輸入框送出後本來就會清空）。
            const hit = search(items, value).at(-1)
            if (hit !== undefined) press($, planValue(list[hit.index]!.id))
            void update($, query, () => '')
          }}
        />
        <Text dimColor>{status}</Text>
        {isMainScreen && <Text color="yellow">{clip(s.mainScreenNote, W)}</Text>}
        {list.length > 0 && shown.length === 0 && <Text dimColor>{s.noMatch(q.trim())}</Text>}
        {body}
        {spent > 0 && <Text dimColor>{clip(s.titleUsage(spent), W)}</Text>}
        {cards as never}
      </Box>
    )
  })

  // ── 提示框上方：刻度列＋預覽列 ─────────────────────────────────────
  // 第一列：目前第幾則、每則一根刻度（高度＝工作量，有失敗的那輪紅色，目前那一則
  // 亮青色，停超過 15 分鐘空一格）、k ‹ j › a 回答 l 清單。第二列：預覽，平常是
  // 目前那一則，滑鼠指到哪根刻度（或鍵盤移到哪根）就換成那一則。
  // /jump、/marks 叫出的選單也畫在這裡。一般版面捲不動對話，這兩列不占位置。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== undefined) isFullscreenNow = e.viewport.isFullscreen
    if (e.props.hasSurvey || e.viewport?.isFullscreen === false) return next(e)
    const list = await read($, prompts)
    const menu = await read($, picker)
    if (list.length === 0 && !menu) return next(e)
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    const W = Math.max(20, e.props.bodyColumns)

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
              label: clip(one.label, W - widthOf(menu.title) - 6),
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
    const focusId = await read($, focused)
    const factsOf = await read($, facts)
    const heads = await read($, answers)
    const stamps = await read($, times)
    const lastAt = await read($, activity)
    const isRunning = await read($, isBusy)
    const named = cfg.titles ? await read($, titles) : {}
    const n = list.length
    const at = list.findIndex(one => one.id === here)
    const focusAt = list.findIndex(one => one.id === focusId)
    const hasPreviewRow = e.props.maxRows >= 2

    // 左邊：「8/12」或（不知道目前位置時）「12」。
    const numW = String(n).length
    const tagCols = at >= 0 ? numW + 1 + numW : numW
    // 右邊的按鈕：不加框的按鈕畫成「k: ‹」，按鈕之間空兩格。
    const buttons = [
      { key: 'band-prev', hotkey: 'k', text: s.bandPrev, onPress: () => press($, planStep('prev')) },
      { key: 'band-next', hotkey: 'j', text: s.bandNext, onPress: () => press($, planStep('next')) },
      { key: 'band-ans', hotkey: 'a', text: s.bandAnswer, onPress: () => press($, planAnswer()) },
      {
        key: 'band-open',
        hotkey: 'l',
        text: s.bandList,
        onPress: () =>
          void openPane($).then(opened => (opened.isPlaced ? undefined : update($, picker, () => recentPicker()))),
      },
    ]
    const buttonCols = (shown: typeof buttons) => shown.reduce((m, b) => m + widthOf(b.text) + 3 + 2, 0)
    // 太窄時先拿掉「回答」「清單」，留住刻度。
    const kept = W - tagCols - 2 - buttonCols(buttons) >= 12 ? buttons : buttons.slice(0, 2)
    const tickRoom = Math.max(0, W - tagCols - 2 - buttonCols(kept))

    const isGap = (i: number) => {
      const start = stamps[list[i]!.id]
      const prev = list[i - 1]
      const end = prev === undefined ? undefined : (lastAt[prev.id] ?? stamps[prev.id])
      return start !== undefined && end !== undefined && start - end > 15 * 60 * 1000
    }
    const plan = planTicks(n, at, tickRoom, isGap)
    const tickLeft = tagCols + 2

    /** 預覽列的內容：編號、粗體提問、灰字回答開頭。 */
    const preview = (i: number) => {
      const one = list[i]!
      const isHere = i === at
      const num = String(i + 1).padStart(numW)
      const answer = heads[one.id]?.head ?? (isRunning && i === n - 1 ? s.facts.running : s.noAnswerYet)
      const text = named[one.id] ?? one.text
      const afterNum = W - numW - 2
      const qCols = Math.min(widthOf(text), Math.max(10, Math.floor(afterNum * 0.45)))
      const aCols = afterNum - qCols - 3
      return (
        <Box flexDirection="row">
          <Text color={isHere ? 'cyan' : undefined} dimColor={!isHere} bold={isHere}>
            {num}
          </Text>
          <Box width={2} flexShrink={0} />
          <Text bold>{clip(text, qCols)}</Text>
          {aCols > 6 && <Box width={3} flexShrink={0} />}
          {aCols > 6 && <Text dimColor>{clip(answer, aCols)}</Text>}
        </Box>
      )
    }

    const ticks: unknown[] = []
    let col = 0
    if (plan.before > 0) {
      ticks.push(
        <Text key="more-l" dimColor>
          {`‹${plan.before}`}
        </Text>,
      )
      col = String(plan.before).length + 1
    }
    for (const item of plan.items) {
      if (item.col > col) ticks.push(<Box key={`g${item.index}`} width={item.col - col} flexShrink={0} />)
      const one = list[item.index]!
      const f = factsOf[one.id]
      const isHere = item.index === at
      const isFailed = f !== undefined && f.failures > 0
      const glyph = TICKS[workLevel(f, heads[one.id]?.size)]!
      ticks.push(
        <Box key={`tb-${one.id}`} width={plan.per} flexShrink={0}>
          <Button key={`t-${one.id}`} plain onPress={() => press($, planValue(one.id))}>
            <Text color={isHere ? 'cyan' : isFailed ? 'red' : undefined} dimColor={!isHere && !isFailed} bold={isHere}>
              {glyph}
            </Text>
          </Button>
          {hasPreviewRow && (
            <Box
              position="absolute"
              top={1}
              left={-(tickLeft + item.col)}
              width={W}
              backgroundColor={SOFT_BG}
              display="none"
              hover={{ display: 'flex' }}
            >
              {preview(item.index)}
            </Box>
          )}
        </Box>,
      )
      col = item.col + plan.per
    }
    if (plan.after > 0) {
      if (plan.per === 1) ticks.push(<Box key="more-gap" width={1} flexShrink={0} />)
      ticks.push(
        <Text key="more-r" dimColor>
          {`${plan.after}›`}
        </Text>,
      )
    }

    const shownAt = focusAt >= 0 ? focusAt : at
    const tickRow = (
      <Box key="ticks" flexDirection="row">
        <Box flexShrink={0}>
          {at >= 0 ? (
            <Text>
              <Text color="cyan" bold>
                {String(at + 1).padStart(numW)}
              </Text>
              <Text dimColor>{`/${n}`}</Text>
            </Text>
          ) : (
            <Text dimColor>{String(n)}</Text>
          )}
        </Box>
        <Box width={2} flexShrink={0} />
        <Box width={tickRoom} flexShrink={0} flexDirection="row">
          {ticks as never}
        </Box>
        {kept.map((b, k) => (
          <Box key={`w-${b.key}`} flexDirection="row" flexShrink={0}>
            <Box width={2} flexShrink={0} />
            <Button key={b.key} plain hotkey={b.hotkey} onPress={b.onPress}>
              {b.text}
            </Button>
            {k === kept.length - 1 && <Box width={1} flexShrink={0} />}
          </Box>
        ))}
      </Box>
    )
    const previewRow = !hasPreviewRow ? undefined : shownAt >= 0 ? (
      <Box key="pv" flexDirection="row" backgroundColor={focusAt >= 0 ? SOFT_BG : undefined}>
        {preview(shownAt)}
      </Box>
    ) : (
      <Text key="pv" dimColor>
        {clip(s.bandHint, W)}
      </Text>
    )
    // 指到刻度時浮出的預覽（absolute）只蓋得住畫在它前面的東西：預覽列先畫，
    // 刻度列後畫；用 column-reverse 讓刻度列仍在上面。
    return (
      <Box flexDirection="column-reverse">
        {previewRow}
        {tickRow}
      </Box>
    )
  })
}
