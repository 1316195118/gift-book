// 人情往来年度报告：按礼金登记年份统计，金额统一使用“分”避免累计误差。
import { toCents } from './stats-core.js'
import { returnRecordsOf, totalReturnedOf } from './return-gift.js'

export const REPORT_MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

export function reportYears(gifts = []) {
  const years = new Set()
  gifts.forEach(({ data }) => {
    if (!data || data.kind === 'blank') return
    const date = data.timestamp ? new Date(data.timestamp) : null
    if (date && Number.isFinite(date.getTime())) years.add(date.getFullYear())
  })
  return [...years].sort((a, b) => b - a)
}

export function buildRelationshipReport(gifts = [], year = new Date().getFullYear()) {
  const targetYear = Number(year)
  const monthly = Array.from({ length: 12 }, () => ({ cents: 0, count: 0 }))
  const byRelation = new Map()
  const byPerson = new Map()
  const operators = new Set()
  let totalCents = 0
  let recordCount = 0
  let returnedCents = 0
  let returnedRecordCount = 0

  gifts.forEach(({ data }) => {
    if (!data || data.kind === 'blank' || !data.timestamp) return
    const date = new Date(data.timestamp)
    if (!Number.isFinite(date.getTime()) || date.getFullYear() !== targetYear) return
    const cents = toCents(data.amount)
    totalCents += cents
    recordCount += 1
    monthly[date.getMonth()].cents += cents
    monthly[date.getMonth()].count += 1
    if (data.operator) operators.add(String(data.operator))

    const relation = String(data.relation || '未分类')
    const rel = byRelation.get(relation) || { relation, cents: 0, count: 0, names: new Set() }
    rel.cents += cents
    rel.count += 1
    if (data.name) rel.names.add(String(data.name).trim())
    byRelation.set(relation, rel)

    const returned = toCents(totalReturnedOf(data))
    if (returned > 0 || returnRecordsOf(data).length > 0) {
      returnedCents += returned
      returnedRecordCount += 1
    }
    if (data.name) {
      const name = String(data.name).trim()
      const person = byPerson.get(name) || { name, cents: 0, count: 0, returnedCents: 0, relations: new Set() }
      person.cents += cents
      person.count += 1
      person.returnedCents += returned
      if (data.relation) person.relations.add(String(data.relation))
      byPerson.set(name, person)
    }
  })

  const relations = [...byRelation.values()]
    .map((item) => ({ ...item, people: item.names.size, names: undefined }))
    .sort((a, b) => b.cents - a.cents || b.count - a.count)
  const people = [...byPerson.values()]
    .map((item) => ({ ...item, relations: [...item.relations] }))
    .sort((a, b) => b.cents - a.cents || b.count - a.count)
  const peak = monthly.reduce((best, item, index) => item.cents > best.cents ? { ...item, month: index } : best, { cents: 0, count: 0, month: -1 })

  return {
    year: targetYear,
    totalAmount: totalCents / 100,
    recordCount,
    peopleCount: people.length,
    average: people.length ? totalCents / 100 / people.length : 0,
    returnedAmount: returnedCents / 100,
    returnedRecordCount,
    unreturnedRecordCount: Math.max(0, recordCount - returnedRecordCount),
    netAmount: (totalCents - returnedCents) / 100,
    monthly: monthly.map((item, index) => ({ month: index, label: REPORT_MONTHS[index], amount: item.cents / 100, count: item.count })),
    peakMonth: peak.month < 0 ? null : { ...peak, amount: peak.cents / 100, label: REPORT_MONTHS[peak.month] },
    relations,
    topPeople: people.slice(0, 10),
    operators: [...operators],
  }
}
