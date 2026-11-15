import { chromium } from 'playwright-core'
const BASE = 'http://127.0.0.1:18299'
const b = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(900)
await p.locator('.recent-item').first().click()
await p.waitForTimeout(1800)
await p.evaluate(() => window.scrollTo(0, 0))
await p.waitForTimeout(300)

const state = () => p.evaluate(() => {
  const cells = [...document.querySelectorAll('#gift-book-content .name-cell')]
  const focus = document.querySelector('#gift-book-content .name-cell.is-focus')
  const fr = focus?.getBoundingClientRect()
  return {
    page: (document.querySelector('.book-navigation')?.innerText || '').replace(/\s+/g, ' ').trim(),
    y: Math.round(window.scrollY),
    focusText: focus ? focus.textContent.replace(/\s+/g, '') : '',
    focusInView: fr ? fr.top >= 0 && fr.bottom <= innerHeight : null,
    modal: document.querySelector('#modal-title')?.textContent || '',
    cells: cells.length,
  }
})

// 1) 全称唯一命中 → 跳页 + 弹详情
await p.fill('#search-name', '手机25号')
await p.locator('#search-top-btn').tap()
await p.waitForTimeout(1800)
console.log('唯一命中 =', JSON.stringify(await state()))
await p.keyboard.press('Escape')
await p.waitForTimeout(800)
console.log('关闭后 =', JSON.stringify(await state()))

// 2) 模糊 → 列表 → 点定位（第 2 行，落在第 1 页）
await p.evaluate(() => window.scrollTo(0, 0))
await p.fill('#search-name', '手机')
await p.locator('#search-top-btn').tap()
await p.waitForTimeout(1200)
const listRows = await p.evaluate(() => document.querySelectorAll('.search-row').length)
await p.locator('.search-row-locate').nth(1).tap()
await p.waitForTimeout(1500)
console.log('列表行数 =', listRows, '| 点定位 =', JSON.stringify(await state()))
await p.screenshot({ path: 'scripts/mobile-locate.png' })
console.log('错误 =', JSON.stringify(errs.slice(0, 2)))
await b.close()
