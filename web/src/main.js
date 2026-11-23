// 全局样式：一套设计令牌 + 基础层 + 组件层 + 页面层 + 封面 + 打印。
// 顺序即层叠顺序，后面的文件只做加法，不再互相覆盖。
import './styles/tokens.css'
import './styles/base.css'
import './styles/atmosphere.css'
import './styles/utilities.css'
import './styles/components.css'
import './styles/screens.css'
import './styles/cover.css'
import './styles/large-text.css'
import './styles/motion.css'
import './styles/features.css'

import { createApp } from 'vue'
import App from './App.vue'
import { initFeedback } from './lib/feedback.js'
import { initHints } from './lib/hint.js'
import { initVersionWatch } from './lib/version-check.js'
import { notify } from './lib/notify.js'

// 动效档位与点击反馈要在页面渲染前挂好。
initFeedback()
// 「?」提示的浮层与事件委托：模板里写 data-hint 即可。
initHints()

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

// 发布后旧页面懒加载的 chunk 会 404：这不是数据问题，自动刷新一次即可恢复。
// 用 sessionStorage 记一次标记，避免真正的代码错误导致无限刷新。
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
function recoverFromStaleChunk(detail) {
  const message = String(detail?.message || detail || '')
  if (!CHUNK_ERROR.test(message)) return false
  try {
    if (sessionStorage.getItem('gb-stale-chunk-reloaded') === '1') return false
    sessionStorage.setItem('gb-stale-chunk-reloaded', '1')
  } catch {
    // 隐私模式或内嵌浏览器禁用存储时，不自动刷新，避免刷新循环。
    return false
  }
  window.location.reload()
  return true
}

window.addEventListener('unhandledrejection', (event) => {
  if (recoverFromStaleChunk(event.reason)) return
  reportClientError('未处理的 Promise 拒绝', event.reason)
})
window.addEventListener('error', (event) => {
  if (recoverFromStaleChunk(event.error || event.message)) return
  reportClientError('未捕获错误', event.error || event.message)
})

// 应用正常挂载一段时间后清掉标记：下次发布仍能自动恢复一次。
window.setTimeout(() => {
  try { sessionStorage.removeItem('gb-stale-chunk-reloaded') } catch { /* 隐私模式下忽略 */ }
}, 15000)

// 首屏稳定后再分批预取体积较大的按需模块，避免和首页数据请求抢带宽。
function prefetchHeavyModules() {
  const connection = navigator.connection
  const constrained = connection?.saveData ||
    /(^|-)[23]g$/.test(String(connection?.effectiveType || '')) ||
    (Number.isFinite(connection?.downlink) && connection.downlink < 2)
  const publicPolicy = /^\/(?:privacy|terms)\/?$/.test(window.location.pathname)
  if (constrained || publicPolicy) return
  const idle = (run) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2800 })
    else window.setTimeout(run, 900)
  }
  window.setTimeout(() => {
    idle(() => {
      import('./lib/exports.js').catch(() => {})
      import('./lib/printing.js').catch(() => {})
    })
    window.setTimeout(() => {
      idle(() => {
        import('./lib/changelog.js').catch(() => {})
        import('./lib/ocr-entry.js').catch(() => {})
      })
    }, 1400)
  }, 2200)
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
