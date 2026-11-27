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
import { modal } from '../modal.js'
import { openEvent, switchCategory } from '../actions.js'

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
  state.homeCategory = 'red'
  localStorage.setItem('giftbook_category', 'red')
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

describe('首页分类切换', () => {
  it('切换分类时结束当前账簿会话，只改变浏览范围', async () => {
    state.currentEvent = { id: 'red-ledger', category: 'red' }
    state.currentPassword = 'secret'

    switchCategory('custom')

    expect(modal.title).toBe('切换分类')
    expect(modal.body.html).toContain('不会把当前账簿带入新分类')
    const confirm = modal.actions.find((action) => action.text === '确定')
    expect(confirm).toBeTruthy()

    await confirm.handler()

    expect(bootstrapMocks.endSession).toHaveBeenCalledOnce()
    expect(state.homeCategory).toBe('custom')
    expect(localStorage.getItem('giftbook_category')).toBe('custom')
    expect(bootstrapMocks.loadEvents).toHaveBeenCalledOnce()
  })
})
