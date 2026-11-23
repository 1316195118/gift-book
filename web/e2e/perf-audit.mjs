// 本地生产构建的首屏性能快照。使用独立浏览器上下文，避免 Service Worker 命中旧缓存。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const OUT = process.env.PERF_OUT || join('..', '.shots', 'perf')
mkdirSync(OUT, { recursive: true })

const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium.executablePath(),
].find((candidate) => candidate && existsSync(candidate))
if (!browserPath) throw new Error('找不到 Edge/Chromium，请设置 E2E_BROWSER')

const report = []

for (const profile of [
  { name: 'mobile-375', width: 375, height: 812, mobile: true },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
]) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('giftbook_category', 'red')
      localStorage.setItem('giftbook-backup-prompted', '1')
    } catch { /* ignore */ }
    window.__gbPerf = { lcp: 0, cls: 0 }
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      window.__gbPerf.lcp = entries.at(-1)?.startTime || window.__gbPerf.lcp
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__gbPerf.cls += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  const page = await context.newPage()
  await page.bringToFront()
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.locator('#home-main-card').waitFor({ state: 'visible' })
  await page.waitForTimeout(1200)
  // 无头浏览器在完全不可见的上下文里可能延迟生成 Paint Timing；截图会强制合成首帧。
  await page.screenshot({ path: join(OUT, `${profile.name}.png`) })
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime]))
    const resources = performance.getEntriesByType('resource')
    const largest = resources
      .map((entry) => ({ name: entry.name.split('/').pop(), decoded: entry.decodedBodySize, transfer: entry.transferSize }))
      .sort((a, b) => b.decoded - a.decoded)
      .slice(0, 6)
    return {
      domContentLoaded: nav?.domContentLoadedEventEnd || 0,
      load: nav?.loadEventEnd || 0,
      fcp: paints['first-contentful-paint'] || 0,
      lcp: window.__gbPerf?.lcp || 0,
      cls: window.__gbPerf?.cls || 0,
      resources: resources.length,
      transfer: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      decoded: resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      largest,
    }
  })

  const started = Date.now()
  await page.locator('#home-main-card').click()
  await page.locator('.tpl-card').first().waitFor({ state: 'visible', timeout: 10000 })
  metrics.templateTransition = Date.now() - started
  report.push({ profile: profile.name, ...metrics })
  console.log(profile.name, {
    fcp: Math.round(metrics.fcp),
    lcp: Math.round(metrics.lcp),
    dcl: Math.round(metrics.domContentLoaded),
    load: Math.round(metrics.load),
    cls: Number(metrics.cls.toFixed(3)),
    templateTransition: metrics.templateTransition,
    transferKB: Math.round(metrics.transfer / 1024),
  })
  await context.close()
  await browser.close()
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
const failed = report.some((item) =>
  item.lcp > 2500 || item.domContentLoaded > 2500 || item.load > 4500 || item.cls > 0.1 || item.templateTransition > 2000)
console.log(`性能报告：${join(OUT, 'report.json')}`)
if (failed) process.exit(1)
