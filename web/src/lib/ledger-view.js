// 记账页主界面：录入、礼簿渲染、汇总、工具栏。
import { reactive } from 'vue'
import { state as st } from '../store.js'
import { copyOf } from './content.js'
import { amountToChinese, formatCurrency, escapeHtml } from './crypto.js'
import { hasReturned } from './return-gift.js'
import {
  submitGift, openGiftDetails, runSearch, flushQueue, showQueueModal,
  openStats, openExport, openPrint, openSettings, openOcr, toggleLedgerLock,
  showQrDialog,
} from './ledger-actions.js'

const ITEMS_PER_PAGE = 12
const PAYMENT_TYPES = ['现金', '支付宝', '微信', '其他']
// 关系分组用于「哪类人送了多少」，空值统一按「未分类」处理，兼容旧记录。
export { RELATION_OPTIONS, RELATION_FALLBACK } from './content.js'

// 录入表单状态放在模块级 reactive 里，切换页面后仍保留半填内容。
export const entry = reactive({ name: '', amount: '', type: '现金', remarks: '', relation: '' })

export function resetEntry() {
  entry.name = ''
  entry.amount = ''
  entry.type = '现金'
  entry.remarks = ''
  entry.relation = ''
}

export const PAYMENT_OPTIONS = PAYMENT_TYPES
export { ITEMS_PER_PAGE }

export function pageItems(gifts = st.gifts, page = st.currentPage) {
  return gifts.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
}

export function totalPages(gifts = st.gifts) {
  return Math.ceil(gifts.length / ITEMS_PER_PAGE) || 1
}

// computeStats 统一由 stats-core.js 提供（主界面与统计弹窗共用同一口径）。

export function amountPreview(value) {
  const amount = Number(value)
  return !Number.isFinite(amount) || amount <= 0 ? '输入金额后显示大写' : `大写：${amountToChinese(amount)}`
}

export function isLateGift(gift) {
  const data = gift?.data
  if (!data) return false
  if (data.late === true) return true
  if (data.late === false) return false
  const ev = st.currentEvent
  const at = data.timestamp ? new Date(data.timestamp).getTime() : NaN
  if (!ev || !Number.isFinite(at)) return false
  const start = ev.startDateTime ? new Date(ev.startDateTime).getTime() : NaN
  const end = ev.endDateTime ? new Date(ev.endDateTime).getTime() : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  return at < start || at > end
}

function nameCell(gift, index) {
  if (!gift?.data) return `<div class="book-cell name-cell" data-gift-index="${index}"></div>`
  const data = gift.data
  const modified = Array.isArray(data.history) && data.history.length > 0
  const chars = Array.from(String(data.name ?? ''))
  const shown = chars.slice(0, 24)
  const len = shown.length > 3 ? 'long' : String(shown.length)
  const nameHtml = shown.map((ch) => `<span>${escapeHtml(ch)}</span>`).join('') + (chars.length > shown.length ? '<span>…</span>' : '')
  // 格子只放一条标记，按优先级取：已回礼 > 已备注 > 已修改 > 待同步。
  const markCandidates = [
    hasReturned(data) ? '<p class="mark-returned">*已回礼</p>' : '',
    data.remarks ? '<p>*已备注</p>' : '',
    modified ? '<p>*已修改</p>' : '',
    gift.pending ? '<p class="mark-pending">*待同步</p>' : '',
  ].filter(Boolean)
  const marks = `<div class="mark">${markCandidates[0] || ''}</div>`
  const late = isLateGift(gift) ? '<div class="late-mark">*补录</div>' : ''
  const tip = modified
    ? `${data.name} · 已修改 ${data.history.length} 次，最后一次 ${new Date(data.updatedAt || data.timestamp).toLocaleString('zh-CN')}`
    : `${data.name} · 录入于 ${new Date(data.timestamp).toLocaleString('zh-CN')}`
  return `<div class="book-cell name-cell" data-gift-index="${index}" title="${escapeHtml(tip)}">${late}<div class="name${String(data.name).length > 4 ? ' scale' : ''}" data-len="${len}" style="--name-chars:${shown.length + (chars.length > shown.length ? 1 : 0)}">${nameHtml}</div>${marks}</div>`
}

function amountCell(gift, index) {
  if (!gift?.data) return `<div class="book-cell amount-cell" data-gift-index="${index}"></div>`
  const chinese = amountToChinese(gift.data.amount)
  const cnClass = chinese.length > 18 ? ' scale tiny' : chinese.length > 8 ? ' scale' : ''
  return `<div class="book-cell amount-cell" data-gift-index="${index}"><div class="amount-chinese${cnClass}" style="--amount-chars:${chinese.length}">${chinese}</div><div class="amount-numeric${Math.abs(gift.data.amount).toString().length > 6 ? ' scale' : ''}">${formatCurrency(gift.data.amount)}</div></div>`
}

export function bookMarkup() {
  const copy = copyOf(st.currentEvent, st.homeCategory)
  const items = pageItems()
  const rows = { name: [], type: [], amount: [] }
  for (let i = 0; i < ITEMS_PER_PAGE; i += 1) {
    const gift = items[i]
    const index = (st.currentPage - 1) * ITEMS_PER_PAGE + i
    rows.name.push(nameCell(gift, index))
    rows.type.push(`<div class="book-cell type-cell">${escapeHtml(copy.bookType)}</div>`)
    rows.amount.push(amountCell(gift, index))
  }
  return `<div class="gift-book-row">${rows.name.join('')}</div><div class="gift-book-row flex-1">${rows.type.join('')}</div><div class="gift-book-row">${rows.amount.join('')}</div>`
}

export { computeStats } from './stats-core.js'

export {
  submitGift, openGiftDetails, runSearch, flushQueue, showQueueModal,
  openStats, openExport, openPrint, openSettings, openOcr, toggleLedgerLock,
  showQrDialog,
}
