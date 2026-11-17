import { describe, expect, it } from 'vitest'
import { state as st } from '../../store.js'
import { itemsPerPage, pageOfIndexFor, DEFAULT_PER_PAGE } from '../page-size.js'

describe('每页行数', () => {
  it('旧账簿默认 12 行', () => {
    st.currentEvent = { id: 'test' }
    expect(DEFAULT_PER_PAGE).toBe(12)
    expect(itemsPerPage()).toBe(12)
    expect(pageOfIndexFor(12, 20)).toBe(2)
  })

  it('账簿设置 8 行后翻页与定位同步变化', () => {
    st.currentEvent = { id: 'test', perPage: 8 }
    expect(itemsPerPage()).toBe(8)
    expect(pageOfIndexFor(7, 20)).toBe(1)
    expect(pageOfIndexFor(8, 20)).toBe(2)
    expect(pageOfIndexFor(16, 20)).toBe(3)
  })

  it('非法值回落 12', () => {
    st.currentEvent = { id: 'test', perPage: 99 }
    expect(itemsPerPage()).toBe(12)
  })
})
