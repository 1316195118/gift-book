import { beforeEach, describe, expect, it } from 'vitest'
import { noteRecentSubmit, findRecentSubmit, findRecentName } from '../recent-submits.js'

describe('本机最近提交查重', () => {
  beforeEach(() => sessionStorage.clear())

  it('10 分钟内同名同额能命中，金额不同不命中', () => {
    noteRecentSubmit('张三', 300)
    expect(findRecentSubmit('张三', 300)).toBeTruthy()
    expect(findRecentSubmit('张三', 500)).toBeUndefined()
  })

  it('2 分钟内同名即可命中', () => {
    noteRecentSubmit('李四', 100)
    expect(findRecentName('李四')).toBeTruthy()
  })
})
