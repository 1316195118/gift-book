import { describe, it, expect } from 'vitest'
import { computeStats } from '../stats-core.js'

describe('computeStats', () => {
  it('空列表', () => {
    const s = computeStats([])
    expect(s.totalAmount).toBe(0)
    expect(s.totalGivers).toBe(0)
    expect(s.uniqueGivers).toBe(0)
    expect(s.average).toBe(0)
    expect(s.topGivers).toEqual([])
  })

  it('汇总金额 / 类型 / 关系 / 回礼 / 去重与 Top', () => {
    const gifts = [
      { data: { name: '张三', amount: 100, type: '现金', relation: '朋友', returnRecords: [{ amount: 50 }] } },
      { data: { name: '张三', amount: 200, type: '微信', relation: '朋友' } },
      { data: { name: '李四', amount: 300, type: '现金' } },
    ]
    const s = computeStats(gifts)
    expect(s.totalAmount).toBe(600)
    expect(s.totalGivers).toBe(3)
    expect(s.byType['现金']).toBe(400)
    expect(s.byType['微信']).toBe(200)
    expect(s.byRelation['朋友']).toBe(300)
    expect(s.byRelation['未分类']).toBe(300)
    expect(s.totalReturned).toBe(50)
    expect(s.returnedCount).toBe(1)
    expect(s.uniqueGivers).toBe(2)
    expect(s.average).toBe(300)
    expect(s.topGivers[0]).toEqual(['张三', 300])
  })

  it('兼容旧版单次回礼', () => {
    const s = computeStats([{ data: { name: '王五', amount: 100, type: '现金', returned: true, returnAmount: 80 } }])
    expect(s.totalReturned).toBe(80)
    expect(s.returnedCount).toBe(1)
  })

  it('忽略无 data 的记录但计入总笔数', () => {
    const s = computeStats([{ data: null }, { data: { name: 'A', amount: 10, type: '现金' } }])
    expect(s.totalGivers).toBe(2)
    expect(s.totalAmount).toBe(10)
  })
})
