import { describe, it, expect } from 'vitest'
import { parseCsv, mapRows } from '../import.js'

describe('parseCsv', () => {
  it('基础行', () => {
    expect(parseCsv('张三,100,现金\n李四,200,微信')).toEqual([
      ['张三', '100', '现金'],
      ['李四', '200', '微信'],
    ])
  })
  it('引号包裹的逗号', () => {
    expect(parseCsv('"张,三",100,现金')).toEqual([['张,三', '100', '现金']])
  })
  it('双引号转义', () => {
    expect(parseCsv('"张""三",100')).toEqual([['张"三', '100']])
  })
  it('UTF-8 BOM 与 CRLF', () => {
    expect(parseCsv('\ufeff张三,100\r\n李四,200')).toEqual([
      ['张三', '100'],
      ['李四', '200'],
    ])
  })
  it('忽略空行', () => {
    expect(parseCsv('张三,100\n\n')).toEqual([['张三', '100']])
  })
})

describe('mapRows', () => {
  it('无表头按列序映射', () => {
    const { records, errors } = mapRows([
      ['张三', '100', '现金'],
      ['李四', '200.5', '微信', '朋友', '同学'],
    ])
    expect(errors).toEqual([])
    expect(records.length).toBe(2)
    expect(records[0]).toMatchObject({ name: '张三', amount: 100, type: '现金' })
    expect(records[1].relation).toBe('朋友')
    expect(records[1].remarks).toBe('同学')
  })
  it('带表头自动识别列', () => {
    const { records } = mapRows([
      ['姓名', '金额', '关系'],
      ['王五', '88', '同事'],
    ])
    expect(records[0]).toMatchObject({ name: '王五', amount: 88, relation: '同事' })
  })
  it('金额带货币符号与千分位', () => {
    const { records } = mapRows([['赵六', '¥1,234.50']])
    expect(records[0].amount).toBe(1234.5)
  })
  it('非法行进 errors，不阻塞合法行', () => {
    const { records, errors } = mapRows([
      ['', '100'],
      ['张三', 'abc'],
      ['李四', '50'],
    ])
    expect(errors.length).toBe(2)
    expect(records.length).toBe(1)
    expect(records[0].name).toBe('李四')
  })
})
