// 多分辨率核心链路回归：首页 → 模板 → 创建 → 记账 → 录入确认 → 统计弹窗。
// 用法：先启动隔离实例，再 BASE_URL=http://127.0.0.1:18199 node e2e/responsive.mjs
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const OUT = process.env.SHOT_DIR || join('..', '.shots', 'responsive')
mkdirSync(OUT, { recursive: true })

const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium.executablePath(),
].find((candidate) => candidate && existsSync(candidate))
if (!browserPath) throw new Error('找不到浏览器：请先运行 playwright-core install chromium，或设置 E2E_BROWSER')

const browser = await chromium.launch({ executablePath: browserPath, headless: true })
const allViewports = [
  ['small-phone', 320, 568],
  ['phone-375', 375, 812],
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['landscape-phone', 844, 390],
  ['desktop-compact', 1024, 768],
  ['desktop', 1440, 900],
]
const wanted = new Set(String(process.env.VIEWPORTS || '').split(',').map((value) => value.trim()).filter(Boolean))
const viewports = wanted.size ? allViewports.filter(([name]) => wanted.has(name)) : allViewports
const results = []
const failures = []

function dateInput(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
}

async function dismissLightModals(page) {
  for (let i = 0; i < 3; i += 1) {
    if (!(await page.locator('#modal-container').count())) return
    const skip = page.getByText('暂不开启', { exact: true }).first()
    if (await skip.count()) {
      await skip.click({ force: true }).catch(() => {})
      await page.waitForTimeout(220)
      continue
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(180)
  }
}

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement
    return Math.max(0, de.scrollWidth - de.clientWidth)
  })
}

async function ensureSetupScreen(page) {
  const setup = page.locator('#setup-screen')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await setup.isVisible()) {
      await page.waitForTimeout(250)
      if (await setup.isVisible()) return
    }
    if (await page.locator('.tpl-card').first().isVisible()) {
      await page.locator('.tpl-card').first().click()
    } else if (await page.locator('#home-main-card').isVisible()) {
      await page.locator('#home-main-card').click()
      await page.locator('.tpl-card').first().waitFor({ state: 'visible', timeout: 5000 })
      await page.locator('.tpl-card').first().click()
    }
    await setup.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
  }
}

async function ensureTemplateScreen(page) {
  const template = page.locator('.tpl-card').first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await template.isVisible()) return
    if (await page.locator('#home-main-card').isVisible()) {
      await page.locator('#home-main-card').click()
    }
    await template.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(300)
  }
}

async function auditInteractiveTargets(page) {
  return page.evaluate(() => {
    const seen = []
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue
      if (rect.width < 44 || rect.height < 44) {
        const text = String(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
        const label = el.getAttribute('aria-label') || el.getAttribute('title') || ''
        seen.push(`${el.tagName.toLowerCase()}#${el.id || ''}.${String(el.className || '').replace(/\s+/g, '.')} ${Math.round(rect.width)}×${Math.round(rect.height)} "${text}" ${label}`)
      }
    }
    return seen.slice(0, 16)
  })
}

async function auditImages(page) {
  return page.evaluate(() => {
    const issues = []
    for (const el of document.querySelectorAll('img')) {
      if (!el.hasAttribute('alt')) issues.push(`${el.src.slice(0, 80)} 缺少 alt`)
      const rect = el.getBoundingClientRect()
      if (rect.width && rect.height && (!el.hasAttribute('width') || !el.hasAttribute('height'))) {
        issues.push(`${el.alt || '(空 alt)'} 缺少尺寸`)
      }
    }
    return issues.slice(0, 8)
  })
}

function blockerInfo(el) {
  const rect = el.getBoundingClientRect()
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  if (hit && (hit === el || el.contains(hit))) return ''
  const style = hit ? getComputedStyle(hit) : null
  const parent = hit?.parentElement
  const label = hit
    ? `${hit.tagName}#${hit.id || ''}.${String(hit.className || '').split(' ').slice(0, 2).join('.')}`
    : '?'
  const text = String(hit?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const modal = String(document.querySelector('#modal-container')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100)
  return `${label} [${style?.position || ''}] ${text}${modal ? ` modal=${modal}` : ''}${parent ? ` parent=${parent.tagName}.${String(parent.className || '').slice(0, 30)}` : ''}`
}

for (const [name, width, height] of viewports) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 768,
    hasTouch: width < 1024,
  })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('giftbook_category', 'red')
      localStorage.setItem('giftbook-backup-prompted', '1')
    } catch { /* ignore */ }
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push((error.stack || error.message).split('\n')[0]))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 160))
  })

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await dismissLightModals(page)

    // 允许脚本在任意上次分类状态下开始，统一切回红事。
    if (!(await page.locator('[data-cat="red"]').evaluate((el) => el.classList.contains('active')))) {
      await page.locator('[data-cat="red"]').click()
      await page.waitForTimeout(250)
      const confirm = page.locator('#modal-actions .modal-btn-primary').last()
      if (await confirm.count()) await confirm.click()
      await page.waitForTimeout(350)
    }

    const homeVisible = await page.locator('#home-main-card').isVisible()
    check(`${name} 首页主卡片可见`, homeVisible)
    check(`${name} 首页无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    const homeTargets = await auditInteractiveTargets(page)
    check(`${name} 首页触控目标不小于 44px`, homeTargets.length === 0, homeTargets.join(' | '))
    const homeImages = await auditImages(page)
    check(`${name} 首页图片语义完整`, homeImages.length === 0, homeImages.join(' | '))
    await page.screenshot({ path: join(OUT, `${name}-01-home.png`), fullPage: true })

    await ensureTemplateScreen(page)
    check(`${name} 模板页可见`, await page.locator('.tpl-card').first().isVisible())
    check(`${name} 模板页无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    const templateCovers = await page.locator('.tpl-card .ledger-cover').evaluateAll((nodes) => nodes.map((node) => [
      node.dataset.style,
      node.dataset.template,
      node.dataset.frame,
      node.dataset.layout,
      Boolean(node.querySelector('.cover-motif')),
    ].join('|')))
    check(
      `${name} 模板封面款式互不重复`,
      templateCovers.length === 5 && new Set(templateCovers).size === templateCovers.length,
      templateCovers.join(' / '),
    )
    const templateArtLoaded = await page.locator('.tpl-card .cover-art').evaluateAll((images) =>
      images.length === 5 && images.every((image) => image.complete && image.naturalWidth > 0))
    check(`${name} 模板原创底图已解码`, templateArtLoaded)
    const templateLayout = await page.locator('.tpl-card').evaluateAll((cards) =>
      cards.map((card) => {
        const cover = card.querySelector('.ledger-cover')
        const medallion = cover.querySelector('.cover-medallion')
        const topLabel = cover.querySelector('.cover-toplabel')
        const coverBox = cover.getBoundingClientRect()
        const medallionBox = medallion?.getBoundingClientRect()
        return {
          text: card.querySelector('h3')?.textContent?.trim() || '',
          topLabelHidden: !topLabel || getComputedStyle(topLabel).display === 'none',
          medallionTopRatio: medallionBox ? medallionBox.top - coverBox.top : null,
          coverHeight: coverBox.height,
        }
      }))
    check(
      `${name} 模板文字与圆章不贴顶`,
      templateLayout.every((item) =>
        item.topLabelHidden
        && (item.medallionTopRatio === null || item.medallionTopRatio >= item.coverHeight * 0.18)),
      templateLayout.map((item) => `${item.text}:${item.medallionTopRatio === null ? '无圆章' : Math.round(item.medallionTopRatio)}`).join(' / '),
    )
    const templateBack = page.getByRole('button', { name: '返回首页' })
    const templateBackBox = await templateBack.boundingBox()
    check(
      `${name} 模板返回首页可键盘聚焦`,
      (await templateBack.count()) === 1 && Boolean(templateBackBox) && templateBackBox.height >= 44,
      templateBackBox ? `${Math.round(templateBackBox.width)}×${Math.round(templateBackBox.height)}` : 'no box',
    )
    const templateTargets = await auditInteractiveTargets(page)
    check(`${name} 模板页触控目标不小于 44px`, templateTargets.length === 0, templateTargets.join(' | '))

    await ensureSetupScreen(page)
    check(`${name} 创建页可见`, await page.locator('#setup-screen').isVisible())
    check(`${name} 创建页无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    const setupBack = page.getByRole('button', { name: '返回首页' })
    const setupBackBox = await setupBack.boundingBox()
    check(
      `${name} 创建页返回首页可键盘聚焦`,
      (await setupBack.count()) === 1 && Boolean(setupBackBox) && setupBackBox.height >= 44,
      setupBackBox ? `${Math.round(setupBackBox.width)}×${Math.round(setupBackBox.height)}` : 'no box',
    )
    const setupTargets = await auditInteractiveTargets(page)
    check(`${name} 创建页触控目标不小于 44px`, setupTargets.length === 0, setupTargets.join(' | '))
    await page.screenshot({ path: join(OUT, `${name}-02-setup.png`), fullPage: true })
    await page.locator('.setup-more-summary').click()
    await page.locator('#cover-style-grid').waitFor({ state: 'visible' })
    const coverStyleIds = await page.locator('#cover-style-grid .cover-style-item').evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('.ledger-cover')?.dataset.style || ''))
    check(
      `${name} 红事封面款式完整且互不重复`,
      coverStyleIds.length === 16 && new Set(coverStyleIds).size === 16,
      coverStyleIds.join(' / '),
    )
    check(
      `${name} 封面缩略图带场景纹样`,
      (await page.locator('#cover-style-grid .cover-motif').count()) === coverStyleIds.length,
    )
    check(
      `${name} 红事封面原创底图已解码`,
      await page.locator('#cover-style-grid .cover-art').evaluateAll((images) =>
        images.length === 16 && images.every((image) => image.complete && image.naturalWidth > 0)),
    )
    await page.screenshot({ path: join(OUT, `${name}-02b-cover-styles.png`), fullPage: true })
    await page.locator('.setup-more-summary').click()

    const unique = `${name}-${Date.now().toString(36).slice(-6)}`
    await page.locator('#event-name').fill(unique)
    await page.locator('#event-location').fill('多分辨率回归厅')
    await page.locator('#start-date').fill(dateInput(0))
    await page.locator('#end-date').fill(dateInput(2))
    await page.locator('.setup-submit').click()
    await page.locator('#main-screen').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(500)
    await dismissLightModals(page)
    // 首次创建账簿后，自动备份引导可能稍后弹出；主动等它一轮并跳过。
    await page.waitForTimeout(900)
    await dismissLightModals(page)

    check(`${name} 记账页可见`, await page.locator('#entry-panel').isVisible())
    check(`${name} 核心工具栏可见`, await page.locator('.main-tools').isVisible())
    if (width <= 640) {
      check(
        `${name} 手机端显示打印与收款码`,
        (await page.locator('#print-btn').isVisible()) && (await page.locator('#qr-show-btn').isVisible()),
      )
      check(`${name} 手机端保留 10 个工具入口`, (await page.locator('.main-tools .main-tool:visible').count()) === 10)
    } else {
      check(
        `${name} 宽屏保留打印与收款码`,
        (await page.locator('#print-btn').isVisible()) && (await page.locator('#qr-show-btn').isVisible()),
      )
    }
    check(`${name} 首页与记账页无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    const mainTargets = await auditInteractiveTargets(page)
    check(`${name} 记账页触控目标不小于 44px`, mainTargets.length === 0, mainTargets.join(' | '))
    check(
      `${name} 空账簿不同时显示页码与空白明细`,
      (await page.locator('.book-empty').isVisible())
        && !(await page.locator('.book-navigation').isVisible())
        && !(await page.locator('.book-scroll').isVisible()),
    )
    const submit = page.locator('#submit-gift-btn')
    await submit.scrollIntoViewIfNeeded()
    const blocker = await submit.evaluate(blockerInfo)
    check(`${name} 确认录入按钮无遮挡`, !blocker, blocker)
    await page.screenshot({ path: join(OUT, `${name}-03-main.png`), fullPage: true })

    await page.locator('#guest-name').fill('测试来宾')
    await page.locator('#gift-amount').fill('888')
    await dismissLightModals(page)
    await submit.scrollIntoViewIfNeeded()
    const blockerAfterFill = await submit.evaluate(blockerInfo)
    check(`${name} 填表后按钮仍可点击`, !blockerAfterFill, blockerAfterFill)
    await submit.click({ force: true })
    const confirmButton = page.locator('#modal-actions button').filter({ hasText: /^确定$/ }).last()
    await confirmButton.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
    if (!(await confirmButton.count())) {
      const message = await page.locator('#modal-content, .toast, .sync-status').allTextContents()
      throw new Error(`提交后未出现确认框：${message.join(' / ').slice(0, 160)}`)
    }
    await confirmButton.click({ force: true })
    await page.locator('#gift-book-content .name-cell .name').first().waitFor({ state: 'visible', timeout: 15000 })
    check(`${name} 录入后无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    await page.screenshot({ path: join(OUT, `${name}-04-filled.png`), fullPage: true })

    await page.locator('#export-btn').click()
    await page.locator('#modal').waitFor({ state: 'visible' })
    await page.locator('.export-option').filter({ hasText: 'PDF' }).click()
    await page.locator('.pdf-cover-picker').waitFor({ state: 'visible', timeout: 5000 })
    const pdfCovers = page.locator('.pdf-cover-choice')
    check(`${name} PDF 封面可选完整红事款式`, (await pdfCovers.count()) === 16)
    const beforePreview = await page.locator('#pdf-cover-preview .ledger-cover').getAttribute('data-style')
    await pdfCovers.nth(1).click()
    const afterPreview = await page.locator('#pdf-cover-preview .ledger-cover').getAttribute('data-style')
    check(`${name} PDF 封面预览跟随选择`, Boolean(beforePreview) && beforePreview !== afterPreview, `${beforePreview} → ${afterPreview}`)
    check(`${name} PDF 封面弹窗无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    await page.screenshot({ path: join(OUT, `${name}-04b-pdf-cover.png`), fullPage: true })
    if (name === 'phone') {
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 })
      await page.getByRole('button', { name: '生成 PDF', exact: true }).click()
      const download = await downloadPromise
      const pdfPath = join(OUT, 'phone-selected-cover.pdf')
      await download.saveAs(pdfPath)
      check(`${name} 选择的封面实际写入 PDF`, existsSync(pdfPath) && statSync(pdfPath).size > 10000, `${download.suggestedFilename()} ${existsSync(pdfPath) ? statSync(pdfPath).size : 0}B`)
    } else {
      await page.getByRole('button', { name: '取消', exact: true }).click()
    }
    await page.locator('#modal').waitFor({ state: 'hidden' })

    await page.locator('#stats-btn').click()
    await page.locator('#modal').waitFor({ state: 'visible' })
    await page.waitForTimeout(350)
    const modalBox = await page.locator('#modal').boundingBox()
    check(
      `${name} 统计弹窗未超出屏幕`,
      Boolean(modalBox) && modalBox.x >= -1 && modalBox.y >= -1
        && modalBox.x + modalBox.width <= width + 1
        && modalBox.y + modalBox.height <= height + 1,
      modalBox ? `${Math.round(modalBox.x)},${Math.round(modalBox.y)} ${Math.round(modalBox.width)}×${Math.round(modalBox.height)}` : 'no box',
    )
    await page.screenshot({ path: join(OUT, `${name}-05-stats.png`) })
    await page.locator('#modal-close').click()
    await page.waitForTimeout(250)

    await page.locator('.main-back').click()
    await page.locator('#home-screen').waitFor({ state: 'visible', timeout: 5000 })
    const recentCard = page.locator('.recent-item').filter({ hasText: unique }).first()
    const recentOpen = recentCard.getByRole('button', { name: `打开账簿「${unique}」` })
    const recentStructure = await recentCard.evaluate((el) => {
      const controls = [...el.querySelectorAll('button, a[href], [role="button"]')]
      return {
        outerRole: el.getAttribute('role'),
        controlCount: controls.length,
        nestedControl: controls.some((control) => control.parentElement?.closest('button, a[href], [role="button"]')),
      }
    })
    check(
      `${name} 最近账簿控件语义独立`,
      (await recentOpen.count()) === 1 && recentStructure.outerRole === null && recentStructure.controlCount === 2 && !recentStructure.nestedControl,
      JSON.stringify(recentStructure),
    )
    await recentOpen.focus()
    await page.keyboard.press('Space')
    await page.locator('#main-screen').waitFor({ state: 'visible', timeout: 5000 })
    check(`${name} 最近账簿可用空格键打开`, await page.locator('#main-screen').isVisible())

    check(`${name} 无浏览器错误`, errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (error) {
    check(`${name} 核心链路`, false, error.message.split('\n')[0])
  } finally {
    await context.close()
  }
}

// 白事单独从首页进入，避免红事主链路写下的本地状态影响分类。
for (const [name, width, height] of [['small-phone', 320, 568], ['desktop', 1440, 900]]) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width < 768,
    hasTouch: width < 1024,
  })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('giftbook_category', 'white')
      localStorage.setItem('giftbook-backup-prompted', '1')
    } catch { /* ignore */ }
  })
  const page = await context.newPage()
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await dismissLightModals(page)
    await ensureTemplateScreen(page)
    const whiteTemplates = await page.locator('.tpl-card .ledger-cover').evaluateAll((nodes) => nodes.map((node) => [
      node.dataset.style,
      node.dataset.theme,
      Boolean(node.querySelector('.cover-motif')),
    ].join('|')))
    check(
      `${name} 白事模板封面独立且纹样完整`,
      whiteTemplates.length === 5 && new Set(whiteTemplates).size === 5 && whiteTemplates.every((item) => item.includes('|white|true')),
      whiteTemplates.join(' / '),
    )
    await page.locator('.tpl-card').first().click()
    await page.locator('#setup-screen').waitFor({ state: 'visible' })
    await page.locator('.setup-more-summary').click()
    await page.locator('#cover-style-grid').waitFor({ state: 'visible' })
    const whiteStyles = await page.locator('#cover-style-grid .cover-style-item').evaluateAll((nodes) => nodes.map((node) => [
      node.querySelector('.ledger-cover')?.dataset.style || '',
      node.querySelector('.ledger-cover')?.dataset.theme || '',
      Boolean(node.querySelector('.cover-motif')),
    ].join('|')))
    check(
      `${name} 白事封面 12 款完整且无串色`,
      whiteStyles.length === 12 && new Set(whiteStyles).size === 12 && whiteStyles.every((item) => item.includes('|white|true')),
      whiteStyles.join(' / '),
    )
    check(
      `${name} 白事封面原创底图已解码`,
      await page.locator('#cover-style-grid .cover-art').evaluateAll((images) =>
        images.length === 12 && images.every((image) => image.complete && image.naturalWidth > 0)),
    )
    check(`${name} 白事封面页无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    await page.screenshot({ path: join(OUT, `${name}-solemn-cover-styles.png`), fullPage: true })
    if (name === 'desktop') {
      const whiteTitle = `白事封面回归-${Date.now().toString(36).slice(-6)}`
      await page.locator('#event-name').fill(whiteTitle)
      await page.locator('#event-location').fill('追思厅')
      await page.locator('#start-date').fill(dateInput(0))
      await page.locator('#end-date').fill(dateInput(2))
      await page.locator('.setup-submit').click()
      await page.locator('#main-screen').waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(1300)
      await dismissLightModals(page)
      check(`${name} 白事封面账簿可创建`, await page.locator('#main-screen').isVisible())
      await page.locator('#guest-name').fill('白事来宾')
      await page.locator('#gift-amount').fill('208')
      await page.locator('#submit-gift-btn').click()
      await page.locator('#modal').waitFor({ state: 'visible', timeout: 3000 })
      const confirm = page.locator('#modal-actions button').filter({ hasText: /^确定$/ }).last()
      await confirm.waitFor({ state: 'visible', timeout: 3000 })
      const whiteConfirmText = (await page.locator('#modal').innerText()).replace(/\s+/g, ' ').trim()
      check(`${name} 白事录入确认框内容正确`, /奠仪|208|白事来宾/.test(whiteConfirmText), whiteConfirmText.slice(0, 160))
      await confirm.click({ force: true })
      await page.waitForTimeout(2200)
      const whiteRows = await page.locator('#gift-book-content .name-cell .name').count()
      const whiteMessages = (await page.locator('#modal-content, .toast, .sync-status').allTextContents()).join(' / ').trim()
      check(`${name} 白事封面账簿可录入`, whiteRows > 0, whiteMessages || `rows=${whiteRows}`)
      if (!whiteRows) throw new Error(`白事首笔未出现${whiteMessages ? `：${whiteMessages.slice(0, 160)}` : ''}`)
      await page.locator('#export-btn').click()
      await page.locator('.export-option').filter({ hasText: 'PDF' }).click()
      await page.locator('.pdf-cover-picker').waitFor({ state: 'visible', timeout: 5000 })
      check(`${name} 白事 PDF 封面可选完整 12 款`, (await page.locator('.pdf-cover-choice').count()) === 12)
      await page.locator('.pdf-cover-choice').nth(7).click()
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 })
      await page.getByRole('button', { name: '生成 PDF', exact: true }).click()
      const download = await downloadPromise
      const pdfPath = join(OUT, 'desktop-solemn-selected-cover.pdf')
      await download.saveAs(pdfPath)
      check(`${name} 白事选择的封面实际写入 PDF`, existsSync(pdfPath) && statSync(pdfPath).size > 10000, `${download.suggestedFilename()} ${existsSync(pdfPath) ? statSync(pdfPath).size : 0}B`)
    }
  } catch (error) {
    check(`${name} 白事封面链路`, false, error.message.split('\n')[0])
  } finally {
    await context.close()
  }
}

await browser.close()
console.log(`\n结果：${results.filter((item) => item.ok).length}/${results.length} 通过，截图目录 ${OUT}`)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
