import { describe, it, expect } from 'vitest'
import { escapeHtml, amountToChinese, formatCurrency, formatDateTime, formatDate } from '../crypto.js'

describe('escapeHtml', () => {
  it('转义 HTML 危险字符', () => {
    expect(escapeHtml('<script>alert("x")&\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;'
    )
  })
  it('null / undefined 返回空串', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
  it('中文与普通文本原样保留', () => {
    expect(escapeHtml('礼金 100 元')).toBe('礼金 100 元')
  })
})

describe('amountToChinese', () => {
  it('零', () => {
    expect(amountToChinese(0)).toBe('零元整')
  })
  it('整数', () => {
    expect(amountToChinese(100)).toBe('壹佰元整')
  })
  it('小数（角分）', () => {
    expect(amountToChinese(1234.56)).toBe('壹仟贰佰叁拾肆元伍角陆分')
  })
  it('字符串数字', () => {
    expect(amountToChinese('88')).toBe('捌拾捌元整')
  })
  it('非法输入返回空串', () => {
    expect(amountToChinese('abc')).toBe('')
    expect(amountToChinese(null)).toBe('')
    expect(amountToChinese(undefined)).toBe('')
  })
})

describe('formatCurrency', () => {
  it('含人民币符号与千分位', () => {
    const s = formatCurrency(1234.5)
    expect(s).toMatch(/[¥￥]/)
    expect(s).toContain('1,234.50')
  })
  it('空值按 0 处理', () => {
    expect(formatCurrency(null)).toContain('0.00')
    expect(formatCurrency(undefined)).toContain('0.00')
  })
})

describe('formatDateTime / formatDate', () => {
  it('空值返回空串', () => {
    expect(formatDateTime(null)).toBe('')
    expect(formatDateTime('')).toBe('')
    expect(formatDate(null)).toBe('')
  })
  it('有效日期返回非空字符串', () => {
    expect(formatDate('2026-11-14T10:00:00Z')).not.toBe('')
    expect(formatDateTime('2026-11-14T10:00:00Z')).not.toBe('')
  })
})
