// 全局样式：一套设计令牌 + 基础层 + 组件层 + 页面层 + 封面 + 打印。
// 顺序即层叠顺序，后面的文件只做加法，不再互相覆盖。
import './styles/tokens.css'
import './styles/base.css'
import './styles/atmosphere.css'
import './styles/utilities.css'
import './styles/components.css'
import './styles/screens.css'
import './styles/cover.css'
import './styles/ocr.css'
import './styles/print.css'
import './styles/large-text.css'
import './styles/motion.css'

import { createApp } from 'vue'
import App from './App.vue'
import { initFeedback } from './lib/feedback.js'
import { initVersionWatch } from './lib/version-check.js'
import { notify } from './lib/notify.js'

// 动效档位与点击反馈要在页面渲染前挂好。
initFeedback()

// 全局错误兜底：渲染异常或未捕获异常时给出可操作提示，避免「白屏没反应」。
let errorNotifiedAt = 0
function reportClientError(kind, detail) {
  console.error(`[giftbook] ${kind}`, detail)
  const now = Date.now()
  if (now - errorNotifiedAt < 30000) return
  errorNotifiedAt = now
  try {
    notify.warn('页面出现异常', '如果界面显示不正常，请刷新页面重试（Ctrl+F5）', { duration: 8000 })
  } catch {
    /* 提示本身失败时不再抛，避免二次崩溃 */
  }
}

const app = createApp(App)
app.config.errorHandler = (err, _instance, info) => reportClientError(`渲染错误（${info}）`, err)
app.mount('#app')

window.addEventListener('unhandledrejection', (event) => reportClientError('未处理的 Promise 拒绝', event.reason))
window.addEventListener('error', (event) => reportClientError('未捕获错误', event.error || event.message))

// 首屏空闲时预取体积较大的按需模块：点击导出/打印/扫码/更新说明时不再等 chunk 下载。
function prefetchHeavyModules() {
  const run = () => {
    import('./lib/changelog.js').catch(() => {})
    import('./lib/exports.js').catch(() => {})
    import('./lib/printing.js').catch(() => {})
    import('./lib/ocr-entry.js').catch(() => {})
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2500 })
  else window.setTimeout(run, 1500)
}

prefetchHeavyModules()

// 部署新版本后提示刷新，避免用户停留在旧页面上点击懒加载按钮。
initVersionWatch()

// PWA：生产环境注册 Service Worker，支持「添加到主屏幕」与断网打开已缓存页面。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' 确保 sw.js 自身不被 HTTP 缓存拖住，更新能及时生效。
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      /* 注册失败不影响正常使用 */
    })
  })
}
