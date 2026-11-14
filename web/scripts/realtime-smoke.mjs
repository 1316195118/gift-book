// 实时同步联调：两个独立浏览器上下文（模拟两台设备），验证 A 写入后 B 不刷新即可看到。
import { chromium } from 'playwright-core'

const BASE = process.env.RT_BASE || 'http://127.0.0.1:18299'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } })
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } })
const a = await ctxA.newPage()
const b = await ctxB.newPage()
const errors = []
for (const [label, p] of [['A', a], ['B', b]]) {
  p.on('pageerror', (e) => errors.push(`${label}: ${String(e)}`))
}

await a.goto(BASE, { waitUntil: 'networkidle' })
await a.waitForTimeout(500)
await a.locator('#home-create-btn').click()
await a.waitForTimeout(700)
await a.fill('#event-name', '实时同步测试')
await a.locator('.setup-submit').click()
await a.waitForTimeout(2000)
const skip = a.locator('#modal-actions button', { hasText: '暂不开启' })
if (await skip.count()) await skip.first().click().catch(() => {})
await a.waitForTimeout(400)
console.log('A in main =', await a.locator('.main-tools').count())

await b.goto(BASE, { waitUntil: 'networkidle' })
await b.waitForTimeout(800)
await b.locator('.recent-item').first().click()
await b.waitForTimeout(1800)
console.log('B in main =', await b.locator('.main-tools').count())

async function addGift(page, name, amount) {
  await page.fill('#guest-name', name)
  await page.fill('#gift-amount', amount)
  await page.locator('#submit-gift-btn').click()
  await page.waitForTimeout(600)
  const confirm = page.locator('#modal-actions button', { hasText: '确认提交' })
  if (await confirm.count()) await confirm.first().click()
  await page.waitForTimeout(1000)
}

await addGift(a, '实时张三', '100')
let seenB = false
try {
  await b.waitForFunction(
    () => document.querySelector('#gift-book-content')?.innerText.replace(/\s+/g, '').includes('实时张三'),
    null,
    { timeout: 8000 },
  )
  seenB = true
} catch { /* 超时即失败 */ }
console.log('B sees A gift =', seenB)

await addGift(b, '实时李四', '200')
let seenA = false
try {
  await a.waitForFunction(
    () => document.querySelector('#gift-book-content')?.innerText.replace(/\s+/g, '').includes('实时李四'),
    null,
    { timeout: 8000 },
  )
  seenA = true
} catch { /* 超时即失败 */ }
console.log('A sees B gift =', seenA)

console.log('pageerrors =', errors.slice(0, 3))
await browser.close()
process.exit(seenA && seenB ? 0 : 1)
