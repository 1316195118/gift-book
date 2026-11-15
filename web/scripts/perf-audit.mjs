import { chromium } from 'playwright-core'
const BASE = 'http://127.0.0.1:18299'
const b = await chromium.launch({ channel: 'msedge', headless: true })
const p = await b.newPage({ viewport: { width: 390, height: 844 } })
const longTasks = []
await p.addInitScript(() => {
  window.__long = []
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] })
  } catch {}
})

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(600)

// 建账
await p.locator('#home-create-btn').click()
await p.waitForTimeout(600)
await p.fill('#event-name', '性能测试账簿')
await p.locator('.setup-submit').click()
await p.waitForTimeout(1800)
const skip = p.locator('#modal-actions button', { hasText: '暂不开启' })
if (await skip.count()) await skip.first().click().catch(() => {})
await p.waitForTimeout(300)

// 录音条，拿到密文
await p.fill('#guest-name', '性能张三')
await p.fill('#gift-amount', '100')
await p.locator('#submit-gift-btn').click()
await p.waitForTimeout(500)
const confirm = p.locator('#modal-actions button', { hasText: '确认提交' })
if (await confirm.count()) await confirm.first().click()
await p.waitForTimeout(900)

const info = await p.evaluate(async () => {
  const ev = (await (await fetch('/api/events')).json()).data
  const id = Object.keys(ev).sort((a, b) => String(ev[b].createdAt || '').localeCompare(String(ev[a].createdAt || '')))[0]
  const gifts = (await (await fetch('/api/gifts?eventId=' + id)).json()).data
  const first = Object.values(gifts)[0]
  return { eventId: id, cipher: first.encryptedContent, eventName: ev[id].name, existing: Object.keys(gifts).length }
})
// 复制成 120 条
const created = await p.evaluate(async ({ eventId, cipher }) => {
  let ok = 0
  for (let i = 0; i < 120; i += 1) {
    const res = await fetch('/api/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, encryptedContent: cipher, requestId: 'perf-' + Date.now() + '-' + i }),
    })
    if (res.ok) ok += 1
  }
  return ok
}, info)
console.log('账簿 =', info.eventName, '| 原记录 =', info.existing, '| 新写入 =', created)

// 重新进入账簿，测量
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const nav = await p.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0]
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]
  return {
    dcl: Math.round(n.domContentLoadedEventEnd),
    load: Math.round(n.loadEventEnd),
    fcp: Math.round(fcp?.startTime || 0),
    resources: performance.getEntriesByType('resource').filter((r) => r.transferSize > 0).map((r) => `${r.name.split('/').pop()}:${Math.round(r.transferSize / 1024)}KB`),
  }
})
console.log('首页导航 =', JSON.stringify(nav))

const t0 = Date.now()
if ((await p.locator('.main-tools').count()) === 0) {
  await p.locator('.recent-item').first().click()
}
await p.waitForFunction(() => document.querySelector('#gift-book-content')?.innerText.trim().length > 0, null, { timeout: 10000 })
console.log('进入账簿(ms) =', Date.now() - t0, '| 页码 =', (await p.locator('#page-indicator').innerText().catch(() => '')).replace(/\s+/g, ' '))
await p.waitForTimeout(500)

// 翻页 3 次
const tp = Date.now()
for (let i = 0; i < 3; i += 1) {
  await p.locator('#prev-page-btn').click().catch(() => {})
  await p.waitForTimeout(140)
}
console.log('翻页 3 次(ms) =', Date.now() - tp)

// 统计弹窗
const ts = await p.evaluate(async () => {
  const t = performance.now()
  document.querySelector('#stats-btn').click()
  return await new Promise((resolve) => {
    const check = () => (document.querySelector('#modal-container') ? resolve(Math.round(performance.now() - t)) : requestAnimationFrame(check))
    requestAnimationFrame(check)
    setTimeout(() => resolve(-1), 5000)
  })
})
console.log('打开统计(ms) =', ts)
await p.waitForTimeout(600)

// 搜索
await p.keyboard.press('Escape')
await p.waitForTimeout(400)
const tq = Date.now()
await p.fill('#search-name', '性能')
await p.locator('#search-top-btn').click()
await p.waitForTimeout(600)
console.log('搜索(ms) =', Date.now() - tq)

const long = await p.evaluate(() => window.__long || [])
console.log('长任务(>50ms) =', JSON.stringify(long))
await b.close()
