import { chromium } from 'playwright-core'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push((e.stack || e.message).split('\n')[0]))
const results = []
const ok = (name, cond) => { results.push(`${cond ? 'ok' : 'FAIL'}: ${name}`) }
const dismiss = async () => {
  for (let i = 0; i < 3; i += 1) {
    if (!(await page.locator('#modal-container').count())) return
    const s = page.getByText('暂不开启', { exact: true }).first()
    if (await s.count()) { await s.click({ force: true }).catch(() => {}); await page.waitForTimeout(250); continue }
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  }
}
const add = async (name, amount, rel) => {
  await page.locator('#guest-name').fill(name)
  await page.locator('#gift-amount').fill(String(amount))
  if (rel) {
    await page.locator('.entry-more-toggle').click(); await page.waitForTimeout(200)
    await page.locator(`input[name="gift-relation"][value="${rel}"]`).check({ force: true }).catch(() => {})
  }
  await page.locator('#submit-gift-btn').click(); await page.waitForTimeout(200)
  const confirm = page.getByText('确定', { exact: true }).first()
  if (await confirm.count()) await confirm.click()
  await page.waitForTimeout(450)
}

// 1. 建账 + 录入
await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await dismiss()
await page.getByText('创建新账簿').last().click(); await page.waitForTimeout(500)
await page.locator('#event-name').fill('完整E2E')
await page.locator('#start-date').fill('2026-11-19')
await page.locator('#end-date').fill('2026-11-21')
await page.locator('.setup-submit').click(); await page.waitForTimeout(1500); await dismiss()
ok('建账', await page.locator('.entry-panel').count() === 1)

// 2. 录入 4 笔
await add('张三', 200, '亲戚')
await add('李四', 600, '朋友')
await add('王五', 300, '亲戚')
await add('赵六', 1000, '同事')
ok('四笔录入', (await page.locator('.name-cell:not(.is-empty)').count()) >= 4)

// 3. 金额区间 + 关系筛选
await page.locator('.search-filter-toggle').click(); await page.waitForTimeout(300)
await page.locator('#search-amount').fill('100-500')
await page.locator('#search-top-btn').click(); await page.waitForTimeout(500)
let hits = await page.locator('.search-summary b').innerText().catch(() => '?')
ok(`金额区间100-500命中2笔(实际${hits})`, hits.trim() === '2')
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
await page.locator('.search-filter-panel select').first().selectOption('亲戚')
await page.locator('#search-amount').fill('')
await page.locator('#search-top-btn').click(); await page.waitForTimeout(500)
hits = await page.locator('.search-summary b').innerText().catch(() => '?')
ok(`关系=亲戚命中2笔(实际${hits})`, hits.trim() === '2')
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

// 4. 详情 → 答谢卡
await page.locator('.name-cell').first().click(); await page.waitForTimeout(600)
await page.getByText('生成答谢卡', { exact: true }).click(); await page.waitForTimeout(700)
const canvasOk = await page.evaluate(() => {
  const c = document.getElementById('thank-card-canvas')
  if (!c) return { found: false, ink: 0 }
  const d = c.getContext('2d').getImageData(0, 0, 720, 900).data
  let ink = 0
  for (let i = 0; i < d.length; i += 40) if (d[i] < 200) ink += 1
  return { found: true, ink }
})
ok(`答谢卡画布(墨迹${canvasOk.ink})`, canvasOk.found && canvasOk.ink > 500)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

// 5. 距今天数：首页卡片
await page.locator('.main-back').first().click()
await page.waitForTimeout(1200)
const days = await page.locator('.rd-date').first().innerText().catch(() => '?')
ok(`首页距今天数(实际"${days}")`, /还有 2 天|今天|还有 1 天/.test(days))

// 6. 健康端点（需家庭会话）
const health = await page.evaluate(async () => {
  const res = await fetch('/api/health')
  return res.ok ? await res.json() : { fail: res.status }
})
ok('健康端点返回数据量', Boolean(health.success && health.data && health.data.events >= 1))

console.log(results.join('\n'))
console.log('errors', errors.slice(0, 4).join('\n') || 'none')
await browser.close()
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
