import { describe, expect, it } from 'vitest'
import { state as st } from '../../store.js'
import { itemsPerPage, pageOfIndex, DEFAULT_PER_PAGE } from '../page-size.js'

describe('每页行数', () => {
  it('旧账簿默认 12 行', () => {
    st.currentEvent = { id: 'test' }
    expect(DEFAULT_PER_PAGE).toBe(12)
    expect(itemsPerPage()).toBe(12)
    expect(pageOfIndex(12)).toBe(2)
  })

  it('账簿设置 8 行后翻页与定位同步变化', () => {
    st.currentEvent = { id: 'test', perPage: 8 }
    expect(itemsPerPage()).toBe(8)
    expect(pageOfIndex(7)).toBe(1)
    expect(pageOfIndex(8)).toBe(2)
    expect(pageOfIndex(16)).toBe(3)
  })

  it('非法值回落 12', () => {
    st.currentEvent = { id: 'test', perPage: 99 }
    expect(itemsPerPage()).toBe(12)
  })
})
