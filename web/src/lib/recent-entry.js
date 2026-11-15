// 刚录入的那一笔：给录入卡片一条可点回礼簿的回执，同时在礼簿上把那一格标出来。
// 只影响展示，不参与数据与同步。
import { reactive } from 'vue'

export const recentEntry = reactive({
  index: -1, // 在 st.gifts 里的位置，-1 表示没有
  name: '',
  amount: 0,
  at: 0,
})

// 礼簿上的闪烁只在刚录入后短暂出现，避免翻页回来又闪一次。
const FLASH_MS = 6000
let flashTimer = 0

export function markRecentEntry({ index, name, amount }) {
  recentEntry.index = Number.isInteger(index) && index >= 0 ? index : -1
  recentEntry.name = name || ''
  recentEntry.amount = Number(amount) || 0
  recentEntry.at = Date.now()

  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    // 只收起闪烁，保留回执文字，直到下一次录入或切换账簿。
    recentEntry.index = -1
  }, FLASH_MS)
}

export function clearRecentEntry() {
  clearTimeout(flashTimer)
  recentEntry.index = -1
  recentEntry.name = ''
  recentEntry.amount = 0
  recentEntry.at = 0
}
