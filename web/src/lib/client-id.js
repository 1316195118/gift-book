// 每个标签页一个随机标识：让「自己发起」的实时事件被自己忽略，避免自触发刷新。
// 用 sessionStorage 而非 localStorage：同一浏览器多个标签页应各自收到对方的变更。
const KEY = 'giftbook-client-id'

export function clientId() {
  let id = ''
  try {
    id = sessionStorage.getItem(KEY) || ''
  } catch {
    /* 禁用会话存储时仍让请求继续，只是每个请求生成新的临时标识 */
  }
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    try {
      sessionStorage.setItem(KEY, id)
    } catch {
      /* 同上 */
    }
  }
  return id
}
