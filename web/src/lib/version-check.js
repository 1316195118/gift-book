// 版本哨兵：部署新版本后旧页面不会自动换代码，懒加载的 chunk 会 404。
// 回到页面时对比 /build.json，发现变化就提示刷新，避免用户继续在旧页面上操作。
import { notify } from './notify.js'

let loadedBuild = ''

async function readBuild() {
  try {
    const res = await fetch('/build.json', { cache: 'no-store' })
    if (!res.ok) return ''
    const info = await res.json()
    return String(info.build || '')
  } catch {
    return ''
  }
}

export async function initVersionWatch() {
  loadedBuild = await readBuild()
  if (!loadedBuild) return

  const check = async () => {
    if (document.visibilityState !== 'visible') return
    const next = await readBuild()
    if (!next || next === loadedBuild) return
    loadedBuild = next
    notify.warn('发现新版本', '刷新页面后即可使用最新版（Ctrl+F5）', { duration: 15000 })
  }

  document.addEventListener('visibilitychange', check)
  window.setInterval(check, 5 * 60 * 1000)
}
