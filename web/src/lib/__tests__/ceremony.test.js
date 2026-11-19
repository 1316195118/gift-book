import { describe, expect, it } from 'vitest'
import { daysUntilText } from '../ceremony.js'

describe('距今天数', () => {
  const now = new Date(2026, 10, 19)

  it('优先用婚礼时间', () => {
    const ev = { ceremonyAt: '2026-11-22T12:00', endDate: '2026-11-25' }
    expect(daysUntilText(ev, now)).toBe('还有 3 天')
  })

  it('没有正期时用结束日期', () => {
    expect(daysUntilText({ endDate: '2026-11-25' }, now)).toBe('还有 6 天')
  })

  it('过去与当天', () => {
    expect(daysUntilText({ endDate: '2026-11-19' }, now)).toBe('今天')
    expect(daysUntilText({ ceremonyAt: '2026-11-10T08:00' }, now)).toBe('已过 9 天')
  })

  it('都没有时返回空', () => {
    expect(daysUntilText({}, now)).toBe('')
  })
})

describe('daysUntilText 兼容字段名', () => {
  const now = new Date(2026, 10, 19)

  it('endDateTime（新建账簿字段）也认', () => {
    expect(daysUntilText({ endDateTime: '2026-11-25T18:00' }, now)).toBe('还有 6 天')
  })
})
