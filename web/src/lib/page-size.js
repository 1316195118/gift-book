// 分页规则：每页行数可以全局设置，也可以按「第 X–Y 页」单独指定。
// 这样中途改行数时，前面已经排好的页不会整体重排，纸簿顺序保持稳定。
import { state as st } from '../store.js'

export const DEFAULT_PER_PAGE = 12
export const ALLOWED_PER_PAGE = [8, 10, 12]

function validSize(value) {
  const size = Number(value)
  return ALLOWED_PER_PAGE.includes(size) ? size : null
}

export function defaultPerPage() {
  return validSize(st.currentEvent?.perPage) || DEFAULT_PER_PAGE
}

// 兼容旧调用：拿默认行数（未覆盖的页使用）。
export function itemsPerPage() {
  return defaultPerPage()
}

export function pageRules() {
  const raw = st.currentEvent?.pageRules
  if (!Array.isArray(raw)) return []
  const rules = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const from = Number(item.from)
    const to = Number(item.to)
    const size = validSize(item.perPage)
    if (!Number.isInteger(from) || from < 1) continue
    if (!Number.isInteger(to) || (to !== 0 && to < from)) continue
    if (!size) continue
    rules.push({ from, to, perPage: size })
  }
  return rules.sort((a, b) => a.from - b.from)
}

// 某一页用多少行：命中区间就用区间，否则用默认值。
export function pageSizeAt(page) {
  const target = Number(page) || 1
  const hit = pageRules().find((rule) => target >= rule.from && (rule.to === 0 || target <= rule.to))
  return hit ? hit.perPage : defaultPerPage()
}

// 按当前规则把总数切成每页行数序列。
export function pageSizes(total) {
  const count = Math.max(0, Number(total) || 0)
  if (!count) return []
  const sizes = []
  // 一次性读规则和默认行数，避免大数据量时每页重新构造/排序规则数组。
  const rules = pageRules()
  const fallback = defaultPerPage()
  const sizeAt = (page) => {
    const hit = rules.find((rule) => page >= rule.from && (rule.to === 0 || page <= rule.to))
    return hit ? hit.perPage : fallback
  }
  let covered = 0
  let page = 1
  while (covered < count && page <= 9999) {
    const size = sizeAt(page)
    sizes.push(size)
    covered += size
    page += 1
  }
  return sizes
}

export function totalPagesFor(total) {
  return pageSizes(total).length || 1
}

export function pageOffsetFor(page, total) {
  const sizes = pageSizes(total)
  let offset = 0
  for (let i = 0; i < Math.min(page - 1, sizes.length); i += 1) offset += sizes[i]
  return offset
}

export function pageRangeFor(page, total) {
  const count = Math.max(0, Number(total) || 0)
  if (!count) return null
  const offset = pageOffsetFor(page, count)
  const size = pageSizeAt(page)
  const from = offset + 1
  const to = Math.min(offset + size, count)
  return from <= to ? { from, to } : null
}

export function pageOfIndexFor(index, total) {
  const count = Math.max(0, Number(total) || 0)
  let target = Number(index)
  if (!Number.isFinite(target) || target < 0) target = 0
  const sizes = pageSizes(count)
  let covered = 0
  for (let i = 0; i < sizes.length; i += 1) {
    covered += sizes[i]
    if (target < covered) return i + 1
  }
  return Math.max(1, sizes.length)
}

// 旧名字保留，内部按当前账簿规则计算。
export function pageOfIndex(index) {
  return pageOfIndexFor(index, st.gifts?.length || 0)
}
