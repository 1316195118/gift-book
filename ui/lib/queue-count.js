// 待同步计数：写入 state.queueCount，供首页与记账页角标使用。
import { state as st } from '../store.js'
import { readQueue } from './offline.js'

export function paintQueueCount() {
  const list = readQueue()
  st.queueCount = st.currentEvent ? list.filter((item) => String(item.eventId) === String(st.currentEvent.id)).length : list.length
  return st.queueCount
}
