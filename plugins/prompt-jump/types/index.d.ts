export type PromptEntry = { id: string; text: string }

/** 書籤：名稱、跳回去的那一列（提問、回答區塊或工具列）的 id、所屬那一則的文字。 */
export type Mark = { name: string; id: string; text: string }

/** 提示框上方那一列要顯示的選單；null 是不顯示。 */
export type Picker = {
  title: string
  /** 選項：值是提問的列 id，或書籤名稱前加 `@`（值不能重複）。 */
  options: { value: string; label: string }[]
} | null

/** 一則「這輪做了什麼」：從對話紀錄數出來，不靠模型。 */
export type Facts = {
  /** 成功改過的檔（完整路徑，去重，最多 20 個）。 */
  files: string[]
  /** 跑了幾個 shell 指令（Bash／PowerShell）。 */
  commands: number
  /** 工具呼叫回報錯誤的次數。 */
  failures: number
  /** 這輪被使用者中斷。 */
  isAborted?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-jump': {
      prompts: Shaped<PromptEntry[]>
      /** 各則第一次被看到的時間（毫秒），以列 id 為 key；載入前就有的舊訊息沒有。 */
      times: Record<string, number>
      /** 目錄篩選框裡的字。 */
      query: string
      /** 對話畫面目前所在那一則的列 id；不知道時是空字串。 */
      current: string
      /** 窗格已開但終端機太窄沒放上去。 */
      isPaneWaiting: boolean
      marks: Shaped<Mark[]>
      picker: Picker
      /** 每一則的事實，以提問的列 id 為 key。 */
      facts: Shaped<Record<string, Facts>>
      /** 每一則最後一次有動靜的時間（毫秒）；分段用。載入前的舊訊息沒有。 */
      activity: Record<string, number>
      /** 模型正在回答（主對話這一輪還沒結束）。 */
      isBusy: boolean
      /** 自動標題（設定開啟時才有），以提問的列 id 為 key。 */
      titles: Record<string, string>
      /** 自動標題這個 session 一共用掉的 token（估計）。 */
      titleTokens: number
    }
  }
}
