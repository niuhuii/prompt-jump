# prompt-jump

[繁體中文說明](README.zh-TW.md)

**Jump back to any prompt you sent in a long Claude Code session, instead of scrolling up and up.**

A list of your prompts sits beside the chat. Click one, or type `/jump 3`, `/prev`, `/next`, and the conversation scrolls back to it.

```text
 …                                                         │ Prompts                              ✕
❯ Add a subtract function to math.js                       │ Type to filter; Enter jumps to the …
● Update(math.js)                                          │ 8 prompts, at #8
● Added subtract(a, b) next to add.                        │ [   1 10:00 Fix the add function … ]
                                                           │       edited math.js
                                                           │ [   2 10:00 Run the tests and report ]
                                                           │       1 command · 1 failed
                                                           │ [   3 10:01 What does math.js do?   ]
                                                           │   …
                                                           │ [ ▶ 8 10:22 Add a subtract function … ]
                                                           │       edited math.js
Prompt 8/8 Add a subtract function to … k: Prev j: Next a: Answer l: List
❯
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install prompt-jump --marketplace niuhuii/prompt-jump
```

Answer `y` to add the marketplace, then press Enter to install for your user (all your sessions). A settings screen follows; the defaults are fine.

From a shell instead:

```
claude plugin install prompt-jump --marketplace niuhuii/prompt-jump
```

**Turn on the fullscreen layout** to make jumping work (see [Known limitations](#known-limitations)):

```
CLAUDE_CODE_NO_FLICKER=1 claude
```

The same repository has a second, optional plugin, [compact-edits](#compact-edits-optional), installed on its own.

## What it does

- **Prompt list.** Every message you type is listed in a pane beside the chat, numbered, with the time you sent it. Prompts already in the conversation when the plugin loads (for example after `--resume`) are listed right away. Messages that are not yours (background task notices, slash commands) are left out.
- **Jump back.** Click a row, or type a number or words, and the conversation scrolls so that prompt is at the top. The `▶` marks the prompt at the top of the screen now.
- **What each turn did.** A grey line under a row counts what happened after that prompt: `edited math.js · 2 commands · 1 failed`. It is counted from the conversation itself, with no model call. Rows where nothing was edited or run have no extra line.
- **Filter.** Type in the box at the top of the pane to narrow the list; Enter jumps to the latest match.
- **Row above the prompt.** Where you are (`Prompt 3/8`) and buttons for previous, next, the start of the latest answer, and the list.
- **Bookmarks.** `/mark name` remembers the spot at the top of the screen; `/jump @name` comes back to it.
- **English and Traditional Chinese**, following your settings.

## Commands

| Command | What it does |
| --- | --- |
| `/jump` | Open the prompt list |
| `/jump 12` · `/jump -1` | Jump to #12 · to the last prompt |
| `/jump login page` | Jump to the prompt that matches; with several matches, a picker appears above the prompt box |
| `/prev` · `/next` | Previous / next prompt (also `/jump prev`, `/jump next`) |
| `/ans` | The start of the latest answer |
| `/mark [name]` · `/jump @name` | Bookmark where you are · jump back to it |
| `/marks` · `/unmark name` | List bookmarks (with a picker) · delete one |

While you type `/jump words`, matching prompts appear as suggestions; Tab fills in the number.

To use the row above the prompt from the keyboard, press `ctrl+x tab` to move into it, then a letter: `k` previous, `j` next, `a` answer, `l` list (or Enter on a button). `Esc` goes back to the prompt box. You can also click the buttons.

## Settings

Set on the screen shown at install; change them later in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| `autoOpenPane` | on | Open the list when a session starts. Off: open it with `/jump`. |
| `language` | `auto` | `auto`, `zh-TW` or `en`. `auto` follows Claude Code's `language` setting, then your system locale, and falls back to English. |
| `titles` | **off** | Auto titles; see below. |
| `titleModel` | `haiku` | The model used for auto titles. |

### Auto titles (off by default)

With `titles` on, after each turn the plugin asks a model for a one-line title for that prompt and shows it in the list in place of the prompt text.

- **What is sent:** your prompt and the start of the answer (about 300 characters each) and the names of files edited in that turn, through your own Claude Code session.
- **Cost:** one extra model call per turn, counted in your usage. The list shows an estimate of the tokens used.
- **Not sent** when the session has data rules (for example zero data retention), in non-interactive runs (`claude -p`), or for interrupted turns.
- With it off, nothing is sent and the list shows your prompts as typed.

## Known limitations

- **Scrolling back works only in the fullscreen layout.** In Claude Code's default layout the conversation lives in your terminal's own scrollback, which no plugin can scroll. The list, the counts and the commands still work there: `/jump 3` prints that prompt in full and says why it could not scroll. To jump, start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`; otherwise use your terminal's own scroll and search.
- **No global keyboard shortcuts.** A plugin cannot add shortcuts of its own. Use the commands (`/prev`, `/next`, `/jump …`), or `ctrl+x tab` and then a letter on the row above the prompt.
- **The last few prompts** cannot reach the top of the screen when there is nothing below them; after a jump they show further down.
- **Bookmarks** come back to the start of the reply block that was at the top, not to the exact line. Bookmarks last for the session.
- **Narrow terminals.** The list opened at start appears once the terminal is wide enough (about 110–144 columns); until then the row above the prompt is there. `/jump` opens the list as a box above the prompt at any width.
- **Times and pauses** are known only for prompts sent while the plugin was running. A pause of more than 15 minutes starts a new part in the list.
- **The counts** cover the main conversation; work done inside subagents is not counted.
- Built and tested in the terminal with Claude Code 2.1.332. The desktop app and IDE extensions have not been checked.

This works around Claude Code issue [#63901](https://github.com/anthropics/claude-code/issues/63901) (jump to earlier user messages in the current conversation), which was closed as not planned.

## compact-edits (optional)

A separate plugin in the same repository. Once installed, Edit / Write / MultiEdit results show as one line such as `Edited tiles.tsx +12 −3`; press `ctrl+o` (the full transcript view) to see the whole diff.

```
/plugin install compact-edits --marketplace niuhuii/prompt-jump
```

Its one setting is `language` (`auto`, `zh-TW`, `en`).

## Uninstall

```
/plugin uninstall prompt-jump
/plugin uninstall compact-edits
```

## Development

```
claude plugin validate plugins/prompt-jump      # manifest and hooks module
claude plugin test plugins/prompt-jump          # tests in tests/
claude --plugin-dir plugins/prompt-jump         # try this copy in one session
```

`--plugin-dir` replaces an installed copy of the same plugin for that session only.

## License

[MIT](LICENSE)
