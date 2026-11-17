import { describe, expect, it } from 'vitest'
import { duplicateGroups } from '../stats.js'

describe('同名记录检查', () => {
  it('只返回出现两次以上的姓名，占位行不算', () => {
    const groups = duplicateGroups([
      { data: { name: '张三', amount: 100 } },
      { data: { name: '张三', amount: 200 } },
      { data: { name: '李四', amount: 50 } },
      { data: { name: '', amount: 0, kind: 'blank' } },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0][0]).toBe('张三')
    expect(groups[0][1]).toHaveLength(2)
  })
})
