// 提示框上方刻度列的排法：每則一根刻度，停超過 15 分鐘的地方空一格；
// 放不下時只畫目前位置附近一段，左右標還有幾則。不碰 $，方便測試。

export type TickPlan = {
  /** 畫出來的範圍 [from, to)。 */
  from: number
  to: number
  /** 每根刻度佔幾欄（放得下時 2，刻度之間空一格；否則 1）。 */
  per: 1 | 2
  /** 每根刻度的位置：第幾則、離刻度區左緣第幾欄。 */
  items: { index: number; col: number }[]
  /** 左邊還有幾則沒畫（0 是沒有）；標記「‹N」畫在刻度區最左邊。 */
  before: number
  /** 右邊還有幾則沒畫。 */
  after: number
  /** 刻度區實際用掉的欄數（含左右標記）。 */
  width: number
}

const labelCols = (n: number) => (n > 0 ? String(n).length + 2 : 0)

/**
 * count：一共幾則；current：目前那一則（0 起算，不知道時 -1，視為最後一則）；
 * avail：刻度區可用的欄數；isGap(i)：第 i 則跟前一則之間要不要空一格。
 */
export const planTicks = (
  count: number,
  current: number,
  avail: number,
  isGap: (index: number) => boolean,
): TickPlan => {
  const empty: TickPlan = { from: 0, to: 0, per: 1, items: [], before: 0, after: 0, width: 0 }
  if (count === 0 || avail <= 0) return empty
  const gapsIn = (from: number, to: number) => {
    let n = 0
    for (let i = from + 1; i < to; i++) if (isGap(i)) n++
    return n
  }
  const all = count + gapsIn(0, count)
  const per: 1 | 2 = all * 2 - 1 <= avail ? 2 : 1
  const at = current < 0 || current >= count ? count - 1 : current

  let from = 0
  let to = count
  const cost = (f: number, t: number) =>
    (t - f + gapsIn(f, t)) * per - (per === 2 ? 1 : 0) + labelCols(f) + labelCols(count - t)
  if (cost(0, count) > avail) {
    // 從目前那一則往兩邊長，左邊留大約四成、右邊六成，長到放不下為止。
    from = at
    to = at + 1
    let isGrowing = true
    while (isGrowing) {
      isGrowing = false
      const left = at - from
      const right = to - at - 1
      const preferLeft = left < (right + 1) * 0.67
      const tries = preferLeft ? ['left', 'right'] : ['right', 'left']
      for (const side of tries) {
        if (side === 'left' && from > 0 && cost(from - 1, to) <= avail) {
          from--
          isGrowing = true
          break
        }
        if (side === 'right' && to < count && cost(from, to + 1) <= avail) {
          to++
          isGrowing = true
          break
        }
      }
    }
  }

  const items: { index: number; col: number }[] = []
  let col = labelCols(from)
  for (let i = from; i < to; i++) {
    if (i > from && isGap(i)) col += per
    items.push({ index: i, col })
    col += per
  }
  return {
    from,
    to,
    per,
    items,
    before: from,
    after: count - to,
    width: Math.min(avail, cost(from, to)),
  }
}
