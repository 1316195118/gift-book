import { beforeEach, describe, expect, it, vi } from 'vitest'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

async function harness() {
  const { state, NO_PASSWORD_KEY } = await import('../../store.js')
  const { api } = await import('../api.js')
  const bootstrap = await import('../../bootstrap.js')
  state.currentPassword = NO_PASSWORD_KEY
  return { state, api, bootstrap }
}

function event(id) {
  return {
    id,
    name: id,
    hasPassword: false,
    totalAmount: 0,
    startDateTime: '2026-01-01T00:00:00Z',
    endDateTime: '2027-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
})

describe('当前账簿礼金加载', () => {
  it('同一账簿的在途加载只发一次请求', async () => {
    const { state, api, bootstrap } = await harness()
    state.currentEvent = event('e1')
    state.giftsLoaded = false
    const pending = deferred()
    const listGifts = vi.spyOn(api, 'listGifts').mockReturnValue(pending.promise)

    const first = bootstrap.loadGiftsForCurrentEvent()
    const second = bootstrap.loadGiftsForCurrentEvent()
    await vi.waitFor(() => expect(listGifts).toHaveBeenCalledTimes(1))
    expect(state.giftsLoaded).toBe(false)

    pending.resolve({ success: true, data: {} })
    await Promise.all([first, second])
    expect(listGifts).toHaveBeenCalledTimes(1)
    expect(state.giftsLoaded).toBe(true)
  })

  it('后台刷新保留已显示礼金，不闪回骨架屏', async () => {
    const { state, api, bootstrap } = await harness()
    state.currentEvent = event('e1')
    state.giftsLoaded = false
    const listGifts = vi.spyOn(api, 'listGifts').mockResolvedValueOnce({ success: true, data: {} })

    await bootstrap.loadGiftsForCurrentEvent()
    const visibleGift = { id: 'visible', data: { name: '已有记录', amount: 88, timestamp: '2026-11-21T00:00:00Z' } }
    state.gifts = [visibleGift]

    const pending = deferred()
    listGifts.mockReturnValueOnce(pending.promise)
    const refresh = bootstrap.loadGiftsForCurrentEvent()
    await vi.waitFor(() => expect(listGifts).toHaveBeenCalledTimes(2))

    expect(state.giftsLoaded).toBe(true)
    expect(state.gifts).toEqual([visibleGift])

    pending.resolve({ success: true, data: {} })
    await refresh
    expect(state.giftsLoaded).toBe(true)
  })

  it('快速切簿后丢弃旧账簿晚到的结果', async () => {
    const { state, api, bootstrap } = await harness()
    const { LedgerCrypto, NO_PASSWORD_KEY } = await import('../../store.js')
    const oldPending = deferred()
    const nextPending = deferred()
    const listGifts = vi.spyOn(api, 'listGifts').mockImplementation((eventId) => (
      eventId === 'old' ? oldPending.promise : nextPending.promise
    ))
    const encrypted = (name) => LedgerCrypto.encrypt(JSON.stringify({
      name,
      amount: 100,
      timestamp: '2026-11-21T00:00:00Z',
    }), NO_PASSWORD_KEY)

    state.currentEvent = event('old')
    state.giftsLoaded = false
    const oldLoad = bootstrap.loadGiftsForCurrentEvent()
    await vi.waitFor(() => expect(listGifts).toHaveBeenCalledWith('old'))

    state.currentEvent = event('next')
    state.gifts = []
    state.giftsLoaded = false
    const nextLoad = bootstrap.loadGiftsForCurrentEvent()
    await vi.waitFor(() => expect(listGifts).toHaveBeenCalledWith('next'))

    nextPending.resolve({ success: true, data: { g2: { id: 'g2', encryptedContent: encrypted('新账簿') } } })
    await nextLoad
    oldPending.resolve({ success: true, data: { g1: { id: 'g1', encryptedContent: encrypted('旧账簿') } } })
    await oldLoad

    expect(state.currentEvent.id).toBe('next')
    expect(state.gifts.map((gift) => gift.data.name)).toEqual(['新账簿'])
  })
})
