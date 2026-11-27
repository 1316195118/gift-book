// 自定义模板端到端回归：分类 → 创建 → 手机布局 → 收款 → 统计 → PDF → 公开扫码页。
// 用法：先启动隔离实例，再 BASE_URL=http://127.0.0.1:18199 node e2e/custom-template.mjs
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const OUT = process.env.SHOT_DIR || join('..', '.shots', 'custom-template')
mkdirSync(OUT, { recursive: true })

const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium.executablePath(),
].find((candidate) => candidate && existsSync(candidate))
if (!browserPath) throw new Error('找不到浏览器：请设置 E2E_BROWSER')

const browser = await chromium.launch({ executablePath: browserPath, headless: true })
const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
}
const overflow = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth))
const dateInput = (offsetDays = 0) => {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  const pad = (number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

async function dismissLightModals(page) {
  for (let index = 0; index < 4; index += 1) {
    const skip = page.getByText('暂不开启', { exact: true }).first()
    if (await skip.count()) {
      await skip.click({ force: true }).catch(() => {})
      await page.waitForTimeout(180)
      continue
    }
    if (!(await page.locator('#modal').isVisible().catch(() => false))) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
await context.addInitScript(() => {
  localStorage.setItem('giftbook_category', 'custom')
  localStorage.setItem('giftbook-backup-prompted', '1')
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push((error.stack || error.message).split('\n')[0]))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text().slice(0, 180))
})

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await dismissLightModals(page)
  await page.locator('#home-main-card').waitFor({ state: 'visible' })

  const tabs = page.locator('.cat-switch .cat-btn')
  check('首页显示红事、白事、自定义三个分类', (await tabs.count()) === 3)
  check('自定义分类被选中', await page.locator('[data-cat="custom"]').evaluate((element) => element.classList.contains('active')))

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 812 })
    await page.waitForTimeout(100)
    const boxes = await tabs.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
    check(`${width}px 首页分类无横向溢出`, (await overflow(page)) <= 1)
    check(`${width}px 三个分类完整可见`, boxes.length === 3 && boxes.every((box) => box.width >= 44 && box.height >= 44), boxes.map((box) => `${Math.round(box.width)}×${Math.round(box.height)}`).join(' / '))
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: join(OUT, '01-custom-home.png'), fullPage: true })

  await page.locator('#home-main-card').click()
  await page.locator('.tpl-card').first().waitFor({ state: 'visible' })
  check('自定义模板卡可见', (await page.locator('.tpl-card').count()) === 1)
  check('自定义模板使用青绿主题', (await page.locator('.tpl-card .ledger-cover').getAttribute('data-theme')) === 'custom')
  check('自定义模板页无横向溢出', (await overflow(page)) <= 1)
  await page.locator('.tpl-card').first().click()

  await page.locator('#setup-screen').waitFor({ state: 'visible' })
  check('创建页出现自定义模板名称', await page.locator('#event-template-name').isVisible())
  check('自定义创建页无横向溢出', (await overflow(page)) <= 1)
  const eventName = `秋季活动收款-${Date.now().toString(36).slice(-6)}`
  await page.locator('#event-name').fill(eventName)
  await page.locator('#event-template-name').fill('活动收款')
  await page.locator('#start-date').fill(dateInput(0))
  await page.locator('#end-date').fill(dateInput(2))
  await page.locator('.setup-more-summary').click()
  await page.locator('#cover-style-grid').waitFor({ state: 'visible' })

  const coverStyles = await page.locator('#cover-style-grid .ledger-cover').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.dataset.style,
    theme: node.dataset.theme,
    title: node.querySelector('.cover-name')?.textContent?.trim() || '',
  })))
  check('自定义封面共 4 款', coverStyles.length === 4, coverStyles.map((style) => style.id).join(' / '))
  check('自定义封面全部使用 custom 主题', coverStyles.every((style) => style.theme === 'custom'))
  check('自定义封面题签显示业务名称', coverStyles.every((style) => style.title === '活动收款'), coverStyles.map((style) => style.title).join(' / '))
  check('自定义封面缩略图已解码', await page.locator('#cover-style-grid .cover-art').evaluateAll((images) => images.length === 4 && images.every((image) => image.complete && image.naturalWidth > 0)))
  await page.screenshot({ path: join(OUT, '02-custom-setup.png'), fullPage: true })

  await page.locator('.setup-submit').click()
  await page.locator('#main-screen').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(900)
  await dismissLightModals(page)
  check('进入自定义账簿后使用青绿主题', await page.locator('body').evaluate((body) => body.classList.contains('theme-custom')))
  check('自定义录入页显示收款称谓', (await page.locator('#entry-panel').innerText()).includes('收款录入'))
  check('自定义记账页无横向溢出', (await overflow(page)) <= 1)

  await page.locator('#guest-name').fill('测试付款人')
  await page.locator('#gift-amount').fill('208.50')
  await page.locator('#submit-gift-btn').click()
  const confirm = page.locator('#modal-actions button').filter({ hasText: /^确定$/ }).last()
  await confirm.waitFor({ state: 'visible', timeout: 5000 })
  await confirm.click({ force: true })
  await page.locator('#gift-book-content .name-cell .name').first().waitFor({ state: 'visible', timeout: 15000 })
  check('自定义账簿可录入小数金额', (await page.locator('#gift-book-content').innerText()).includes('208.50'))
  await page.screenshot({ path: join(OUT, '03-custom-filled.png'), fullPage: true })

  const savedEvent = await page.evaluate(async (name) => {
    const response = await fetch('/api/events', { cache: 'no-store' })
    const payload = await response.json()
    return Object.values(payload.data || {}).find((event) => event.name === name)
  }, eventName)
  check('自定义分类已持久化', savedEvent?.category === 'custom' && savedEvent?.theme === 'theme-custom', `${savedEvent?.category || '-'} / ${savedEvent?.theme || '-'}`)
  check('自定义模板名称已持久化', savedEvent?.template === '活动收款', savedEvent?.template || '-')

  await page.locator('#stats-btn').click()
  await page.locator('#modal').waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
  const statsText = await page.locator('#modal-content').innerText()
  check('自定义统计使用收款口径', statsText.includes('总收款金额') && statsText.includes('人均收款'))
  check('自定义统计不混入人情往来与回礼', !statsText.includes('人情往来') && !statsText.includes('已回礼'))
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await page.locator('#export-btn').click()
  await page.locator('#modal').waitFor({ state: 'visible' })
  const exportText = await page.locator('#modal-content').innerText()
  check('自定义导出不显示回礼与未回礼入口', !exportText.includes('回礼明细') && !exportText.includes('未回礼名单'))
  await page.locator('.export-option').filter({ hasText: 'PDF' }).click()
  await page.locator('.pdf-cover-picker').waitFor({ state: 'visible', timeout: 5000 })
  check('PDF 封面选择只显示 4 款自定义封面', (await page.locator('.pdf-cover-choice').count()) === 4)
  check('PDF 预览使用自定义主题', (await page.locator('#pdf-cover-preview .ledger-cover').getAttribute('data-theme')) === 'custom')
  await page.screenshot({ path: join(OUT, '04-custom-pdf-cover.png'), fullPage: true })

  const downloadPromise = page.waitForEvent('download', { timeout: 40000 })
  await page.getByRole('button', { name: '生成 PDF', exact: true }).click()
  const download = await downloadPromise
  const pdfPath = join(OUT, 'custom-template.pdf')
  await download.saveAs(pdfPath)
  check('自定义封面 PDF 成功生成', existsSync(pdfPath) && statSync(pdfPath).size > 10000, existsSync(pdfPath) ? `${statSync(pdfPath).size}B` : 'no file')

  const guest = await page.evaluate(async (eventId) => {
    const response = await fetch(`/api/events/${eventId}/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    return response.json()
  }, savedEvent.id)
  const token = guest?.data?.token || guest?.token
  check('自定义账簿可开启公开登记入口', Boolean(token), JSON.stringify(guest).slice(0, 160))

  const guestPage = await context.newPage()
  await guestPage.goto(`${BASE}/?gift=${encodeURIComponent(token)}`, { waitUntil: 'networkidle' })
  await guestPage.locator('.gb-guest-form').waitFor({ state: 'visible', timeout: 10000 })
  const guestText = await guestPage.locator('.gb-guest-card').innerText()
  check('公开扫码页使用自定义收款文案', guestText.includes('请填写收款信息') && guestText.includes('付款人 / 对象') && guestText.includes('收款金额'))
  check('公开扫码页无需进入 NAS 管理后台', guestPage.url().includes('?gift=') && !guestPage.url().includes('/admin'))
  await guestPage.locator('#guest-name').fill('扫码付款人')
  await guestPage.locator('#guest-amount').fill('10.50')
  await guestPage.getByRole('button', { name: '提交登记' }).click()
  await guestPage.getByText('登记成功').waitFor({ state: 'visible', timeout: 5000 })
  check('扫码提交成功后使用收款账簿提示', (await guestPage.locator('.gb-guest-done').innerText()).includes('收款账簿'))
  check('手机扫码可提交小额收款', true)
  await guestPage.screenshot({ path: join(OUT, '05-custom-guest.png'), fullPage: true })

  check('页面运行无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`\n${failures.length} 项失败：`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log('\n自定义模板回归全部通过')
}
