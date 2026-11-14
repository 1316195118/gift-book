import { describe, it, expect } from 'vitest'
import { returnRecordsOf, totalReturnedOf, hasReturned, returnPatch, appendReturn, removeReturn } from '../return-gift.js'

describe('returnRecordsOf', () => {
  it('无回礼返回空数组', () => {
    expect(returnRecordsOf({})).toEqual([])
    expect(returnRecordsOf(null)).toEqual([])
    expect(hasReturned({})).toBe(false)
  })
  it('新格式多条记录', () => {
    const data = {
      returnRecords: [
        { amount: 100, timestamp: '2026-01-01T00:00:00Z', note: '茶叶' },
        { amount: 50, timestamp: '2026-02-01T00:00:00Z' },
      ],
    }
    expect(returnRecordsOf(data).length).toBe(2)
    expect(totalReturnedOf(data)).toBe(150)
    expect(hasReturned(data)).toBe(true)
  })
  it('兼容旧版单次回礼', () => {
    const data = { returned: true, returnAmount: 200, returnedAt: '2026-01-01T00:00:00Z' }
    expect(returnRecordsOf(data)).toEqual([{ amount: 200, note: '', timestamp: '2026-01-01T00:00:00Z' }])
    expect(totalReturnedOf(data)).toBe(200)
  })
  it('过滤 0 / 非法金额', () => {
    const data = { returnRecords: [{ amount: 0 }, { amount: 'abc' }, { amount: 10 }] }
    expect(returnRecordsOf(data).length).toBe(1)
  })
})

describe('appendReturn / removeReturn', () => {
  it('追加一条并同步冗余字段', () => {
    const p1 = appendReturn({}, 100, '茶叶', '2026-01-01T00:00:00Z')
    expect(p1.returned).toBe(true)
    expect(p1.returnAmount).toBe(100)
    expect(p1.returnRecords.length).toBe(1)
    expect(p1.returnedAt).toBe('2026-01-01T00:00:00Z')
    const p2 = appendReturn({ returnRecords: p1.returnRecords }, 50, '', '2026-02-01T00:00:00Z')
    expect(p2.returnRecords.length).toBe(2)
    expect(p2.returnAmount).toBe(150)
    expect(p2.returnedAt).toBe('2026-02-01T00:00:00Z')
  })
  it('撤销其中一条', () => {
    const data = {
      returnRecords: [
        { amount: 100, timestamp: '2026-01-01T00:00:00Z' },
        { amount: 50, timestamp: '2026-02-01T00:00:00Z' },
      ],
    }
    const p = removeReturn(data, 0)
    expect(p.returnRecords.length).toBe(1)
    expect(p.returnAmount).toBe(50)
  })
  it('全部撤销后 returned=false', () => {
    const data = { returnRecords: [{ amount: 100, timestamp: '2026-01-01T00:00:00Z' }] }
    const p = removeReturn(data, 0)
    expect(p.returned).toBe(false)
    expect(p.returnAmount).toBe(0)
    expect(p.returnedAt).toBe('')
  })
  it('备注截断到 200 字', () => {
    const p = appendReturn({}, 10, 'x'.repeat(260))
    expect(p.returnRecords[0].note.length).toBe(200)
  })
})
