import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../api.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function jsonResponse(data) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('API 并发请求合并', () => {
  it('相同 GET 在同一时刻只请求一次', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const fetchMock = vi.fn(async () => {
      await gate
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = apiRequest('/api/events')
    const second = apiRequest('/api/events')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    release()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, data: { ok: true } },
      { success: true, data: { ok: true } },
    ])

    await apiRequest('/api/events')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('不同账簿密钥的 GET 不合并', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([
      apiRequest('/api/gifts?eventId=e1', 'GET', null, { ledgerKey: 'key-a' }),
      apiRequest('/api/gifts?eventId=e1', 'GET', null, { ledgerKey: 'key-b' }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('写请求不会合并', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([
      apiRequest('/api/gifts', 'POST', { eventId: 'e1' }),
      apiRequest('/api/gifts', 'POST', { eventId: 'e1' }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
