// 应用根控制器（原生 JS，零第三方依赖）。
// 注意：以下四个模块在求值时会把库对象挂到 globalThis，crypto.js 等在模块求值期就读取这些全局，
// 因此必须排在最前面导入，确保全局先就绪，再加载依赖它们的 store / lib。
import './lib/ledger-crypto.js'
import './lib/xlsx-lite.js'
import './lib/voices.js'
import './lib/ocr-scan.js'

import { state as st, subscribe, setBodyTheme } from './store.js'
import { eventTheme } from './lib/content.js'
import { mountHome } from './views/home.js'
import { mountTemplate } from './views/template.js'
import { mountSetup } from './views/setup.js'
import { mountMain } from './views/main.js'
import { mountAppModal } from './components/app-modal.js'
import { mountOfflineToast } from './components/offline-toast.js'
import { mountQrFloat } from './components/qr-float.js'
import { mountAuthGate } from './components/auth-gate.js'
import { initFeedback } from './lib/feedback.js'
import { bootstrap } from './bootstrap.js'

const viewRoot = document.getElementById('view-root')
const authRoot = document.getElementById('auth-root')
const modalRoot = document.getElementById('modal-root')
const toastRoot = document.getElementById('toast-root')
const qrRoot = document.getElementById('qr-root')

const VIEWS = {
  home: mountHome,
  template: mountTemplate,
  setup: mountSetup,
  main: mountMain,
}

let currentMount = null
let currentKey = null
let previousRoute = null

// 页面层级决定进入方向：往里走从右侧来，返回首页从左侧回。
const DEPTH = { home: 0, template: 1, setup: 1, main: 2 }

function renderView() {
  const key = st.authGate ? null : st.route
  if (key === currentKey) return
  if (currentMount && typeof currentMount.unmount === 'function') {
    try { currentMount.unmount() } catch { /* 忽略 */ }
  }
  currentMount = null
  viewRoot.innerHTML = ''
  if (!key) {
    currentKey = null
    return
  }
  const direction = previousRoute && (DEPTH[key] ?? 1) < (DEPTH[previousRoute] ?? 1)
    ? 'back'
    : 'forward'
  // 先设属性再挂载，确保页面元素插入时就能匹配到对应方向的动画。
  viewRoot.dataset.route = key
  viewRoot.dataset.direction = direction
  previousRoute = key
  const mount = VIEWS[key] || mountHome
  currentMount = mount(viewRoot) || null
  currentKey = key
}

// 主题统一在这里同步：分类切换、进入/退出账簿、会话恢复都会改状态，
// 由订阅统一兜底，避免某个 action 漏调 setBodyTheme 导致红白配色串色。
function syncTheme() {
  if (st.route === 'main' && st.currentEvent) {
    setBodyTheme(eventTheme(st.currentEvent, st.homeCategory))
  } else {
    setBodyTheme(st.homeCategory === 'white' ? 'theme-solemn' : 'theme-festive')
  }
}

let authMounted = false
function renderAuth() {
  if (st.authGate) {
    if (!authMounted) {
      authRoot.innerHTML = ''
      mountAuthGate(authRoot)
      authMounted = true
    }
  } else if (authMounted) {
    authRoot.innerHTML = ''
    authMounted = false
  }
}

// 全局反馈：toast 容器 + 点击涟漪，先于其他组件初始化。
initFeedback()

// 持久层：弹窗、离线提示、收款码浮层常驻。
mountAppModal(modalRoot)
mountOfflineToast(toastRoot)
mountQrFloat(qrRoot)

subscribe(renderView)
subscribe(renderAuth)
subscribe(syncTheme)

renderView()
renderAuth()
syncTheme()

bootstrap().catch((err) => {
  console.error('启动失败:', err)
})
