import { describe, expect, it } from 'vitest'
import { parseAmountQuery, matchAmount, filterGifts, normalizeName } from '../search-filter.js'

describe('查找过滤', () => {
  it('金额查询支持精确与区间', () => {
    expect(parseAmountQuery('')).toEqual({ kind: 'any' })
    expect(parseAmountQuery('300')).toEqual({ kind: 'exact', value: 300 })
    expect(parseAmountQuery('100-500')).toEqual({ kind: 'range', min: 100, max: 500 })
    expect(parseAmountQuery('100~500')).toEqual({ kind: 'range', min: 100, max: 500 })
    expect(parseAmountQuery('500-100').kind).toBe('invalid')
    expect(parseAmountQuery('abc').kind).toBe('invalid')
  })

  it('区间边界包含在内', () => {
    const q = parseAmountQuery('100-500')
    expect(matchAmount(100, q)).toBe(true)
    expect(matchAmount(500, q)).toBe(true)
    expect(matchAmount(99, q)).toBe(false)
    expect(matchAmount(501, q)).toBe(false)
  })

  it('姓名忽略空白，关系与金额区间可叠加', () => {
    const gifts = [
      { data: { name: '张 三', amount: 200, relation: '亲戚' } },
      { data: { name: '张三', amount: 600, relation: '亲戚' } },
      { data: { name: '张三', amount: 300, relation: '朋友' } },
    ]
    const got = filterGifts(gifts, '张三', parseAmountQuery('100-500'), { relation: '亲戚' })
    expect(got).toHaveLength(1)
    expect(got[0].data.amount).toBe(200)
    expect(normalizeName('张 三')).toBe('张三')
  })

  it('未回礼筛选调用注入的判断函数', () => {
    const gifts = [
      { data: { name: '甲', amount: 100, returned: true } },
      { data: { name: '乙', amount: 100, returned: false } },
    ]
    const got = filterGifts(gifts, '', parseAmountQuery(''), {
      unreturned: true,
      hasReturned: (data) => data.returned,
    })
    expect(got.map((g) => g.data.name)).toEqual(['乙'])
  })
})
