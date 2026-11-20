import { describe, expect, it } from 'vitest'
import { updateSizeLabel, updateVersionLabel } from '../app-update.js'

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
})
