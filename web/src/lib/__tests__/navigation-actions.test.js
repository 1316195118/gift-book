import { beforeEach, describe, expect, it, vi } from 'vitest'

const bootstrapMocks = vi.hoisted(() => ({
  showTemplates: vi.fn(),
  showSetup: vi.fn(),
  showHome: vi.fn(),
  loadEvents: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
}))

vi.mock('../../bootstrap.js', () => bootstrapMocks)

import { api } from '../api.js'
import { state } from '../../store.js'
import { openEvent } from '../actions.js'

function deferred() {
  let resolve
  const promise = new Promise((ok) => { resolve = ok })
  return { promise, resolve }
}

beforeEach(() => {
  vi.restoreAllMocks()
  Object.values(bootstrapMocks).forEach((mock) => mock.mockClear())
  state.currentEvent = null
  state.currentPassword = null
})

describe('打开账簿竞态', () => {
  it('快速点击两本账簿时，晚返回的旧请求不会覆盖新选择', async () => {
    const first = deferred()
    const second = deferred()
    vi.spyOn(api, 'getEvent').mockImplementation((id) => (
      id === 'first' ? first.promise : second.promise
    ))

    const openFirst = openEvent('first')
    const openSecond = openEvent('second')
    second.resolve({ success: true, data: { id: 'second', name: '第二本', hasPassword: false } })
    await openSecond

    first.resolve({ success: true, data: { id: 'first', name: '第一本', hasPassword: false } })
    await openFirst

    expect(state.currentEvent?.id).toBe('second')
    expect(bootstrapMocks.startSession).toHaveBeenCalledOnce()
  })
})
