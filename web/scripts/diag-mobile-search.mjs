import { chromium } from 'playwright-core'
const BASE = 'http://127.0.0.1:18299'
const NO_PASS = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const ev = (await (await fetch(BASE + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '手机查找测试', theme: 'theme-festive', category: 'red', template: '婚宴', startDateTime: '2026-11-15T10:00', endDateTime: '2026-11-16T10:00', passwordHash: NO_PASS, totalAmount: 0 }) })).json()).data

const b = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const p = await ctx.newPage()
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 160)))
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
await p.locator('.recent-item').first().click()
await p.waitForTimeout(1600)
await p.evaluate(async (eventId) => {
  const pwd = 'giftbook-local-nopass'
  for (let i = 1; i <= 30; i += 1) {
    const d = { name: `手机${i}号`, amount: 100 + i, type: '现金', timestamp: new Date(Date.now() + i * 1000).toISOString() }
    await fetch('/api/gifts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ledger-Key': pwd }, body: JSON.stringify({ eventId, encryptedContent: LedgerCrypto.encrypt(JSON.stringify(d), pwd), requestId: 'm' + i + Math.random() }) })
  }
}, ev.id)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1800)
// 滚到顶部（模拟真实手机：搜索框在上方）
await p.evaluate(() => window.scrollTo(0, 0))
await p.waitForTimeout(400)
const before = await p.evaluate(() => ({ y: Math.round(window.scrollY), page: document.querySelector('.book-navigation')?.innerText.replace(/\s+/g, ' ').trim() }))
console.log('查前 =', JSON.stringify(before))

await p.fill('#search-name', '手机25号')
await p.locator('#search-top-btn').tap()
await p.waitForTimeout(200)
const mid = await p.evaluate(() => ({ bodyOverflow: getComputedStyle(document.body).overflow, modal: Boolean(document.querySelector('#modal-container')) }))
await p.waitForTimeout(1500)
const after = await p.evaluate(() => {
  const cell = document.querySelector('#gift-book-content .name-cell[data-gift-index]')
  const target = [...document.querySelectorAll('#gift-book-content .name-cell')].find((c) => c.innerText.includes('手机25号'))
  const r = target?.getBoundingClientRect()
  return {
    y: Math.round(window.scrollY),
    page: document.querySelector('.book-navigation')?.innerText.replace(/\s+/g, ' ').trim(),
    modalTitle: document.querySelector('#modal-title')?.textContent || '',
    cellInView: r ? r.top >= 0 && r.bottom <= innerHeight : null,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }
})
console.log('查中 =', JSON.stringify(mid))
console.log('查后 =', JSON.stringify(after))
await b.close()
