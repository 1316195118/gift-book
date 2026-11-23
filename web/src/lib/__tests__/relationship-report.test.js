import { describe, expect, it } from 'vitest'
import { buildRelationshipReport, reportYears } from '../relationship-report.js'

describe('relationship report', () => {
  const gifts = [
    { data: { name: '张三', amount: 1000, type: '现金', relation: '朋友', timestamp: '2026-01-10T08:00:00+08:00', operator: '甲' } },
    { data: { name: '张三', amount: 200, type: '微信', relation: '朋友', timestamp: '2026-03-10T08:00:00+08:00', returnRecords: [{ amount: 500 }], operator: '乙' } },
    { data: { name: '李四', amount: 300, type: '现金', relation: '同事', timestamp: '2025-12-10T08:00:00+08:00' } },
    { data: { name: '', amount: 9999, kind: 'blank', timestamp: '2026-04-01T08:00:00+08:00' } },
  ]

  it('lists available years newest first', () => {
    expect(reportYears(gifts)).toEqual([2026, 2025])
  })

  it('aggregates year, person and relation totals', () => {
    const report = buildRelationshipReport(gifts, 2026)
    expect(report.totalAmount).toBe(1200)
    expect(report.recordCount).toBe(2)
    expect(report.peopleCount).toBe(1)
    expect(report.returnedAmount).toBe(500)
    expect(report.netAmount).toBe(700)
    expect(report.relations[0]).toMatchObject({ relation: '朋友', cents: 120000, count: 2, people: 1 })
    expect(report.topPeople[0]).toMatchObject({ name: '张三', cents: 120000, count: 2 })
    expect(report.monthly[0].amount).toBe(1000)
    expect(report.peakMonth.label).toBe('1月')
    expect(report.operators).toEqual(['甲', '乙'])
  })

  it('returns a zero report for an empty year', () => {
    const report = buildRelationshipReport(gifts, 2024)
    expect(report.recordCount).toBe(0)
    expect(report.totalAmount).toBe(0)
    expect(report.peakMonth).toBeNull()
  })
})
