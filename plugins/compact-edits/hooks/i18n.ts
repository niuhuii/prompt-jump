// 介面文字（繁體中文／英文）與語言判斷；跟 prompt-jump 的判斷方式一樣。
// 不碰 $：判斷所需的值由 register.tsx 讀好再傳進來，這樣測試能直接呼叫。

export type Lang = 'zh-TW' | 'en'

export type Strings = { created: (name: string) => string; edited: string }

export const STRINGS: Record<Lang, Strings> = {
  'zh-TW': { created: name => `新增 ${name}`, edited: '改了' },
  en: { created: name => `Created ${name}`, edited: 'Edited' },
}

const CHINESE = /^zh\b|^zh[-_]|chinese|中文|繁|簡|简|台灣|臺灣|香港/i

/** 一個語言標記或名稱是否指中文。 */
export const isChinese = (value: string): boolean => CHINESE.test(value.trim())

/** 設定不是 auto 就照設定；auto 時取第一個有值的提示，都沒有就用英文。 */
export const resolveLang = (setting: unknown, hints: ReadonlyArray<string | undefined>): Lang => {
  if (setting === 'zh-TW' || setting === 'en') return setting
  for (const hint of hints) {
    if (typeof hint !== 'string' || hint.trim() === '') continue
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
