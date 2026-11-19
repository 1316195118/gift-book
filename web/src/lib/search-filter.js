// 礼簿查找的纯过滤逻辑：抽出来便于单测，UI 层只负责收集条件。
import { RELATION_OPTIONS } from './content.js'

export const normalizeName = (value) => String(value || '').replace(/[\s　​-‍﻿]/g, '')

// 金额输入支持三种写法：空=不限、单个数字=精确、区间「100-500」或「100~500」。
export function parseAmountQuery(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { kind: 'any' }
  const parts = raw.split(/[-~～至]/).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 2) {
    const min = Number(parts[0])
    const max = Number(parts[1])
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0 || min > max) {
      return { kind: 'invalid' }
    }
    return { kind: 'range', min, max }
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return { kind: 'invalid' }
  return { kind: 'exact', value }
}

export function matchAmount(amount, query) {
  const value = Number(amount) || 0
  switch (query.kind) {
    case 'exact': return Math.abs(value - query.value) < 0.005
    case 'range': return value >= query.min - 0.005 && value <= query.max + 0.005
    default: return true
  }
}

// options: { unreturned, relation, type, hasReturned }
export function filterGifts(gifts, nameTerm, amountQuery, options = {}) {
  const term = normalizeName(nameTerm)
  return gifts
    .map((gift, index) => ({ gift, index }))
    .filter(({ gift }) => {
      const data = gift?.data
      if (!data) return false
      const names = [data.name, data.giverName, gift.giverName, gift.name].filter(Boolean).map(normalizeName)
      if (term && !names.some((name) => name.includes(term))) return false
      if (!matchAmount(data.amount, amountQuery)) return false
      if (options.relation && data.relation !== options.relation) return false
      if (options.type && data.type !== options.type) return false
      if (options.unreturned && options.hasReturned?.(data)) return false
      return true
    })
    .map(({ gift, index }) => ({ ...gift, originalIndex: index }))
}

export { RELATION_OPTIONS }
