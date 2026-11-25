# Changelog

## prompt-jump 0.3.0

### Changed, affects existing users

- **`autoOpenPane` now defaults to off.** The list no longer opens beside the chat when a session starts; the tick row above the prompt replaces it as the always-there navigation. Press `l` on the tick row or type `/jump` to open the list. If you want the old behaviour, turn `autoOpenPane` on in `/config`. A value you set yourself is kept.

### New

- **Tick row above the prompt** (fullscreen layout): one tick per prompt, taller for turns that did more work, red where a tool call failed, cyan where you are, a gap after a pause of more than 15 minutes. With more prompts than room, the part around where you are is drawn and the rest is counted (`‹24`, `23›`).
- **Preview row:** point at a tick, or move to it with the keyboard after `ctrl+x tab`, to see that prompt and the start of its answer. Click a tick or press Enter on it to jump.
- **Search reaches answers and file names.** The list's filter box, `/jump words` and its suggestions also match the start of each turn's answer and the names of the files it edited (`/jump tiles.tsx`). When a match is not visible in the row, the reason is shown: `file tiles.tsx`, `answer: …`, or the cut-off part of the prompt. Several matches still open the picker as before.
- **`/jump-help`:** why jumping cannot scroll on the main-screen layout, and the three ways to turn on the fullscreen layout (`/tui fullscreen`, `"tui": "fullscreen"` in settings, `CLAUDE_CODE_NO_FLICKER=1`). The first time a command cannot scroll because of the main-screen layout, its reply includes this explanation once.

### Changed

- **The list is redrawn:** no `[ ]` around rows, one row per prompt, short marks on the right (`±` files edited, `$` commands, `✗` failures), a bar, background and bold text for where you are, and a card with the prompt, the start of the answer and what the turn did when you point at a row. Times moved from every row to the section lines between pauses.
- The row above the prompt is now two rows (tick row and preview); its buttons are `k: ‹  j: ›  a: Answer  l: List`.
- The list asks for a 44-column pane when opened; a width you dragged it to still wins.

## prompt-jump 0.2.0 and compact-edits 0.1.0

First public release.
