// 多分辨率核心链路回归：首页 → 模板 → 创建 → 记账 → 录入确认 → 统计弹窗。
// 用法：先启动隔离实例，再 BASE_URL=http://127.0.0.1:18199 node e2e/responsive.mjs
import { existsSync, mkdirSync } from 'node:fs'
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

    const unique = `${name}-${Date.now().toString(36).slice(-6)}`
    await page.locator('#event-name').fill(unique)
    await page.locator('#event-location').fill('多分辨率回归厅')
    await page.locator('#start-date').fill('2026-11-20')
    await page.locator('#end-date').fill('2026-11-22')
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
        `${name} 手机端隐藏打印与收款码`,
        !(await page.locator('#print-btn').isVisible()) && !(await page.locator('#qr-show-btn').isVisible()),
      )
      check(`${name} 手机端保留 8 个工具入口`, (await page.locator('.main-tools .main-tool:visible').count()) === 8)
    } else {
      check(
        `${name} 宽屏保留打印与收款码`,
        (await page.locator('#print-btn').isVisible()) && (await page.locator('#qr-show-btn').isVisible()),
      )
    }
    check(`${name} 首页与记账页无横向溢出`, (await horizontalOverflow(page)) <= 1, String(await horizontalOverflow(page)))
    const mainTargets = await auditInteractiveTargets(page)
    check(`${name} 记账页触控目标不小于 44px`, mainTargets.length === 0, mainTargets.join(' | '))
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

await browser.close()
console.log(`\n结果：${results.filter((item) => item.ok).length}/${results.length} 通过，截图目录 ${OUT}`)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
