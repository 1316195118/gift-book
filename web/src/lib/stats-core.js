// 统计汇总的唯一实现：主界面汇总卡、统计弹窗、Excel/Word 导出、打印共用同一口径。
// 金额一律按「分」整数累加，避免浮点误差；人数按姓名去重（空名不计入人数，但计入笔数）。
import { totalReturnedOf, hasReturned } from './return-gift.js'

// 元 → 分（四舍五入到分），非数字返回 0。
export const toCents = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function computeStats(gifts = []) {
  const byTypeCents = { 现金: 0, 支付宝: 0, 微信: 0, 其他: 0 }
  const byRelationCents = {}
  const byNameCents = {}
  let totalCents = 0
  let returnedCents = 0
  let returnedCount = 0
  let recordCount = 0

  gifts.forEach(({ data }) => {
    // 「跳过」占位行只为对齐纸簿顺序，不计入人数、金额与笔数。
    if (!data || data.kind === 'blank') return
    recordCount += 1
    const cents = toCents(data.amount)
    totalCents += cents
    byTypeCents[data.type] = (byTypeCents[data.type] || 0) + cents
    const relation = data.relation || '未分类'
    byRelationCents[relation] = (byRelationCents[relation] || 0) + cents
    if (data.name) byNameCents[data.name] = (byNameCents[data.name] || 0) + cents
    if (hasReturned(data)) {
      returnedCents += toCents(totalReturnedOf(data))
      returnedCount += 1
    }
  })

  const names = Object.entries(byNameCents).sort((a, b) => b[1] - a[1])
  const uniqueGivers = names.length
  const byType = {}
  for (const [type, cents] of Object.entries(byTypeCents)) byType[type] = cents / 100
  const byRelation = {}
  for (const [relation, cents] of Object.entries(byRelationCents)) byRelation[relation] = cents / 100

  return {
    totalAmount: totalCents / 100,
    // totalGivers 保留旧字段名，但统一表示「去重人数」，与导出/打印的「共 N 位」一致。
    totalGivers: uniqueGivers,
    uniqueGivers,
    recordCount,
    byType,
    byRelation,
    totalReturned: returnedCents / 100,
    returnedCount,
    average: uniqueGivers ? totalCents / 100 / uniqueGivers : 0,
    topGivers: names.slice(0, 5).map(([name, cents]) => [name, cents / 100]),
  }
}
