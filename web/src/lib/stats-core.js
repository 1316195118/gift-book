// 统计汇总的纯函数实现：主界面汇总卡与统计弹窗共用，避免两份口径。
// 不依赖全局 store，调用方传入礼金数组，便于单测。
import { totalReturnedOf, hasReturned } from './return-gift.js'

export function computeStats(gifts = []) {
  const result = {
    totalAmount: 0,
    totalGivers: gifts.length,
    byType: { 现金: 0, 支付宝: 0, 微信: 0, 其他: 0 },
    byRelation: {},
    totalReturned: 0,
    returnedCount: 0,
    uniqueGivers: 0,
    average: 0,
    topGivers: [],
  }
  const byName = {}
  gifts.forEach(({ data }) => {
    if (!data) return
    const amount = Number(data.amount) || 0
    result.totalAmount += amount
    result.byType[data.type] = (result.byType[data.type] || 0) + amount
    const relation = data.relation || '未分类'
    result.byRelation[relation] = (result.byRelation[relation] || 0) + amount
    if (data.name) byName[data.name] = (byName[data.name] || 0) + amount
    if (hasReturned(data)) {
      result.totalReturned += totalReturnedOf(data)
      result.returnedCount += 1
    }
  })
  const names = Object.entries(byName).sort((a, b) => b[1] - a[1])
  result.uniqueGivers = names.length
  result.average = names.length ? result.totalAmount / names.length : 0
  result.topGivers = names.slice(0, 5)
  return result
}
