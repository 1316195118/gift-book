// 每页行数是账簿级设置：8 / 10 / 12，旧账簿一律按 12 处理。
// 单独成模块，避免 ledger-view 与 ledger-actions 互相引用造成循环依赖。
import { state as st } from '../store.js'

export const DEFAULT_PER_PAGE = 12
export const ALLOWED_PER_PAGE = [8, 10, 12]

export function itemsPerPage() {
  const value = Number(st.currentEvent?.perPage)
  return ALLOWED_PER_PAGE.includes(value) ? value : DEFAULT_PER_PAGE
}

export function pageOfIndex(index) {
  return Math.floor(Number(index) / itemsPerPage()) + 1
}
