// 回礼记录：一笔礼金可多次回礼（分次还人情），旧版单次字段自动兼容。
const MAX_NOTE = 200

// 读取回礼列表：优先 returnRecords；旧数据用 returned/returnAmount 折算成一条。
export function returnRecordsOf(data) {
  if (!data) return []
  if (Array.isArray(data.returnRecords)) {
    return data.returnRecords
      .filter((r) => r && Number(r.amount) > 0)
      .map((r) => ({ amount: Number(r.amount), note: String(r.note || ''), timestamp: r.timestamp || '' }))
  }
  if (data.returned && Number(data.returnAmount) > 0) {
    return [{ amount: Number(data.returnAmount), note: '', timestamp: data.returnedAt || data.timestamp || '' }]
  }
  return []
}

export function totalReturnedOf(data) {
  return returnRecordsOf(data).reduce((sum, r) => sum + r.amount, 0)
}

export function hasReturned(data) {
  return returnRecordsOf(data).length > 0
}

// 生成写回 data 的补丁：returnRecords 为主，同时冗余 returned/returnAmount/returnedAt，
// 让旧的统计、导出与兼容逻辑继续可用。
export function returnPatch(records) {
  const list = (Array.isArray(records) ? records : [])
    .filter((r) => r && Number(r.amount) > 0)
    .map((r) => ({ amount: Number(r.amount), note: String(r.note || '').slice(0, MAX_NOTE), timestamp: r.timestamp || '' }))
  const total = list.reduce((sum, r) => sum + r.amount, 0)
  const last = list.length ? list[list.length - 1] : null
  return {
    returnRecords: list,
    returned: list.length > 0,
    returnAmount: total,
    returnedAt: last ? last.timestamp || '' : '',
  }
}

export function appendReturn(data, amount, note = '', timestamp = new Date().toISOString()) {
  return returnPatch([...returnRecordsOf(data), { amount, note, timestamp }])
}

export function removeReturn(data, index) {
  return returnPatch(returnRecordsOf(data).filter((_, i) => i !== index))
}
