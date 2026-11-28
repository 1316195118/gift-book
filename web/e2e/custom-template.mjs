// 自定义模板端到端回归：分类 → 创建 → 手机布局 → 收款 → 统计 → PDF → 公开扫码页。
// 用法：先启动隔离实例，再 BASE_URL=http://127.0.0.1:18199 node e2e/custom-template.mjs
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { setFamilyCategory } from './prefs-helper.mjs'
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
const isWarm = ([red, green, blue]) => red >= green && green >= blue && red - blue >= 12
const parseHex = (value) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || '').trim())
  if (!match) return null
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16))
}

async function switchCategoryTo(page, category) {
  const tab = page.locator(`[data-cat="${category}"]`)
  if (await tab.evaluate((element) => element.classList.contains('active'))) return
  await tab.click()
  const confirm = page.locator('#modal-actions .modal-btn-primary').last()
  await confirm.waitFor({ state: 'visible', timeout: 3000 })
  await confirm.click()
  await page.waitForTimeout(650)
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
  await setFamilyCategory(page, 'custom')
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

  const suffix = Date.now().toString(36).slice(-6)
  const redName = `分类隔离红事-${suffix}`
  const redEvent = await page.evaluate(async ({ name, startDateTime, endDateTime }) => {
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        startDateTime,
        endDateTime,
        passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        theme: 'theme-festive',
        category: 'red',
        template: '婚宴',
        coverStyle: 'shuangxi',
        totalAmount: 0,
      }),
    })
    return response.json()
  }, {
    name: redName,
    startDateTime: `${dateInput(0)}T08:00`,
    endDateTime: `${dateInput(2)}T20:00`,
  })
  check('分类回归红事账簿已创建', redEvent?.success === true, redEvent?.message || redEvent?.data?.id || '-')

  await switchCategoryTo(page, 'red')
  check('红事分类显示红事账簿', await page.locator('.recent-item').filter({ hasText: redName }).isVisible())
  await switchCategoryTo(page, 'custom')
  check(
    '切到自定义后不串入红事账簿',
    (await page.locator('.recent-item').filter({ hasText: redName }).count()) === 0,
  )

  await page.locator('#home-main-card').click()
  await page.locator('.tpl-card').first().waitFor({ state: 'visible' })
  check('自定义模板卡可见', (await page.locator('.tpl-card').count()) === 1)
  check('自定义模板使用暖色主题', (await page.locator('.tpl-card .ledger-cover').getAttribute('data-theme')) === 'custom')
  check('自定义模板页无横向溢出', (await overflow(page)) <= 1)
  await page.locator('.tpl-card').first().click()

  await page.locator('#setup-screen').waitFor({ state: 'visible' })
  check('创建页出现自定义模板名称', await page.locator('#event-template-name').isVisible())
  check('自定义创建页无横向溢出', (await overflow(page)) <= 1)
  const eventName = `秋季活动收款-${suffix}`
  await page.locator('#event-name').fill(eventName)
  await page.locator('#event-template-name').fill('活动收款')
  await page.locator('#start-date').fill(dateInput(0))
  await page.locator('#start-time').fill('18:00')
  await page.locator('#end-date').fill(dateInput(2))
  await page.locator('#event-location').fill('测试宴会厅')
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
  const coverPalette = await page.locator('#cover-style-grid .ledger-cover').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.dataset.style,
    bg: getComputedStyle(node).getPropertyValue('--cover-bg').trim(),
    gold: getComputedStyle(node).getPropertyValue('--cover-gold').trim(),
  })))
  check(
    '四款自定义封面均使用现有暖色系',
    coverPalette.length === 4
      && new Set(coverPalette.map((style) => style.bg)).size >= 3
      && coverPalette.every((style) => isWarm(parseHex(style.bg) || [])),
    coverPalette.map((style) => `${style.id}:${style.bg}`).join(' / '),
  )
  await page.screenshot({ path: join(OUT, '02-custom-setup.png'), fullPage: true })

  await page.locator('.setup-submit').click()
  await page.locator('#main-screen').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(900)
  await dismissLightModals(page)
  check('进入自定义账簿后使用暖色主题', await page.locator('body').evaluate((body) => body.classList.contains('theme-custom')))
  const themePalette = await page.locator('body').evaluate((body) => {
    const style = getComputedStyle(body)
    return {
      accent: style.getPropertyValue('--accent').trim(),
      paper: style.getPropertyValue('--paper').trim(),
      gold: style.getPropertyValue('--gold').trim(),
    }
  })
  check(
    '自定义页面主色、纸色与金线属于同一暖色体系',
    isWarm(parseHex(themePalette.accent) || [])
      && isWarm(parseHex(themePalette.paper) || [])
      && isWarm(parseHex(themePalette.gold) || []),
    `${themePalette.accent} / ${themePalette.paper} / ${themePalette.gold}`,
  )
  check('自定义录入页显示收款称谓', (await page.locator('#entry-panel').innerText()).includes('收款录入'))
  check('手机端自定义账簿仍显示打印与收款码', (await page.locator('#print-btn').isVisible()) && (await page.locator('#qr-show-btn').isVisible()))
  check('自定义账簿不显示来宾档案入口', (await page.locator('#guest-profile-btn').count()) === 0)
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

  await page.locator('#settings-btn').click()
  await page.locator('#modal').waitFor({ state: 'visible' })
  await page.locator('#edit-guest-btn').click()
  await page.locator('#gb-guest-panel').waitFor({ state: 'visible', timeout: 5000 })
  const firstGuestLink = await page.locator('#gb-guest-link-input').inputValue()
  const firstToken = new URL(firstGuestLink).searchParams.get('gift')
  check('宾客登记页显示账簿有效期', (await page.locator('#gb-guest-panel .gb-guest-validity').innerText()).includes('有效至'))
  await page.locator('[data-guest-share]').click()
  await page.locator('.gb-guest-qr-card').waitFor({ state: 'visible', timeout: 10000 })
  check('二维码生成页提示手机长按海报保存', (await page.locator('#gb-guest-qr-save-hint').innerText()).includes('手机长按海报保存到相册'))
  await page.waitForFunction(() => {
    const image = document.querySelector('#gb-guest-qr-poster')
    return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
  }, null, { timeout: 10000 })
  const qrImageSize = await page.locator('#gb-guest-qr-poster').evaluate((image) => ({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    width: image.getAttribute('width'),
    height: image.getAttribute('height'),
    title: image.dataset.title,
    time: image.dataset.time,
    location: image.dataset.location,
    source: image.src.slice(0, 30),
  }))
  check(
    '保存项是高清竖版二维码海报',
    qrImageSize.naturalWidth === 1200
      && qrImageSize.naturalHeight === 1800
      && qrImageSize.width === '1200'
      && qrImageSize.height === '1800'
      && qrImageSize.source.startsWith('data:image/png'),
    `${qrImageSize.naturalWidth}×${qrImageSize.naturalHeight}, attr=${qrImageSize.width}×${qrImageSize.height}`,
  )
  check('海报纳入账簿标题', qrImageSize.title === eventName, qrImageSize.title)
  check('海报纳入时间和地址', qrImageSize.time.includes('18:00') && qrImageSize.location === '测试宴会厅', `${qrImageSize.time} / ${qrImageSize.location}`)
  check('提供下载海报按钮', await page.locator('.gb-guest-qr-download').isVisible())
  const posterDownloadPromise = page.waitForEvent('download', { timeout: 15000 })
  await page.locator('.gb-guest-qr-download').click()
  const posterDownload = await posterDownloadPromise
  const posterPath = join(OUT, '02d-guest-qr-poster.png')
  await posterDownload.saveAs(posterPath)
  check('完整海报可下载为图片', statSync(posterPath).size > 150_000, `${statSync(posterPath).size}B`)
  check('二维码生成页显示截止时间', (await page.locator('.gb-guest-qr-validity').innerText()).includes('有效至'))
  await page.screenshot({ path: join(OUT, '02c-guest-qr.png'), fullPage: true })
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).click()
  await page.locator('#modal-content').getByText('旧二维码和旧链接会立即失效').waitFor({ state: 'visible' })
  await page.locator('#modal-actions .modal-btn-primary').last().click()
  await page.locator('.gb-guest-qr-card').waitFor({ state: 'visible', timeout: 10000 })
  const rotated = await page.evaluate(async (eventId) => {
    const response = await fetch(`/api/events/${eventId}/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    return response.json()
  }, savedEvent.id)
  const rotatedLink = rotated?.data?.url ? new URL(rotated.data.url, BASE).href : ''
  const rotatedToken = rotatedLink ? new URL(rotatedLink).searchParams.get('gift') : ''
  check('可重新生成宾客二维码并更换令牌', Boolean(firstToken) && Boolean(rotatedToken) && firstToken !== rotatedToken)
  const oldGuestStatus = (await context.request.get(`${BASE}/api/guest/${firstToken}`)).status()
  const newGuestStatus = (await context.request.get(`${BASE}/api/guest/${rotatedToken}`)).status()
  check('重新生成后旧二维码失效、新二维码可用', oldGuestStatus === 404 && newGuestStatus === 200, `${oldGuestStatus} → ${newGuestStatus}`)
  await page.locator('#modal-actions button').filter({ hasText: /^关闭$/ }).click()

  await page.locator('#stats-btn').click()
  await page.locator('#modal').waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
  const statsText = await page.locator('#modal-content').innerText()
  const statsActionsText = await page.locator('#modal-actions').innerText()
  check('自定义统计使用收款口径', statsText.includes('总收款金额') && statsText.includes('人均收款'))
  check(
    '自定义统计不混入人情往来、年度报告与跨账簿汇总',
    !statsText.includes('人情往来')
      && !statsText.includes('已回礼')
      && !statsText.includes('年度报告')
      && !statsActionsText.includes('跨账簿汇总'),
  )
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
  check('公开扫码页显示登记入口截止时间', guestText.includes('登记入口有效至'))
  check('公开扫码页无需进入 NAS 管理后台', guestPage.url().includes('?gift=') && !guestPage.url().includes('/admin'))
  await guestPage.locator('#guest-name').fill('扫码付款人')
  await guestPage.locator('#guest-amount').fill('10.50')
  await guestPage.getByRole('button', { name: '提交登记' }).click()
  await guestPage.getByText('登记成功').waitFor({ state: 'visible', timeout: 5000 })
  check('扫码提交成功后使用收款账簿提示', (await guestPage.locator('.gb-guest-done').innerText()).includes('收款账簿'))
  check('手机扫码可提交小额收款', true)
  await guestPage.screenshot({ path: join(OUT, '05-custom-guest.png'), fullPage: true })

  await page.locator('.main-back').click()
  await page.locator('#home-screen').waitFor({ state: 'visible', timeout: 5000 })
  check(
    '自定义首页只显示自定义账簿',
    (await page.locator('.recent-item').filter({ hasText: eventName }).count()) === 1
      && (await page.locator('.recent-item').filter({ hasText: redName }).count()) === 0,
  )
  await switchCategoryTo(page, 'red')
  check(
    '红事首页只显示红事账簿',
    (await page.locator('.recent-item').filter({ hasText: redName }).count()) === 1
      && (await page.locator('.recent-item').filter({ hasText: eventName }).count()) === 0,
  )
  await switchCategoryTo(page, 'custom')
  check(
    '往返切换分类后账簿仍各自独立',
    (await page.locator('.recent-item').filter({ hasText: eventName }).count()) === 1
      && (await page.locator('.recent-item').filter({ hasText: redName }).count()) === 0,
  )

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
