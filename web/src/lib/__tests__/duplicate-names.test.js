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
    expect(groups[0].name).toBe('张三')
    expect(groups[0].list).toHaveLength(2)
  })

  it('同名记录中，有备注和无备注的分开核对', () => {
    const groups = duplicateGroups([
      { data: { name: '王五', amount: 10 } },
      { data: { name: '王五', amount: 20 } },
      { data: { name: '王五', amount: 30, remarks: '班费' } },
      { data: { name: '王五', amount: 40, remarks: '活动款' } },
    ])

    expect(groups).toHaveLength(2)
    expect(groups.find((group) => !group.hasRemarks).list).toHaveLength(2)
    expect(groups.find((group) => group.hasRemarks).list).toHaveLength(2)
  })

  it('同名但一笔有备注、一笔无备注时不报同名', () => {
    const groups = duplicateGroups([
      { data: { name: '赵六', amount: 10 } },
      { data: { name: '赵六', amount: 20, remarks: '活动款' } },
    ])
    expect(groups).toHaveLength(0)
  })
})
