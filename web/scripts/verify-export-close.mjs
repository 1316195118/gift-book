import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'msedge', headless: true })
const p = await b.newPage({ viewport: { width: 390, height: 844 } })
await p.goto('http://127.0.0.1:18299', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.locator('#home-create-btn').click()
await p.waitForTimeout(700)
await p.fill('#event-name', '关闭测试账簿')
await p.locator('.setup-submit').click()
await p.waitForTimeout(2000)
const skip = p.locator('#modal-actions button', { hasText: '暂不开启' })
if (await skip.count()) await skip.first().click().catch(() => {})
await p.waitForTimeout(400)
await p.locator('#export-btn').click()
await p.waitForTimeout(800)

const box = await p.evaluate(() => {
  const btn = document.querySelector('.unlock-card.export-card .unlock-close')
  const modal = document.querySelector('#modal')
  const r = btn?.getBoundingClientRect()
  const m = modal?.getBoundingClientRect()
  const style = btn ? getComputedStyle(btn) : null
  const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
  return {
    display: style?.display,
    visible: Boolean(r && r.width > 0 && r.height > 0),
    inModal: Boolean(r && m && r.top >= m.top && r.right <= m.right && r.bottom <= m.bottom),
    hitIsButton: Boolean(hit && (hit === btn || btn?.contains(hit))),
    box: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
  }
})
console.log('关闭键 =', JSON.stringify(box))
await p.screenshot({ path: 'scripts/export-close.png' })

// 点 × 关闭
await p.locator('.unlock-card.export-card .unlock-close').click()
await p.waitForTimeout(600)
console.log('点×后弹窗还在 =', await p.locator('#modal-container').count())

// 再打开，点遮罩关闭
await p.locator('#export-btn').click()
await p.waitForTimeout(700)
await p.mouse.click(12, 12)
await p.waitForTimeout(600)
console.log('点遮罩后弹窗还在 =', await p.locator('#modal-container').count())
await b.close()
