// Node 26 会暴露一个未配置文件的浏览器 localStorage 全局，jsdom 的 storage 因此被遮蔽。
// 单测只要求 Storage 接口，直接用内存实现，避免依赖 Node 启动参数或临时文件。
function memoryStorage() {
  const values = new Map()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key) {
      values.delete(String(key))
    },
    setItem(key, value) {
      values.set(String(key), String(value))
    },
  }
}

for (const name of ['localStorage', 'sessionStorage']) {
  const current = globalThis[name]
  if (current && typeof current.getItem === 'function') continue
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: memoryStorage(),
  })
}
