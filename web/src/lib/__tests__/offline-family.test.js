import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

describe('离线缓存按家庭隔离', () => {
  it('旧版单家庭缓存迁移到默认家庭', async () => {
    localStorage.setItem('giftbook_offline_cache.v1', JSON.stringify({
      events: { e1: { id: 'e1', name: '默认账簿' } },
      ledgers: {},
    }))
    localStorage.setItem('giftbook_offline_queue.v1', JSON.stringify([
      { qid: 'q1', eventId: 'e1', encryptedContent: 'cipher', queuedAt: '2026-01-01T00:00:00Z' },
    ]))
    const offline = await import('../offline.js')
    offline.setCacheFamily('fam_default')
    expect(offline.readCache().events.e1.name).toBe('默认账簿')
    expect(offline.readQueue()).toHaveLength(1)
    expect(localStorage.getItem('giftbook_offline_cache.v1')).toBeNull()
    expect(localStorage.getItem('giftbook_offline_queue.v1')).toBeNull()
  })

  it('不同家庭的缓存与队列互不可见', async () => {
    const offline = await import('../offline.js')
    offline.setCacheFamily('fam_a')
    offline.writeCache({ events: { a: { id: 'a', name: '甲家账簿' } }, ledgers: {} })
    offline.writeQueue([{ qid: 'qa', eventId: 'a', encryptedContent: 'ca', queuedAt: '2026-01-01T00:00:00Z' }])

    offline.setCacheFamily('fam_b')
    expect(offline.readCache().events).toEqual({})
    expect(offline.readQueue()).toEqual([])
    offline.writeCache({ events: { b: { id: 'b', name: '乙家账簿' } }, ledgers: {} })

    offline.setCacheFamily('fam_a')
    expect(offline.readCache().events.a.name).toBe('甲家账簿')
    expect(offline.readQueue()).toHaveLength(1)
    offline.setCacheFamily('fam_b')
    expect(offline.readCache().events.b.name).toBe('乙家账簿')
    expect(offline.readQueue()).toEqual([])
  })
})
