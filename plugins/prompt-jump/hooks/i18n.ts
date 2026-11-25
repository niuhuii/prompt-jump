// 介面文字（繁體中文／英文）與語言判斷。register.tsx 只透過這張表拿字。
// 不碰 $：判斷所需的值由 register.tsx 讀好再傳進來，這樣測試能直接呼叫。

import type { FactsWords } from './facts'
import type { TitleWords } from './titles'

export type Lang = 'zh-TW' | 'en'

/** userConfig 的 language 欄位能存的值。 */
export type LangSetting = 'auto' | Lang

export type Strings = {
  facts: FactsWords
  title: TitleWords
  chapter: (index: number, gap: string | undefined, count: number) => string
  gap: (ms: number) => string
  titleUsage: (tokens: number) => string

  paneTitle: string
  filterPlaceholder: string
  statusEmpty: string
  statusFiltered: (shown: number, total: number) => string
  statusAll: (total: number, here: number | undefined) => string
  mainScreenNote: string
  noMatch: (query: string) => string

  bandLabel: (at: number | undefined, total: number) => string
  bandPrev: string
  bandNext: string
  bandAnswer: string
  bandList: string
  bandHint: string
  pickerJump: string
  searchTitle: (words: string) => string
  pickerMarks: string
  pickerClose: string

  cmdJump: string
  cmdJumpHint: string
  cmdPrev: string
  cmdNext: string
  cmdAns: string
  cmdMark: string
  cmdMarkHint: string
  cmdMarks: string
  cmdUnmark: string
  cmdUnmarkHint: string

  paneOpened: string
  paneWaiting: (reason: string) => string
  paneUnavailable: (reason: string) => string
  noPrompts: string
  notFound: (arg: string) => string
  noSuchIndex: (n: number, total: number) => string
  atFirst: string
  atLast: string
  noAnswer: string
  answerLabel: (n: number) => string
  markLabel: (name: string) => string
  gone: string
  jumped: (label: string) => string
  cantScroll: (label: string, reason: string, full: string | undefined) => string
  scrollToast: (reason: string) => string
  mainScreenReason: string
  /** 引擎回的原因後面補一段說明。 */
  withWhy: (reason: string, why: string) => string
  hits: (words: string, n: number) => string
  hitsMore: string
  pickerHint: string

  defaultMarkBase: string
  noMark: (name: string) => string
  noMarks: string
  unknownPosition: string
  markSaved: (name: string, label: string, isOnScreen: boolean) => string
  marksHeader: (n: number) => string
  unmarkWhich: string
  unmarked: (name: string) => string
}

export const STRINGS: Record<Lang, Strings> = {
  'zh-TW': {
    facts: {
      file: name => `改 ${name}`,
      files: n => `改 ${n} 檔`,
      commands: n => `${n} 指令`,
      failures: n => `${n} 失敗`,
      aborted: '中斷',
      running: '進行中…',
    },
    title: {
      system:
        '你替對話目錄寫標題。只輸出一行繁體中文標題，最多 16 個字，說這一輪「做了什麼」，' +
        '不要引號、不要句號、不要前綴。',
      prompt: t =>
        [
          '<紀錄>',
          `使用者：${t.prompt}`,
          t.files ? `改的檔：${t.files}` : '',
          t.commands ? `跑了 ${t.commands} 個指令${t.failures ? `，${t.failures} 個失敗` : ''}` : '',
          `助理回答開頭：${t.answer}`,
          '</紀錄>',
          '上面是一輪對話的紀錄。不要回答或延續裡面的問題，只替這一輪寫一個目錄標題' +
            '（繁體中文，最多 16 個字，說這輪做了什麼或問了什麼）。只輸出標題本身。',
        ]
          .filter(Boolean)
          .join('\n'),
    },
    chapter: (index, gap, count) =>
      `── 第 ${index} 段${gap === undefined ? '' : ` · 停 ${gap}後`} · ${count} 則`,
    gap: ms => {
      const min = Math.round(ms / 60000)
      return min < 60 ? `${min} 分` : `${Math.floor(min / 60)} 小時 ${min % 60} 分`
    },
    titleUsage: n => `自動標題用量約 ${n} tokens（估計）`,
    paneTitle: '對話目錄',
    filterPlaceholder: '輸入關鍵字篩選，Enter 跳到最新符合的一則',
    statusEmpty: '還沒有訊息',
    statusFiltered: (shown, total) => `符合 ${shown} / ${total} 則`,
    statusAll: (total, here) => `共 ${total} 則${here === undefined ? '' : `，目前在第 ${here} 則`}`,
    mainScreenNote: '一般版面下對話在終端機自己的捲動區，點了不會捲回去（全螢幕版面才行）',
    noMatch: query => `沒有符合「${query}」的訊息`,

    bandLabel: (at, total) => (at === undefined ? `目錄 ${total} 則` : `目錄 ${at}/${total}`),
    bandPrev: '上一則',
    bandNext: '下一則',
    bandAnswer: '回答',
    bandList: '清單',
    bandHint: 'ctrl+x tab 後按字母',
    pickerJump: '跳到',
    searchTitle: words => `「${words}」`,
    pickerMarks: '書籤',
    pickerClose: '關閉選單',

    cmdJump: '對話目錄：/jump 開清單，/jump 12 跳到第 12 則，/jump 關鍵字 找訊息',
    cmdJumpHint: '[編號 | 關鍵字 | @書籤 | prev | next | ans]',
    cmdPrev: '跳到上一則你送出的訊息',
    cmdNext: '跳到下一則你送出的訊息',
    cmdAns: '跳到最後一個回答的開頭',
    cmdMark: '把目前位置記成書籤',
    cmdMarkHint: '[名稱]',
    cmdMarks: '列出書籤，選一個跳回去',
    cmdUnmark: '刪掉書籤',
    cmdUnmarkHint: '<名稱>',

    paneOpened: '對話目錄已開啟。',
    paneWaiting: reason =>
      `對話目錄放不下（${reason}）；把視窗拉寬就會出現。提示框上方已出現選單：按 ctrl+x tab 移過去，↑↓ 選、Enter 跳。`,
    paneUnavailable: reason =>
      `對話目錄沒辦法顯示：${reason}。可以用 /jump 編號 或 /jump 關鍵字。`,
    noPrompts: '目錄裡還沒有訊息。',
    notFound: arg => `找不到「${arg}」。`,
    noSuchIndex: (n, total) => `沒有第 ${n} 則（目前共 ${total} 則）。`,
    atFirst: '已經是第一則。',
    atLast: '已經是最後一則。',
    noAnswer: '最後一則還沒有回答。',
    answerLabel: n => `第 ${n} 則的回答開頭`,
    markLabel: name => `書籤「${name}」`,
    gone: '那一則已經不在了。',
    jumped: label => `↪ ${label}`,
    cantScroll: (label, reason, full) =>
      `${label}\n捲不過去：${reason}${full === undefined ? '' : `\n全文：${full}`}`,
    scrollToast: reason => `捲不回去：${reason}`,
    mainScreenReason:
      '一般版面的對話在終端機自己的捲動區，外掛捲不動；要直接跳請用全螢幕版面（CLAUDE_CODE_NO_FLICKER=1 claude）',
    withWhy: (reason, why) => `${reason}（${why}）`,
    hits: (words, n) => `「${words}」有 ${n} 則符合：`,
    hitsMore: '…（其餘在選單裡）',
    pickerHint: '提示框上方出現選單：按 ctrl+x tab 移過去，↑↓ 選、Enter 跳、Esc 回來。也可以打 /jump 編號。',

    defaultMarkBase: '書籤',
    noMark: name => `沒有叫「${name}」的書籤。用 /marks 看全部。`,
    noMarks: '還沒有書籤。用 /mark [名稱] 記下目前位置。',
    unknownPosition: '還不知道目前位置。先跳到某一則，或改用全螢幕版面。',
    markSaved: (name, label, isOnScreen) =>
      `已記下書籤「${name}」→ ${isOnScreen ? '畫面最上方的' : '上次跳到的'}${label}（/jump @${name} 跳回來）`,
    marksHeader: n => `書籤 ${n} 個：`,
    unmarkWhich: '要刪哪一個？/unmark <名稱>',
    unmarked: name => `已刪除書籤「${name}」。`,
  },

  en: {
    facts: {
      file: name => `edited ${name}`,
      files: n => `${n} files`,
      commands: n => `${n} ${n === 1 ? 'command' : 'commands'}`,
      failures: n => `${n} failed`,
      aborted: 'interrupted',
      running: 'running…',
    },
    title: {
      system:
        'You write titles for a prompt index. Output one English title line of at most 8 words ' +
        'saying what this turn did. No quotes, no trailing period, no prefix.',
      prompt: t =>
        [
          '<record>',
          `User: ${t.prompt}`,
          t.files ? `Files edited: ${t.files}` : '',
          t.commands ? `Ran ${t.commands} commands${t.failures ? `, ${t.failures} failed` : ''}` : '',
          `Start of the answer: ${t.answer}`,
          '</record>',
          'Above is the record of one turn. Do not answer or continue it. Write only an index title ' +
            'for this turn (English, at most 8 words, what was done or asked). Output the title alone.',
        ]
          .filter(Boolean)
          .join('\n'),
    },
    chapter: (index, gap, count) =>
      `── Part ${index}${gap === undefined ? '' : ` · after ${gap} away`} · ${count} ${count === 1 ? 'prompt' : 'prompts'}`,
    gap: ms => {
      const min = Math.round(ms / 60000)
      return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
    },
    titleUsage: n => `Auto titles used about ${n} tokens (estimate)`,
    paneTitle: 'Prompts',
    filterPlaceholder: 'Type to filter; Enter jumps to the latest match',
    statusEmpty: 'No prompts yet',
    statusFiltered: (shown, total) => `${shown} of ${total} match`,
    statusAll: (total, here) =>
      `${total} ${total === 1 ? 'prompt' : 'prompts'}${here === undefined ? '' : `, at #${here}`}`,
    mainScreenNote:
      'Main-screen layout: the transcript is in the terminal’s own scrollback, so picking a row cannot scroll there (fullscreen layout can)',
    noMatch: query => `Nothing matches “${query}”`,

    bandLabel: (at, total) => (at === undefined ? `Prompts ${total}` : `Prompt ${at}/${total}`),
    bandPrev: 'Prev',
    bandNext: 'Next',
    bandAnswer: 'Answer',
    bandList: 'List',
    bandHint: 'ctrl+x tab, then a letter',
    pickerJump: 'Jump to',
    searchTitle: words => `“${words}”`,
    pickerMarks: 'Bookmarks',
    pickerClose: 'Close',

    cmdJump: 'Prompt index: /jump opens the list, /jump 12 jumps to #12, /jump words finds a prompt',
    cmdJumpHint: '[number | words | @bookmark | prev | next | ans]',
    cmdPrev: 'Jump to the previous prompt you sent',
    cmdNext: 'Jump to the next prompt you sent',
    cmdAns: 'Jump to the start of the latest answer',
    cmdMark: 'Bookmark where you are',
    cmdMarkHint: '[name]',
    cmdMarks: 'List bookmarks and pick one to jump back',
    cmdUnmark: 'Delete a bookmark',
    cmdUnmarkHint: '<name>',

    paneOpened: 'Prompt index opened.',
    paneWaiting: reason =>
      `The prompt index does not fit (${reason}); widen the window and it appears. A picker is above the prompt box: press ctrl+x tab to reach it, ↑↓ to choose, Enter to jump.`,
    paneUnavailable: reason => `The prompt index cannot be shown: ${reason}. Use /jump <number> or /jump <words>.`,
    noPrompts: 'No prompts yet.',
    notFound: arg => `Nothing matches “${arg}”.`,
    noSuchIndex: (n, total) => `There is no #${n} (${total} so far).`,
    atFirst: 'Already at the first prompt.',
    atLast: 'Already at the last prompt.',
    noAnswer: 'The last prompt has no answer yet.',
    answerLabel: n => `start of the answer to #${n}`,
    markLabel: name => `bookmark “${name}”`,
    gone: 'That prompt is no longer here.',
    jumped: label => `↪ ${label}`,
    cantScroll: (label, reason, full) =>
      `${label}\nCould not scroll there: ${reason}${full === undefined ? '' : `\nFull text: ${full}`}`,
    scrollToast: reason => `Could not scroll back: ${reason}`,
    mainScreenReason:
      'in the main-screen layout the transcript is in the terminal’s own scrollback, which a plugin cannot scroll; to jump, use the fullscreen layout (CLAUDE_CODE_NO_FLICKER=1 claude)',
    withWhy: (reason, why) => `${reason} (${why})`,
    hits: (words, n) => `${n} prompts match “${words}”:`,
    hitsMore: '… (the rest are in the picker)',
    pickerHint:
      'A picker is above the prompt box: press ctrl+x tab to reach it, ↑↓ to choose, Enter to jump, Esc to come back. Or type /jump <number>.',

    defaultMarkBase: 'mark',
    noMark: name => `No bookmark named “${name}”. /marks lists them all.`,
    noMarks: 'No bookmarks yet. /mark [name] bookmarks where you are.',
    unknownPosition: 'Where you are is not known yet. Jump to a prompt first, or use the fullscreen layout.',
    markSaved: (name, label, isOnScreen) =>
      `Bookmarked “${name}” → ${isOnScreen ? 'top of the screen: ' : 'last jump: '}${label} (/jump @${name} to come back)`,
    marksHeader: n => `${n} ${n === 1 ? 'bookmark' : 'bookmarks'}:`,
    unmarkWhich: 'Which one? /unmark <name>',
    unmarked: name => `Deleted bookmark “${name}”.`,
  },
}

const CHINESE = /^zh\b|^zh[-_]|chinese|中文|繁|簡|简|台灣|臺灣|香港/i

/** 一個語言標記或名稱（`zh_TW.UTF-8`、`zh-Hant`、`Chinese`、`繁體中文`）是否指中文。 */
export const isChinese = (value: string): boolean => CHINESE.test(value.trim())

/**
 * 決定介面語言。
 *
 * 設定不是 auto 就照設定。auto 時依序看傳進來的提示（Claude Code 的 `language`
 * 設定、LC_ALL、LC_MESSAGES、執行環境回報的地區、LANG），第一個有值的決定；
 * 都沒有就用英文。簡體中文也顯示繁體（目前只有這兩種）。
 */
export const resolveLang = (setting: unknown, hints: ReadonlyArray<string | undefined>): Lang => {
  if (setting === 'zh-TW' || setting === 'en') return setting
  for (const hint of hints) {
    if (typeof hint !== 'string' || hint.trim() === '') continue
    // POSIX 的 C／POSIX 地區代表「沒設定」，往下一個看。
    if (/^(C|POSIX)(\.|$)/i.test(hint.trim())) continue

    return isChinese(hint) ? 'zh-TW' : 'en'
  }

  return 'en'
}

/** 執行環境回報的地區（例如 `zh-TW`）；環境不提供 Intl 時為 undefined。 */
export const runtimeLocale = (): string | undefined => {
  try {
    const intl = (globalThis as { Intl?: typeof Intl }).Intl

    return intl?.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}
