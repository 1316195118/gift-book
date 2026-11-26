import { describe, it, expect, vi, afterEach } from 'vitest'
import { escapeHtml, amountToChinese, formatCurrency, formatDateTime, formatDate, safeFileName, sha256Hex } from '../crypto.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sha256Hex', () => {
  it('局域网 HTTP 没有 Web Crypto 时仍返回稳定摘要', async () => {
    vi.stubGlobal('crypto', {})
    expect(await sha256Hex('测试客')).toBe(
      '3e19ea2700ca18f531838a3fd3ac158a01ce88750715d1c88df96a518ea43d16'
    )
  })

  it('空姓名摘要与已知 SHA-256 一致', async () => {
    vi.stubGlobal('crypto', {})
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })
})

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

describe('formatDate / formatDateTime', () => {
  it('空值与非法日期返回空串，不出现 Invalid Date', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate('不是日期')).toBe('')
    expect(formatDateTime(undefined)).toBe('')
    expect(formatDateTime('2026-13-45')).toBe('')
  })
  it('正常日期仍按中文格式输出', () => {
    expect(formatDate('2026-11-16T10:00:00')).toContain('2026')
    expect(formatDateTime('2026-11-16T10:00:00')).toContain('2026')
  })
})

describe('safeFileName', () => {
  it('清理 Windows 非法字符并保留中文', () => {
    expect(safeFileName('婚宴/答谢:2026?')).toBe('婚宴_答谢_2026')
  })
  it('去掉首尾空格与点，空名回退默认值', () => {
    expect(safeFileName('  喜宴. ')).toBe('喜宴')
    expect(safeFileName('')).toBe('礼簿')
    expect(safeFileName(null)).toBe('礼簿')
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
