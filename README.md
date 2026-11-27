# prompt-jump

[繁體中文說明](README.zh-TW.md)

**Jump back to any prompt you sent in a long Claude Code session, instead of scrolling up and up.**

Under the prompt box (in the status line, below claude-hud), one tick per prompt shows the whole conversation at a glance. Point at a tick to preview that prompt and the start of its answer; press `k` / `j` on the button row above the prompt, or type `/jump 3`, `/prev`, `/next`, and the conversation scrolls back to it. Want clickable ticks? Set `tickRowPosition` to `above` (see Settings).

```text
❯ Check the phone layout one last time
● Update(src\layout\Footer.tsx)
  Ran 2 shell commands
● All three main pages look right on phones; only the footer text was small, now larger
10/12  k: ‹  j: ›  a: Answer  l: List
❯
  [Haiku 5.5] │ tiles-app git:(main)
  Context ░░░░░░░░░░ 0%
  10/12  ▄ ▅ ▄ ▅ ▄ ▄ ▅ ▃ ▄ ▅ ▄ ▄                              /jump /prev /next /ans
  3  Why am I logged out again after a refresh   The token expires and is never renewed: the…
```

Above the prompt: where you are (`10/12`) and four buttons. Under it, below your status line: one tick per prompt, then a preview row. A tick is taller when that turn did more work, red when a tool call failed, and cyan for where you are. The preview shows the prompt you point at (here #3), or where you are when you point at nothing.

**The ticks under the prompt are read-only.** Claude Code only lets plugins draw text there: you can point at a tick to preview it, but you cannot click it, and the keyboard cannot move onto it. To jump, use the buttons above the prompt (`k`, `j`, `a`, `l`) or the commands `/jump`, `/prev`, `/next`, `/ans`; `/jump` (or `/jump pane`) opens the list. If you would rather click ticks, set `tickRowPosition` to `above`: the whole tick row and its preview go back above the prompt, as in 0.3.1.

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

**Turn on the fullscreen layout** to make jumping work (why: [Known limitations](#known-limitations)). Pick one:

| How | Effect |
| --- | --- |
| `/tui fullscreen` | Switches now; Claude Code restarts and resumes the conversation |
| `"tui": "fullscreen"` in `settings.json` | Every later session starts fullscreen |
| `CLAUDE_CODE_NO_FLICKER=1 claude` | This launch only. Over SSH into Windows and inside `tmux -CC`, Claude Code falls back to the main screen on its own; there only this one works |

`/jump-help` shows the same list inside Claude Code.

The same repository has a second, optional plugin, [compact-edits](#compact-edits-optional), installed on its own.

## What it does

- **Tick row under the prompt** (or above it, with `tickRowPosition`). One tick per prompt you typed, in order, with a gap where you paused more than 15 minutes. Height is the work done in that turn (files edited, commands run, length of the answer), red marks a turn where a tool call failed, cyan marks where you are. Messages that are not yours (background task notices, slash commands) are left out; prompts already in the conversation when the plugin loads (for example after `--resume`) are there right away. When there are more ticks than room, the row shows the part around where you are and counts the rest (`‹24`, `23›`).
- **Preview.** Point at a tick, or move to it with the keyboard, and the second row shows that prompt and the start of its answer.
- **Jump back.** Use `k` / `j` (previous / next), `a` (start of the latest answer) or `/jump`, `/prev`, `/next`, `/ans`, and the conversation scrolls so that prompt is at the top. With `tickRowPosition` set to `above` you can also click a tick.
- **List.** `l` or `/jump` opens the full list: one row per prompt, the number, the prompt, and short marks on the right: `±2` files edited, `$4` commands run, `✗1` failed. The row where you are has a bar, a shaded background and bold text. Point at a row for a card with the prompt, the start of the answer and what the turn did. The card sits below the list, or, when the list is longer than the pane, at the far edge of the pane from the row you point at, so it never covers that row or the rows next to it and you can move down the list row by row. Times appear on the section lines between pauses (`── 10:05  20 min break ───`), not on every row.
- **Search prompts, answers and file names.** The filter box in the list and `/jump words` match the prompt, the start of that turn's answer, and the names of the files it edited, so `/jump tiles.tsx` finds the turn that changed that file. When a row matches on something you cannot see in it, a grey line says why: `file tiles.tsx`, `answer: …token expired…`, or the part of the prompt that was cut off.
- **Bookmarks.** `/mark name` remembers the spot at the top of the screen; `/jump @name` comes back to it.
- **English and Traditional Chinese**, following your settings.

Everything is counted from the conversation itself, with no model call (except the optional auto titles below).

## Commands

| Command | What it does |
| --- | --- |
| `/jump` | Open the list |
| `/jump 12` · `/jump -1` | Jump to #12 · to the last prompt |
| `/jump login page` · `/jump tiles.tsx` | Jump to the prompt whose text, answer or edited files match; with several matches, a picker appears above the prompt box, each entry saying why it matched |
| `/prev` · `/next` | Previous / next prompt (also `/jump prev`, `/jump next`) |
| `/ans` | The start of the latest answer |
| `/mark [name]` · `/jump @name` | Bookmark where you are · jump back to it |
| `/marks` · `/unmark name` | List bookmarks (with a picker) · delete one |
| `/jump-help` | Why jumping does not scroll on the main screen, and how to switch |

While you type `/jump words`, matching prompts appear as suggestions; Tab fills in the number.

To use the buttons from the keyboard, press `ctrl+x tab` to move onto the row above the prompt, then the letters press the buttons: `k` previous, `j` next, `a` answer, `l` list. `Esc` goes back to the prompt box. With `tickRowPosition` set to `above`, the arrows and Tab also walk the ticks (the preview follows) and Enter jumps.

## Settings

Set on the screen shown at install; change them later in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| `tickRowPosition` | **below** (new in 0.3.2) | `below`: ticks and preview sit in the status line under the prompt, below claude-hud, read-only (point to preview; no clicking); one row of buttons stays above the prompt. `above`: everything above the prompt, ticks clickable (the 0.3.1 layout). |
| `autoOpenPane` | **off** (was on before 0.3.0) | Open the list beside the chat when a session starts. Off: the tick row is always there; open the list with `l` or `/jump`. |
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

- **Scrolling back and the tick row work only in the fullscreen layout.** On Claude Code's main screen (often the default) the conversation lives in your terminal's own scrollback, which no plugin can scroll, and the plugin cannot switch the layout for you. There the list and the commands still work: `/jump 3` prints that prompt in full and says why it could not scroll. The first time this happens, the reply also explains how to turn on the fullscreen layout (once; `/jump-help` shows it again).
- **Ticks under the prompt cannot be clicked.** Claude Code does not let plugins put buttons in the status line. Use the buttons above the prompt, the commands, or `tickRowPosition: above`.
- **A tall claude-hud cuts the ticks off.** The status line has at most 5 rows, fewer on a short terminal or while a task list is showing, and claude-hud's own lines count. The preview row goes first, then the ticks. If that happens on your screen, shorten claude-hud's layout or use `tickRowPosition: above`.
- **Mouse on the main screen.** Claude Code does not pass the mouse to plugins there; use `ctrl+x tab` and the keyboard in the list.
- **No global keyboard shortcuts.** A plugin cannot add shortcuts of its own. Use the commands, or `ctrl+x tab` and then a letter.
- **The last few prompts** cannot reach the top of the screen when there is nothing below them; after a jump they show further down, and `k` there may not move.
- **Bookmarks** come back to the start of the reply block that was at the top, not to the exact line. Bookmarks last for the session.
- **Narrow terminals.** The tick row works at any width. The list docks beside the chat from about 110 columns; narrower, `l` or `/jump` opens it as a box above the prompt, where a pointed-at row shows its number and the start of its answer on one line, away from the rows next to it, instead of a card.
- **Times, pauses and previews.** Times and the 15-minute gaps are known only for prompts sent while the plugin was running. Search and previews use the first 300 characters of each answer.
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

`--plugin-dir` replaces an installed copy of the same plugin for that session only. What changed between versions is in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
