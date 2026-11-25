import type { Register } from 'claude-code'

import { FILE_EDIT_TOOLS, summarizeEdit } from './edit-summary'
import { STRINGS, resolveLang, runtimeLocale } from './i18n'
import type { Strings } from './i18n'

// 改檔對照平常縮成一行，Ctrl+O 看完整紀錄時才展開。
// 看不懂的輸出、出錯的、展開時，都交回 Claude Code 原本的畫法。
export const register: Register = (on, options) => {
  const setting = options.language
  // 指定了語言就馬上用；auto 先用英文，等 session.start 判斷。
  let s: Strings = STRINGS[resolveLang(setting, [])]

  on('session.start', async ($, e, next) => {
    if (setting !== 'zh-TW' && setting !== 'en') {
      // 讀不到（沒權限、環境不提供）就當沒設定，不讓語言判斷擋住啟動。
      const quiet = <T,>(p: Promise<T>) => p.catch(() => undefined)
      const fromSettings = await quiet($.settings.read({ key: 'language' }))
      s =
        STRINGS[
          resolveLang(setting, [
            typeof fromSettings === 'string' ? fromSettings : undefined,
            await quiet($.env.get('LC_ALL')),
            await quiet($.env.get('LC_MESSAGES')),
            runtimeLocale(),
            await quiet($.env.get('LANG')),
          ])
        ]
    }
    return next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool, output, isErrored, isExpanded } = e.props
    if (!FILE_EDIT_TOOLS.has(tool) || isErrored || isExpanded !== false) return next(e)
    const summary = summarizeEdit(output)
    if (!summary) return next(e)
    const { Text } = $.ui.resolve(e)

    return summary.kind === 'create' ? (
      <Text dimColor>{s.created(summary.name)}</Text>
    ) : (
      <Text dimColor>
        {s.edited} {summary.name} <Text color="green">+{summary.added}</Text>{' '}
        <Text color="red">−{summary.removed}</Text>
      </Text>
    )
  })
}
