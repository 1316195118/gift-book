import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
})

describe('收款码保存状态', () => {
  it('服务器同步失败时不修改本机状态，也不提示成功', async () => {
    const { state } = await import('../../store.js')
    state.currentEvent = { id: 'e1', qrcode: null }
    const { api } = await import('../api.js')
    vi.spyOn(api, 'updateEvent').mockRejectedValueOnce(new Error('offline'))
    const modal = await import('../modal.js')
    const alertSpy = vi.spyOn(modal, 'alert').mockImplementation(() => {})
    vi.spyOn(modal, 'closeModal').mockImplementation(() => {})

    const { saveQr } = await import('../qr-dialog.js')
    await saveQr('data:image/png;base64,AAAA')

    expect(alertSpy).toHaveBeenCalledWith('未保存', expect.stringContaining('未能同步到服务器'))
    expect(state.currentEvent.qrcode).toBeNull()
    expect(localStorage.getItem('giftbook_qr_e1')).toBeNull()
  })

  it('服务器同步成功但本地存储不可用时，明确提示仅保存在服务器', async () => {
    const { state } = await import('../../store.js')
    state.currentEvent = { id: 'e1', qrcode: null }
    const { api } = await import('../api.js')
    vi.spyOn(api, 'updateEvent').mockResolvedValueOnce({
      success: true,
      data: { id: 'e1', qrcode: 'data:image/png;base64,AAAA' },
    })
    const modal = await import('../modal.js')
    const alertSpy = vi.spyOn(modal, 'alert').mockImplementation(() => {})
    vi.spyOn(modal, 'closeModal').mockImplementation(() => {})
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage disabled', 'SecurityError')
      },
    })

    try {
      const { saveQr } = await import('../qr-dialog.js')
      await saveQr('data:image/png;base64,AAAA')
      expect(state.currentEvent.qrcode).toBe('data:image/png;base64,AAAA')
      expect(alertSpy).toHaveBeenCalledWith('已保存', expect.stringContaining('仅保存在服务器'))
    } finally {
      Object.defineProperty(globalThis, 'localStorage', original)
    }
  })
})
