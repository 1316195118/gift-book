import { describe, expect, it } from 'vitest'
import { state as st } from '../../store.js'
import { pageSizes, totalPagesFor, pageOfIndexFor, pageRangeFor, pageSizeAt } from '../page-size.js'

describe('按页段分页', () => {
  it('页段规则覆盖默认行数', () => {
    st.currentEvent = { perPage: 12, pageRules: [{ from: 1, to: 2, perPage: 12 }, { from: 3, to: 0, perPage: 8 }] }
    expect(pageSizeAt(1)).toBe(12)
    expect(pageSizeAt(3)).toBe(8)
    expect(pageSizes(30)).toEqual([12, 12, 8])
    expect(totalPagesFor(30)).toBe(3)
    expect(pageOfIndexFor(23, 30)).toBe(2)
    expect(pageOfIndexFor(24, 30)).toBe(3)
    expect(pageRangeFor(3, 30)).toEqual({ from: 25, to: 30 })
  })

  it('没有规则时按默认行数', () => {
    st.currentEvent = { perPage: 10 }
    expect(pageSizes(25)).toEqual([10, 10, 10])
    expect(totalPagesFor(25)).toBe(3)
  })
})
