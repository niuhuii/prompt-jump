// 清單預覽卡片放哪裡的純邏輯：不碰 `$`，方便測試。
//
// 引擎的 hover 規則（claude-code 型別說明 BoxHoverProps.scope、BoxProps.position）：
// 卡片跟它那一列在同一個 hover 群組，群組裡任何一個（顯示出來的卡片也算）被指到，
// 整組就亮著；指標停在 absolute 的卡片上時算在卡片的父層，不算底下被蓋住的列。
// 所以卡片若畫在下一列上面，指標往下移就落在卡片上：卡片一直亮著，下一列永遠指不到。
// 卡片要放在指標從一列移到相鄰一列時不會經過的地方。

/** 算卡片位置要知道的事；列數都是清單內容的第幾列（0 起算）。 */
export type CardRoom = {
  /** 指到的那一列在第幾列。 */
  rowY: number
  /** 卡片幾列高。 */
  height: number
  /** 視窗最上面是第幾列。 */
  offset: number
  /** 視窗一次看得到幾列。 */
  windowRows: number
  /** 清單內容（不含卡片）一共幾列。 */
  contentRows: number
  /** 內容底下的空白也畫得出來：側邊窗格是；提示框上方的窗格框貼著內容，沒有空白。 */
  hasRoomBelow: boolean
}

/**
 * 卡片上緣在第幾列；放了會蓋到指到的那一列或相鄰的列時是 undefined（改用矮一點的卡片）。
 *
 * 清單底下的空白放得下：放在清單正下方，什麼都不蓋。放不下：放在視窗的另一半，
 * 指到上半部時貼著視窗底、指到下半部時貼著視窗頂。卡片不超過半個視窗減一列，
 * 指標一列一列往下（或往上）移時，換到另一半之前不會碰到卡片。
 */
export const cardTop = (room: CardRoom): number | undefined => {
  const { rowY, height, offset, windowRows, contentRows, hasRoomBelow } = room
  const bottom = offset + windowRows
  if (hasRoomBelow && contentRows >= offset && contentRows + height <= bottom) return contentRows
  const half = Math.floor(windowRows / 2)
  if (height > half - 1) return undefined
  return rowY - offset < half ? bottom - height : offset
}
