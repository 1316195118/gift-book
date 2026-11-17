// 「正期」字段的用词：红事按模板叫婚礼/寿宴/满月酒时间，白事用殡期或仪式时间。
// 白事不用「死亡时间」这种直白说法，卡片和设置里都按场景称呼。
const LABELS = {
  wedding: '婚礼时间',
  birthday: '寿宴时间',
  fullmoon: '满月酒时间',
  housewarming: '乔迁时间',
  school: '宴席时间',
  funeral: '殡期',
  baishi: '殡期',
  memorial: '追思时间',
  anniversary: '祭日时间',
  reburial: '安葬时间',
}

export function ceremonyLabel(event, category) {
  const key = String(event?.template || '')
  if (LABELS[key]) return LABELS[key]
  return category === 'white' ? '仪式时间' : '婚礼时间'
}

// 卡片上一行放得下的写法：11月17日 12:08；跨年时补年份。
export function ceremonyText(event, now = new Date()) {
  const raw = String(event?.ceremonyAt || '')
  if (!raw) return ''
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return ''
  const sameYear = at.getFullYear() === now.getFullYear()
  const date = sameYear
    ? `${at.getMonth() + 1}月${at.getDate()}日`
    : `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日`
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return `${date} ${time}`
}

export const ceremonyInputs = (value) => {
  const raw = String(value || '')
  return { date: raw.slice(0, 10), time: raw.slice(11, 16) }
}
