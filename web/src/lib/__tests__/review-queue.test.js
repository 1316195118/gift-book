import { beforeEach, describe, expect, it } from 'vitest'
import { buildReviewQueue, clearReviewed, filterReviewed, markReviewed } from '../review-queue.js'

const gift = (id, data) => ({ id, data: { kind: 'gift', type: '现金', ...data } })

describe('review queue', () => {
  beforeEach(() => localStorage.clear())

  it('marks same-name same-amount records and large amounts', () => {
    const queue = buildReviewQueue([
      gift('1', { name: '张三', amount: 6000, timestamp: '2026-01-01T00:00:00Z' }),
      gift('2', { name: '张三', amount: 6000, timestamp: '2026-01-02T00:00:00Z' }),
      gift('3', { name: '李四', amount: 100, timestamp: '2026-01-03T00:00:00Z' }),
    ])
    expect(queue).toHaveLength(2)
    expect(queue[0].issues.map((item) => item.code)).toContain('same_amount')
    expect(queue[0].issues.map((item) => item.code)).toContain('large_amount')
    expect(queue[0].issues.map((item) => item.code)).toContain('no_note')
  })

  it('detects low-confidence OCR even under the amount threshold', () => {
    const queue = buildReviewQueue([
      gift('1', {
        name: '王五',
        amount: 100,
        timestamp: '2026-01-01T00:00:00Z',
        source: 'paper-ocr',
        ocrConfidence: 0.61,
        ocrWarnings: ['姓名与金额距离较远'],
      }),
    ])
    expect(queue[0].issues.map((item) => item.code)).toEqual(['ocr_low'])
  })

  it('uses a non-plaintext signature that changes with record version', () => {
    const first = buildReviewQueue([gift('id-secret', { name: '张三', amount: 5000, timestamp: '2026-01-01T00:00:00Z' })])[0]
    const second = buildReviewQueue([{ ...gift('id-secret', { name: '张三', amount: 5000, timestamp: '2026-01-01T00:00:00Z' }), updatedAt: '2026-02-01T00:00:00Z' }])[0]
    expect(first.signature).not.toContain('张三')
    expect(first.signature).not.toBe(second.signature)
  })

  it('filters reviewed versions and ignores blanks', () => {
    const queue = buildReviewQueue([
      gift('1', { name: '张三', amount: 5000, timestamp: '2026-01-01T00:00:00Z' }),
      gift('2', { name: '', amount: 9999, kind: 'blank' }),
    ])
    expect(queue).toHaveLength(1)
    markReviewed('event-1', queue[0].signature)
    expect(filterReviewed(queue, 'event-1')).toEqual([])
    clearReviewed('event-1')
    expect(filterReviewed(queue, 'event-1')).toHaveLength(1)
  })
})
