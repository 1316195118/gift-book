// 异常核对队列：完全从浏览器已解密的礼金推导，不向服务端发送姓名或检索词。
// “已核对”按记录版本保存在本机；金额、备注或 OCR 信息再次变化时会重新出现。
import { toCents } from './stats-core.js'

export const REVIEW_TYPES = {
  same_amount: { label: '同名同额', severity: 'high' },
  same_name: { label: '同名多笔', severity: 'medium' },
  large_amount: { label: '大额礼金', severity: 'medium' },
  non_round_amount: { label: '非整十金额', severity: 'low' },
  small_amount: { label: '金额偏小', severity: 'low' },
  ocr_low: { label: 'OCR 低置信度', severity: 'high' },
  no_note: { label: '同名未备注', severity: 'low' },
}

const SMALL_AMOUNT_CENTS = 1000

const reviewKey = (eventId) => `gb-review-done:${String(eventId || 'default')}`
const issueId = (item) => item.issues.map((issue) => issue.code).sort().join(',')
const identityKey = (data) => `${String(data?.name || '').trim()}\u0000${String(data?.remarks || '').trim()}`

export function reviewSignature(gift, issues = []) {
  const data = gift?.data || {}
  const version = [
    gift?.id,
    gift?.updatedAt || gift?.createdAt || '',
    data.updatedAt || '',
    Array.isArray(data.history) ? data.history.length : 0,
    data.ocrConfidence ?? '',
    Array.isArray(data.ocrWarnings) ? data.ocrWarnings.join('|') : '',
    issueId({ issues }).replace('same_amount,same_name', 'same_name,same_amount'),
  ].join('::')
  // 32 位 FNV-1a 只用于本机版本比对，不保存姓名或金额明文。
  let hash = 0x811c9dc5
  for (let index = 0; index < version.length; index += 1) {
    hash ^= version.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function buildReviewQueue(gifts = [], options = {}) {
  const largeAmount = Math.max(1, Number(options.largeAmount) || 5000)
  const rows = gifts
    .map((gift, giftIndex) => ({ gift, giftIndex, data: gift?.data }))
    .filter(({ data }) => data && data.kind !== 'blank' && String(data.name || '').trim())
  const byIdentity = new Map()
  rows.forEach((row) => {
    const key = identityKey(row.data)
    const list = byIdentity.get(key) || []
    list.push(row)
    byIdentity.set(key, list)
  })

  const items = rows.map(({ gift, giftIndex, data }) => {
    const issues = []
    const sameIdentity = byIdentity.get(identityKey(data)) || []
    const sameAmount = sameIdentity.filter((row) => toCents(row.data.amount) === toCents(data.amount))
    const amounts = new Set(sameIdentity.map((row) => toCents(row.data.amount)))
    if (sameAmount.length > 1) issues.push({ code: 'same_amount', ...REVIEW_TYPES.same_amount })
    else if (sameIdentity.length > 1 && amounts.size > 1) issues.push({ code: 'same_name', ...REVIEW_TYPES.same_name })
    const amountCents = toCents(data.amount)
    if (amountCents >= toCents(largeAmount)) issues.push({ code: 'large_amount', ...REVIEW_TYPES.large_amount })
    if (amountCents <= SMALL_AMOUNT_CENTS) issues.push({ code: 'small_amount', ...REVIEW_TYPES.small_amount })
    else if (amountCents % 1000 !== 0) issues.push({ code: 'non_round_amount', ...REVIEW_TYPES.non_round_amount })
    if (
      (data.source === 'paper-ocr' && Number(data.ocrConfidence) < 0.85)
      || (Array.isArray(data.ocrWarnings) && data.ocrWarnings.length > 0)
    ) {
      issues.push({ code: 'ocr_low', ...REVIEW_TYPES.ocr_low })
    }
    if (sameIdentity.length > 1 && !String(data.remarks || '').trim()) issues.push({ code: 'no_note', ...REVIEW_TYPES.no_note })
    return {
      giftIndex,
      id: gift.id,
      signature: '',
      name: String(data.name).trim(),
      amount: Number(data.amount) || 0,
      timestamp: data.timestamp || '',
      issues,
    }
  }).filter((item) => item.issues.length)
    .map((item) => ({ ...item, signature: reviewSignature(gifts[item.giftIndex], item.issues) }))

  return items
}

export function loadReviewed(eventId) {
  try {
    const value = JSON.parse(localStorage.getItem(reviewKey(eventId)) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function saveReviewed(eventId, signatures) {
  const limit = 1200
  const saved = { ...loadReviewed(eventId) }
  signatures.forEach((signature) => {
    if (signature) saved[signature] = Date.now()
  })
  const entries = Object.entries(saved).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, limit)
  try {
    localStorage.setItem(reviewKey(eventId), JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* 隐私模式或存储已满：本次仍可从界面移除，刷新后恢复提示 */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gb-review-change'))
}

export function clearReviewed(eventId) {
  try {
    localStorage.removeItem(reviewKey(eventId))
  } catch {
    /* 隐私模式下没有持久化数据可清理 */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gb-review-change'))
}

export function markReviewed(eventId, signatures) {
  saveReviewed(eventId, Array.isArray(signatures) ? signatures : [signatures])
}

export function filterReviewed(queue, eventId) {
  const reviewed = loadReviewed(eventId)
  return queue.filter((item) => !reviewed[item.signature])
}
