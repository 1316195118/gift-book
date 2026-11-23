// 来宾档案聚合：输入均为浏览器内已解密的礼金，按规范化姓名汇总。
import { toCents } from './stats-core.js'
import { returnRecordsOf, totalReturnedOf } from './return-gift.js'

export function normalizeGuestName(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function buildGuestProfiles(records = []) {
  const people = new Map()
  records.forEach((record) => {
    const data = record?.data
    if (!data || data.kind === 'blank') return
    const name = normalizeGuestName(data.name)
    if (!name) return
    const profile = people.get(name) || {
      name,
      cents: 0,
      returnedCents: 0,
      recordCount: 0,
      returnedCount: 0,
      firstAt: '',
      lastAt: '',
      relations: new Map(),
      events: new Map(),
      operators: new Set(),
      entries: [],
    }
    const cents = toCents(data.amount)
    const returned = toCents(totalReturnedOf(data))
    const relation = String(data.relation || '未分类')
    profile.cents += cents
    profile.returnedCents += returned
    profile.recordCount += 1
    if (returnRecordsOf(data).length > 0) profile.returnedCount += 1
    if (!profile.firstAt || String(data.timestamp) < profile.firstAt) profile.firstAt = data.timestamp || ''
    if (!profile.lastAt || String(data.timestamp) > profile.lastAt) profile.lastAt = data.timestamp || ''
    const relationStat = profile.relations.get(relation) || { relation, count: 0, cents: 0 }
    relationStat.count += 1
    relationStat.cents += cents
    profile.relations.set(relation, relationStat)
    const eventId = String(record.eventId || '')
    const eventStat = profile.events.get(eventId) || {
      id: eventId,
      name: record.eventName || '未命名账簿',
      count: 0,
      cents: 0,
    }
    eventStat.count += 1
    eventStat.cents += cents
    profile.events.set(eventId, eventStat)
    if (data.operator) profile.operators.add(String(data.operator))
    profile.entries.push({
      giftId: record.giftId || '',
      eventId,
      eventName: record.eventName || '未命名账簿',
      amount: cents / 100,
      returnedAmount: returned / 100,
      relation,
      timestamp: data.timestamp || '',
      remarks: String(data.remarks || ''),
      operator: String(data.operator || ''),
    })
    people.set(name, profile)
  })

  return [...people.values()].map((profile) => {
    const relations = [...profile.relations.values()].sort((a, b) => b.count - a.count || b.cents - a.cents)
    const events = [...profile.events.values()].sort((a, b) => String(b.name).localeCompare(String(a.name), 'zh-CN'))
    const status = profile.returnedCents >= profile.cents
      ? 'returned'
      : profile.returnedCents > 0 ? 'partial' : 'unreturned'
    return {
      name: profile.name,
      totalAmount: profile.cents / 100,
      returnedAmount: profile.returnedCents / 100,
      netAmount: (profile.cents - profile.returnedCents) / 100,
      recordCount: profile.recordCount,
      returnedCount: profile.returnedCount,
      firstAt: profile.firstAt,
      lastAt: profile.lastAt,
      primaryRelation: relations[0]?.relation || '未分类',
      relations,
      events,
      operators: [...profile.operators],
      status,
      entries: profile.entries.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))),
    }
  }).sort((a, b) => b.totalAmount - a.totalAmount || a.name.localeCompare(b.name, 'zh-CN'))
}

export function searchGuestProfiles(profiles = [], query = '') {
  const term = normalizeGuestName(query).toLocaleLowerCase('zh-CN')
  if (!term) return profiles
  return profiles.filter((profile) => (
    profile.name.toLocaleLowerCase('zh-CN').includes(term)
    || profile.primaryRelation.toLocaleLowerCase('zh-CN').includes(term)
    || profile.events.some((event) => String(event.name).toLocaleLowerCase('zh-CN').includes(term))
  ))
}
