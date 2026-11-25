# prompt-jump

[English](README.md)

**在很長的 Claude Code 對話裡，直接跳回你之前問過的任何一則，不用一直往上捲。**

對話旁邊有一份「你問過什麼」的清單。點一下，或打 `/jump 3`、`/prev`、`/next`，對話就捲回那裡。

```text
 …                                                         │ 對話目錄                             ✕
❯ 在 math.js 加一個 subtract 函式                          │ 輸入關鍵字篩選，Enter 跳到最新符合…
● Update(math.js)                                          │ 共 8 則，目前在第 8 則
● 已在 add 旁邊加上 subtract(a, b)。                       │ [   1 10:00 修好 add 函式 …        ]
                                                           │       改 math.js
                                                           │ [   2 10:00 跑測試並回報           ]
                                                           │       1 指令 · 1 失敗
                                                           │ [   3 10:01 math.js 是做什麼的？   ]
                                                           │   …
                                                           │ [ ▶ 8 10:22 在 math.js 加一個 sub… ]
                                                           │       改 math.js
目錄 8/8 在 math.js 加一個 subtract 函式 k: 上一則 j: 下一則 a: 回答 l: 清單
❯
```

## 安裝

在 Claude Code 終端機的提示框輸入：

```
/plugin install prompt-jump --marketplace niuhuii/prompt-jump
```

問要不要加入 marketplace 時按 `y`，再按 Enter 裝給自己（所有對話都會有）。接著會出現設定畫面，用預設值就可以。

或在 shell 裡：

```
claude plugin install prompt-jump --marketplace niuhuii/prompt-jump
```

**要能跳回去，請用全螢幕版面**啟動（原因見[已知限制](#已知限制)）：

```
CLAUDE_CODE_NO_FLICKER=1 claude
```

同一個 repo 另有一個可選的外掛 [compact-edits](#compact-edits選用)，要另外裝。

## 功能

- **對話目錄。** 你打的每一則訊息都列在對話旁邊的窗格，有編號和送出時間。外掛載入前就在對話裡的訊息（例如 `--resume` 之後）一載入就列出來。不是你打的（背景工作通知、斜線指令）不列。
- **跳回去。** 點一列，或打編號、關鍵字，對話就捲到那一則在最上面。`▶` 標的是畫面最上方目前是哪一則。
- **這輪做了什麼。** 每列下面一行灰字，數那一則之後發生的事：`改 math.js · 2 指令 · 1 失敗`。直接從對話紀錄數，不呼叫模型。沒改檔也沒跑指令的那則不加這一行。
- **篩選。** 在窗格上方的輸入框打字縮小清單；Enter 跳到最新一則符合的。
- **提示框上方那一列。** 目前在第幾則（`目錄 3/8`），以及上一則、下一則、最後一個回答的開頭、清單四個按鈕。
- **書籤。** `/mark 名稱` 記下畫面最上方的位置；`/jump @名稱` 跳回來。
- **繁體中文與英文**，跟著你的設定。

## 指令

| 指令 | 做什麼 |
| --- | --- |
| `/jump` | 打開對話目錄 |
| `/jump 12` · `/jump -1` | 跳到第 12 則 · 最後一則 |
| `/jump 登入頁` | 跳到符合的那一則；符合好幾則時，提示框上方出現選單 |
| `/prev` · `/next` | 上一則／下一則（也可以 `/jump prev`、`/jump next`） |
| `/ans` | 最後一個回答的開頭 |
| `/mark [名稱]` · `/jump @名稱` | 把目前位置記成書籤 · 跳回去 |
| `/marks` · `/unmark 名稱` | 列出書籤（附選單）· 刪掉一個 |

打 `/jump 關鍵字` 的時候，符合的訊息會出現在自動完成裡；按 Tab 帶入編號。

用鍵盤操作提示框上方那一列：按 `ctrl+x tab` 移過去，再按字母：`k` 上一則、`j` 下一則、`a` 回答、`l` 清單（或在按鈕上按 Enter）。`Esc` 回到提示框。也可以直接點按鈕。

## 設定

安裝時的設定畫面就能設，之後在 `/config` 改。

| 設定 | 預設 | 做什麼 |
| --- | --- | --- |
| `autoOpenPane` | 開 | 每次開始對話就打開目錄。關掉則用 `/jump` 叫出。 |
| `language` | `auto` | `auto`、`zh-TW` 或 `en`。`auto` 依 Claude Code 的 `language` 設定、再依系統語言，都判斷不出時用英文。 |
| `titles` | **關** | 自動標題，見下面。 |
| `titleModel` | `haiku` | 自動標題用的模型。 |

### 自動標題（預設關）

打開 `titles` 後，每輪結束時外掛會請模型替那一則寫一行標題，目錄裡用標題取代原本的提問。

- **會送出什麼：** 你的提問與回答開頭（各約 300 字），以及那一輪改過的檔名，經由你自己的 Claude Code session 送出。
- **花費：** 每輪多一次模型呼叫，算進你的用量。目錄最下面會顯示估計用了多少 token。
- **不會送出**的情況：session 有資料規則（例如零資料保留）、非互動執行（`claude -p`）、被中斷的那一輪。
- 關著的時候什麼都不送，目錄顯示你原本打的字。

## 已知限制

- **只有全螢幕版面捲得回去。** Claude Code 預設的版面裡，對話在終端機自己的捲動區，任何外掛都捲不動。目錄、事實摘要和指令照樣能用：`/jump 3` 會印出那一則的全文，並說明為什麼捲不過去。要直接跳，請用 `CLAUDE_CODE_NO_FLICKER=1` 啟動 Claude Code；不然就用終端機自己的捲動和搜尋。
- **不能註冊全域快捷鍵。** 外掛沒辦法新增自己的快捷鍵。請用指令（`/prev`、`/next`、`/jump …`），或按 `ctrl+x tab` 移到提示框上方那一列再按字母。
- **最後幾則**下面沒有東西可以捲，跳過去時到不了畫面最上方，會出現在畫面下半。
- **書籤**跳回的是當時畫面最上方那個回答區塊的開頭，不是同一行。書籤只在這次 session 有效。
- **終端機很窄時**，啟動時打開的目錄要等終端機夠寬（約 110–144 欄）才出現；在那之前提示框上方那一列照樣在。`/jump` 在任何寬度都會把目錄開成提示框上方的一個框。
- **時間和停頓**只知道外掛在跑的時候送出的那幾則。兩則之間停超過 15 分鐘，目錄會分成新的一段。
- **事實摘要**只數主對話；子代理裡做的事不算。
- 在終端機以 Claude Code 2.1.332 開發與測試。桌面版 App 和 IDE 外掛沒有檢查過。

這是在解 Claude Code issue [#63901](https://github.com/anthropics/claude-code/issues/63901)（在目前對話跳到先前的使用者訊息），官方關成 not planned。

## compact-edits（選用）

同一個 repo 裡的另一個外掛。裝了之後，Edit／Write／MultiEdit 的結果縮成一行，例如 `改了 tiles.tsx +12 −3`；按 `ctrl+o`（完整紀錄）仍看得到完整對照。

```
/plugin install compact-edits --marketplace niuhuii/prompt-jump
```

唯一的設定是 `language`（`auto`、`zh-TW`、`en`）。

## 移除

```
/plugin uninstall prompt-jump
/plugin uninstall compact-edits
```

## 開發

```
claude plugin validate plugins/prompt-jump      # 檢查 manifest 與 hooks module
claude plugin test plugins/prompt-jump          # 跑 tests/ 裡的測試
claude --plugin-dir plugins/prompt-jump         # 在一個 session 裡試這份
```

`--plugin-dir` 只在那個 session 取代已安裝的同名外掛。

## 授權

[MIT](LICENSE)
