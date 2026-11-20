import { describe, expect, it } from 'vitest'
import { updateSizeLabel, updateVersionLabel, updateVersionMarkup } from '../app-update.js'

describe('程序更新展示格式', () => {
  it('版本号带不带 v 都只显示一个 v', () => {
    expect(updateVersionLabel('v2.4.43')).toBe('2.4.43')
    expect(updateVersionLabel('2.4.43')).toBe('2.4.43')
    expect(updateVersionLabel('  V2.4.44 ')).toBe('2.4.44')
  })

  it('下载大小按 KB / MB 展示', () => {
    expect(updateSizeLabel(512)).toBe('512 B')
    expect(updateSizeLabel(1536)).toBe('2 KB')
    expect(updateSizeLabel(8.4 * 1024 * 1024)).toBe('8.4 MB')
  })

  it('检查中、已是最新和检查失败时都持续显示当前版本', () => {
    expect(updateVersionMarkup({ current: '2.4.42', checking: true })).toContain('v2.4.42')
    expect(updateVersionMarkup({ current: '2.4.42', available: false })).toContain('当前版本')
    expect(updateVersionMarkup({ current: '2.4.41', error: '网络不可达' })).toContain('v2.4.41')
  })

  it('发现更新时同时显示当前版本和最新版本', () => {
    const html = updateVersionMarkup({ current: '2.4.42', version: 'v2.4.43', available: true })
    expect(html).toContain('v2.4.42')
    expect(html).toContain('可更新至 v2.4.43')
  })
})
