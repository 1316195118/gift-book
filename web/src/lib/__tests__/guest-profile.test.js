import { describe, expect, it } from 'vitest'
import { buildGuestProfiles, searchGuestProfiles } from '../guest-profile.js'

describe('guest profiles', () => {
  const records = [
    { eventId: 'e1', eventName: '春宴', giftId: 'g1', data: { name: '张三', amount: 1000, relation: '朋友', timestamp: '2026-01-01T00:00:00Z', operator: '甲' } },
    { eventId: 'e2', eventName: '秋宴', giftId: 'g2', data: { name: '张三', amount: 500, relation: '朋友', timestamp: '2026-10-01T00:00:00Z', returnRecords: [{ amount: 500 }], operator: '乙' } },
    { eventId: 'e1', eventName: '春宴', giftId: 'g3', data: { name: '李四', amount: 200, relation: '同事', timestamp: '2026-02-01T00:00:00Z' } },
  ]

  it('aggregates names across ledgers', () => {
    const profiles = buildGuestProfiles(records)
    expect(profiles).toHaveLength(2)
    expect(profiles[0]).toMatchObject({
      name: '张三',
      totalAmount: 1500,
      returnedAmount: 500,
      netAmount: 1000,
      recordCount: 2,
      status: 'partial',
      primaryRelation: '朋友',
    })
    expect(profiles[0].events).toHaveLength(2)
    expect(profiles[0].operators).toEqual(['甲', '乙'])
  })

  it('searches by name, relation and ledger', () => {
    const profiles = buildGuestProfiles(records)
    expect(searchGuestProfiles(profiles, '张三')[0].name).toBe('张三')
    expect(searchGuestProfiles(profiles, '同事')[0].name).toBe('李四')
    expect(searchGuestProfiles(profiles, '秋宴')[0].name).toBe('张三')
  })

  it('ignores blank and empty-name rows', () => {
    expect(buildGuestProfiles([
      { eventId: 'e', data: { kind: 'blank', name: '', amount: 0 } },
      { eventId: 'e', data: { name: '  ', amount: 100 } },
    ])).toEqual([])
  })
})
