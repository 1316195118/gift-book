import { describe, it, expect } from 'vitest'
import { registeredAtOf, compareGiftsByRegistration } from '../gift-order.js'

describe('gift-order 登记顺序', () => {
  it('按原始 timestamp 升序', () => {
    const a = { id: 'a', data: { timestamp: '2026-01-01T00:00:00Z' } }
    const b = { id: 'b', data: { timestamp: '2026-01-02T00:00:00Z' } }
    expect([b, a].sort(compareGiftsByRegistration)).toEqual([a, b])
  })

  it('修改过（timestamp 被改晚）的记录仍按首次快照的原始时间排在前', () => {
    const edited = {
      id: 'a',
      data: {
        timestamp: '2026-01-10T00:00:00Z',
        history: [{ snapshot: { timestamp: '2026-01-01T00:00:00Z' } }],
      },
    }
    const normal = { id: 'b', data: { timestamp: '2026-01-02T00:00:00Z' } }
    expect(registeredAtOf(edited)).toBe(Date.parse('2026-01-01T00:00:00Z'))
    expect([edited, normal].sort(compareGiftsByRegistration)).toEqual([edited, normal])
  })

  it('缺时间时按 id 稳定排序', () => {
    const a = { id: 'b', data: {} }
    const b = { id: 'a', data: {} }
    expect([a, b].sort(compareGiftsByRegistration)).toEqual([b, a])
  })

  it('有时间的排在缺时间的前面', () => {
    const withTime = { id: 'z', data: { timestamp: '2026-01-01T00:00:00Z' } }
    const noTime = { id: 'a', data: {} }
    expect([noTime, withTime].sort(compareGiftsByRegistration)).toEqual([withTime, noTime])
  })
})

import { sortGiftsByRegistration } from '../gift-order.js'

describe('sortGiftsByRegistration', () => {
  it('预计算排序结果与比较函数一致', () => {
    const a = { id: 'zzz', data: { name: '乙', timestamp: '2026-01-02T10:00:00Z' } }
    const b = { id: 'aaa', data: { name: '甲', timestamp: '2026-01-01T10:00:00Z' } }
    expect(sortGiftsByRegistration([a, b])).toEqual([b, a])
  })
  it('无时间戳时保持原顺序', () => {
    const a = { id: 'b', data: { name: '乙' } }
    const b = { id: 'a', data: { name: '甲' } }
    expect(sortGiftsByRegistration([a, b])).toEqual([a, b])
  })
})
