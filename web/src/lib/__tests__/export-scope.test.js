import { describe, it, expect, beforeEach } from 'vitest'
import { state as st } from '../../store.js'
import { exportScope, resetExportScope, scopeGifts, scopeInfo } from '../export-scope.js'

const sample = [
  { id: 'a', data: { name: '甲', amount: 100, relation: '亲戚' } },
  { id: 'b', data: { name: '乙', amount: 200, relation: '朋友' } },
  { id: 'c', data: { name: '丙', amount: 300, relation: '同事' } },
]

describe('导出范围', () => {
  beforeEach(() => {
    st.gifts = sample.map((gift) => ({ ...gift, data: { ...gift.data } }))
    resetExportScope()
  })

  it('默认导出整本', () => {
    expect(scopeGifts()).toHaveLength(3)
    expect(scopeInfo().active).toBe(false)
    expect(scopeInfo().label).toContain('整本账簿')
  })

  it('只保留勾选记录，顺序仍按原账簿', () => {
    exportScope.mode = 'selected'
    exportScope.ids = ['c', 'a']
    expect(scopeGifts().map((gift) => gift.id)).toEqual(['a', 'c'])
    expect(scopeInfo().count).toBe(2)
    expect(scopeInfo().label).toContain('仅选中')
  })

  it('选中的记录已被删掉时返回空集而不是报错', () => {
    exportScope.mode = 'selected'
    exportScope.ids = ['missing']
    expect(scopeGifts()).toHaveLength(0)
  })

  it('重置后回到整本', () => {
    exportScope.mode = 'selected'
    exportScope.ids = ['b']
    resetExportScope()
    expect(scopeGifts()).toHaveLength(3)
    expect(exportScope.ids).toEqual([])
    expect(exportScope.mode).toBe('all')
  })
})
