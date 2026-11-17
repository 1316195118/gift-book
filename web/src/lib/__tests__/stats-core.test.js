import { describe, it, expect } from 'vitest'
import { computeStats, toCents } from '../stats-core.js'

describe('computeStats', () => {
  it('空列表', () => {
    const s = computeStats([])
    expect(s.totalAmount).toBe(0)
    expect(s.recordCount).toBe(0)
    expect(s.totalGivers).toBe(0)
    expect(s.uniqueGivers).toBe(0)
    expect(s.average).toBe(0)
    expect(s.topGivers).toEqual([])
  })

  it('跳过占位行不计入人数、金额与笔数', () => {
    const gifts = [
      { data: { name: '张三', amount: 100, type: '现金' } },
      { data: { name: '', amount: 0, type: '现金', kind: 'blank', skippedAt: '2026-11-17T00:00:00Z' } },
      { data: { name: '李四', amount: 0, type: '微信' } },
    ]
    const s = computeStats(gifts)
    expect(s.recordCount).toBe(2)
    expect(s.totalAmount).toBe(100)
    expect(s.totalGivers).toBe(2)
    expect(s.byType['现金']).toBe(100)
    expect(s.byType['微信']).toBe(0)
  })

  it('金额 / 类型 / 关系 / 回礼 / 人数与 Top', () => {
    const gifts = [
      { data: { name: '张三', amount: 100, type: '现金', relation: '朋友', returnRecords: [{ amount: 50 }] } },
      { data: { name: '张三', amount: 200, type: '微信', relation: '朋友' } },
      { data: { name: '李四', amount: 300, type: '现金' } },
    ]
    const s = computeStats(gifts)
    expect(s.totalAmount).toBe(600)
    expect(s.recordCount).toBe(3)
    // 「人数」按姓名去重：张三两笔只算 1 人，与导出/打印的「共 N 位」一致。
    expect(s.totalGivers).toBe(2)
    expect(s.uniqueGivers).toBe(2)
    expect(s.byType['现金']).toBe(400)
    expect(s.byType['微信']).toBe(200)
    expect(s.byRelation['朋友']).toBe(300)
    expect(s.byRelation['未分类']).toBe(300)
    expect(s.totalReturned).toBe(50)
    expect(s.returnedCount).toBe(1)
    expect(s.average).toBe(300)
    expect(s.topGivers[0]).toEqual(['张三', 300])
  })

  it('金额按分累加，避免浮点误差', () => {
    const s = computeStats([
      { data: { name: 'A', amount: 0.1, type: '现金' } },
      { data: { name: 'B', amount: 0.2, type: '现金' } },
    ])
    expect(s.totalAmount).toBe(0.3)
    expect(s.byType['现金']).toBe(0.3)
  })

  it('非法金额按 0 处理，不影响其余记录', () => {
    const s = computeStats([
      { data: { name: 'A', amount: 'abc', type: '现金' } },
      { data: { name: 'B', amount: null, type: '现金' } },
      { data: { name: 'C', amount: 10, type: '现金' } },
    ])
    expect(s.totalAmount).toBe(10)
    expect(s.recordCount).toBe(3)
  })

  it('按类型与关系分组合计都等于总额', () => {
    const gifts = [
      { data: { name: 'A', amount: 12.34, type: '现金', relation: '亲戚' } },
      { data: { name: 'B', amount: 0.66, type: '微信', relation: '同事' } },
      { data: { name: 'C', amount: 1000, type: '支付宝', relation: '亲戚' } },
    ]
    const s = computeStats(gifts)
    const sumType = Object.values(s.byType).reduce((a, b) => a + b, 0)
    const sumRelation = Object.values(s.byRelation).reduce((a, b) => a + b, 0)
    expect(sumType).toBeCloseTo(s.totalAmount, 2)
    expect(sumRelation).toBeCloseTo(s.totalAmount, 2)
  })

  it('兼容旧版单次回礼', () => {
    const s = computeStats([{ data: { name: '王五', amount: 100, type: '现金', returned: true, returnAmount: 80 } }])
    expect(s.totalReturned).toBe(80)
    expect(s.returnedCount).toBe(1)
  })

  it('忽略无 data 的记录', () => {
    const s = computeStats([{ data: null }, { data: { name: 'A', amount: 10, type: '现金' } }])
    expect(s.recordCount).toBe(1)
    expect(s.totalGivers).toBe(1)
    expect(s.totalAmount).toBe(10)
  })

  it('toCents 四舍五入到分', () => {
    expect(toCents('1.23')).toBe(123)
    expect(toCents(0.1)).toBe(10)
    expect(toCents(undefined)).toBe(0)
    expect(toCents(NaN)).toBe(0)
    // IEEE 754 下 1.005 实际是 1.00499…，按分取整为 100；输入框已限制两位小数。
    expect(toCents(1.005)).toBe(100)
  })
})
