import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalDescriptors = new Map()

function denyStorage(name) {
  if (!originalDescriptors.has(name)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new DOMException('storage disabled', 'SecurityError')
    },
  })
}

function restoreStorage() {
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  originalDescriptors.clear()
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  restoreStorage()
})

describe('浏览器禁用存储', () => {
  it('应用状态仍可初始化并进入默认分类', async () => {
    denyStorage('localStorage')
    const { state } = await import('../../store.js')
    expect(state.homeCategory).toBe('red')
    expect(state.enabledCategories).toEqual(['red', 'white', 'custom'])
  })

  it('请求客户端标识仍可生成', async () => {
    denyStorage('sessionStorage')
    const { clientId } = await import('../client-id.js')
    expect(clientId()).toMatch(/\S+/)
  })
})
