// 主账簿页是进入现场后最重、最常用的异步页面。首页在指针悬停或键盘聚焦
// 最近账簿时先开始加载，点击后再复用同一个 Promise，缩短进入等待。
let mainViewPromise = null

export function loadMainView() {
  if (!mainViewPromise) {
    mainViewPromise = import('../views/MainScreen.vue').catch((error) => {
      mainViewPromise = null
      throw error
    })
  }
  return mainViewPromise
}

export function preloadMainView() {
  return loadMainView().catch(() => {})
}
