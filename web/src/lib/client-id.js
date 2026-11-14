// 每个标签页一个随机标识：让「自己发起」的实时事件被自己忽略，避免自触发刷新。
// 用 sessionStorage 而非 localStorage：同一浏览器多个标签页应各自收到对方的变更。
const KEY = 'giftbook-client-id'

export function clientId() {
  let id = sessionStorage.getItem(KEY)
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(KEY, id)
  }
  return id
}
