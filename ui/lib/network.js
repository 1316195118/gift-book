// 网络连通性探测：三条链路各自采样，取中位数作为延迟（原生 JS，零第三方依赖）。
import { state as st } from '../store.js'

const TARGETS = [
  { key: 'api', label: '账簿接口', url: '/api/ping' },
  { key: 'static', label: '静态资源', url: 'build.json' },
  { key: 'auth', label: '登录状态', url: '/api/auth' },
]

const samples = new Map()
let timer = null

async function probe(target) {
  const started = performance.now()
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller ? setTimeout(() => controller.abort(), 5000) : null
  try {
    const url = `${target.url}${target.url.includes('?') ? '&' : '?'}_ping=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store', signal: controller?.signal })
    await res.arrayBuffer().catch(() => {})
    return { ok: res.ok || res.status === 204, ms: Math.round(performance.now() - started), status: res.status }
  } catch {
    return { ok: false, ms: null, status: 0 }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function statsFor(key) {
  const list = samples.get(key) || []
  const good = list.filter((item) => item.ok && Number.isFinite(item.ms))
  if (!good.length) return { ok: false, avg: null, min: null, max: null, rate: 0 }
  const values = good.map((item) => item.ms).sort((a, b) => a - b)
  const mid = values.length % 2
    ? values[(values.length - 1) / 2]
    : Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2)
  return { ok: true, avg: mid, min: values[0], max: values[values.length - 1], rate: Math.round((good.length / list.length) * 100) }
}

export function computeHealth() {
  if (navigator.onLine === false) return { level: 'bad', text: '离线' }
  const stats = TARGETS.map((t) => statsFor(t.key))
  const good = stats.filter((s) => s.ok)
  if (!good.length) return { level: 'bad', text: '连接失败' }
  const avg = Math.round(good.reduce((sum, s) => sum + s.avg, 0) / good.length)
  if (good.length < stats.length) return { level: 'warn', text: `${avg} ms`, avg }
  const level = avg <= 120 ? 'good' : avg <= 400 ? 'warn' : 'bad'
  return { level, text: `${avg} ms`, avg }
}

export async function refreshNetwork() {
  for (const target of TARGETS) {
    const result = await probe(target)
    const list = samples.get(target.key) || []
    list.push(result)
    if (list.length > 12) list.shift()
    samples.set(target.key, list)
  }
  st.netHealth = computeHealth()
  return st.netHealth
}

export async function probeAllLinks() {
  const results = await Promise.all(TARGETS.map(async (target) => {
    const result = await probe(target)
    const list = samples.get(target.key) || []
    list.push(result)
    if (list.length > 12) list.shift()
    samples.set(target.key, list)
    return { target, result }
  }))
  st.netHealth = computeHealth()
  return results
}

export function startNetworkMonitor() {
  setTimeout(refreshNetwork, 700)
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    if (!document.hidden) refreshNetwork()
  }, 15000)
  window.addEventListener('online', () => { st.netHealth = computeHealth() })
  window.addEventListener('offline', () => { st.netHealth = computeHealth() })
}

// 对外暴露 health 视图：原版「网络状态」组件、autoflush 与两个页面都读 netState.health，
// 而状态里实际字段是 netHealth。用 getter 保持同一份数据，不必改各处调用方。
export const netState = {
  get health() { return st.netHealth },
}
export const NET_TARGETS = TARGETS
