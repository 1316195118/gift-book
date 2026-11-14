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

// 动效档位与点击反馈要在页面渲染前挂好。
initFeedback()

createApp(App).mount('#app')

// 首屏空闲时预取体积较大的按需模块：点击导出/打印/扫码时不再等 chunk 下载。
function prefetchHeavyModules() {
  const run = () => {
    import('./lib/exports.js').catch(() => {})
    import('./lib/printing.js').catch(() => {})
    import('./lib/ocr-entry.js').catch(() => {})
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2500 })
  else window.setTimeout(run, 1500)
}

prefetchHeavyModules()

// PWA：生产环境注册 Service Worker，支持「添加到主屏幕」与断网打开已缓存页面。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败不影响正常使用 */
    })
  })
}
