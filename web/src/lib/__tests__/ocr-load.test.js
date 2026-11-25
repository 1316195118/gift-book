import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete globalThis.GiftBookOCR
  vi.resetModules()
})

describe('OCR 模块加载', () => {
  it('加载后同时注册页面全局和模块导出', async () => {
    const mod = await import('../ocr.js')
    const exported = mod.default || mod

    expect(typeof globalThis.GiftBookOCR?.open).toBe('function')
    expect(typeof exported.open).toBe('function')
    expect(globalThis.GiftBookOCR.extractRows).toBe(exported.extractRows)
  })
})
