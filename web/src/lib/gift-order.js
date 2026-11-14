// 礼簿顺序：按「原始登记时间」升序，绝不因后续修改（回礼 / 纠错 / 备注）而改变。
//
// 历史坑：旧版本 updateWithHistory 会把 data.timestamp 改成当前时间，
// 而列表按 timestamp 排序，导致改一次回礼就跳到最后。这里优先取
// 第一次修改快照里的 timestamp（即最早可追溯的原始登记时间）。
export function registeredAtOf(gift) {
  const data = gift?.data || {}
  const first = Array.isArray(data.history) && data.history.length
    ? data.history[0]?.snapshot?.timestamp
    : ''
  const parsed = Date.parse(first || data.timestamp || '')
  return Number.isFinite(parsed) ? parsed : NaN
}

export function compareGiftsByRegistration(a, b) {
  const ta = registeredAtOf(a)
  const tb = registeredAtOf(b)
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
  // 缺时间的排在后面；都缺时用 id 兜底，保证每次排序结果一致。
  if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
}
