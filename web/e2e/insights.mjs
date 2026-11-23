// 新增洞察能力回归：操作人、异常核对、来宾档案、年度报告、备份健康中心与多分辨率弹窗。
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const OUT = process.env.SHOT_DIR || join('..', '.shots', 'insights')
const DEFAULT_VIEWPORTS = [['375', 375, 812], ['390-second', 390, 844], ['768', 768, 1024]]
const VIEWPORTS = process.env.INSIGHT_VIEWPORTS
  ? process.env.INSIGHT_VIEWPORTS.split(',').map((item) => DEFAULT_VIEWPORTS.find(([label]) => label === item.trim())).filter(Boolean)
  : DEFAULT_VIEWPORTS
mkdirSync(OUT, { recursive: true })

const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium.executablePath(),
].find((candidate) => candidate && existsSync(candidate))
if (!browserPath) throw new Error('找不到 Edge/Chromium，请设置 E2E_BROWSER')

const browser = await chromium.launch({ executablePath: browserPath, headless: true })
const failures = []
let currentPage = null
let pageErrors = []

function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
}

async function dismiss(page) {
  for (let index = 0; index < 6; index += 1) {
    if (!(await page.locator('#modal-container').count())) return
    const skip = page.getByText('暂不开启', { exact: true }).first()
    if (await skip.count()) {
      await skip.click({ force: true }).catch(() => {})
      await page.waitForTimeout(180)
      continue
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

async function settleModal(page) {
  await page.waitForTimeout(360)
  await dismiss(page)
  await page.waitForTimeout(120)
}

async function createLedger(page, name) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await dismiss(page)
  await page.locator('#home-create-btn').click()
  await page.locator('#setup-screen').waitFor({ state: 'visible' })
  await page.locator('#event-name').fill(name)
  await page.locator('#start-date').fill('2026-11-01')
  await page.locator('#end-date').fill('2026-12-31')
  await page.locator('.setup-submit').click()
  await page.locator('#main-screen').waitFor({ state: 'visible', timeout: 30000 })
  // 建账后的自动备份引导固定延迟 900ms 打开，等它出现并关闭后再进入业务操作。
  await page.waitForTimeout(1300)
  await dismiss(page)
}

async function createLedgerFromHome(page, name) {
  await page.locator('#home-create-btn').click()
  await page.locator('#setup-screen').waitFor({ state: 'visible' })
  await page.locator('#event-name').fill(name)
  await page.locator('#start-date').fill('2026-11-01')
  await page.locator('#end-date').fill('2026-12-31')
  await page.locator('.setup-submit').click()
  await page.locator('#main-screen').waitFor({ state: 'visible', timeout: 30000 })
  await settleModal(page)
}

async function addGift(page, name, amount) {
  // 首次录入后可能弹出自动备份引导；先清干净遮罩再操作表单。
  await settleModal(page)
  await page.locator('#guest-name').fill(name)
  await page.locator('#gift-amount').fill(String(amount))
  await page.locator('#submit-gift-btn').click()
  const confirm = page.locator('#modal-actions button').filter({ hasText: /^确定$/ }).last()
  await confirm.waitFor({ state: 'visible', timeout: 4000 })
  await confirm.click({ force: true })
  await page.locator('#gift-book-content .name-cell .name').first().waitFor({ state: 'visible', timeout: 15000 })
  await settleModal(page)
}

async function modalFits(page, width, height) {
  // 移动端从底部托起有 260ms 入场动画，等动画结束再检查最终布局。
  await page.waitForTimeout(360)
  const box = await page.locator('#modal').boundingBox()
  return Boolean(box) && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1
}

async function enter(page, label) {
  console.log('…', label)
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  currentPage = page
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push((error.stack || error.message).slice(0, 3000)))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text().slice(0, 3000))
  })

  const firstEventName = `洞察回归-${Date.now().toString(36).slice(-5)}`
  await createLedger(page, firstEventName)

  await page.locator('.operator-chip').click()
  await page.locator('#gb-operator-name').fill('账房甲')
  await page.getByText('使用此名称', { exact: true }).click()
  await page.waitForTimeout(250)
  const operatorText = await page.locator('.operator-chip').textContent()
  check('操作人可切换并回显', operatorText.includes('账房甲'), operatorText)

  await enter(page, '录入大额记录')
  await addGift(page, '测试客', 6000)
  check('大额记录进入核对队列', await page.locator('#review-btn .main-tool-badge').isVisible())

  await enter(page, '核对操作人修改痕迹')
  await page.locator('#gift-book-content .name-cell').first().click()
  await page.locator('[data-details-index]').waitFor({ state: 'visible' })
  check('详情显示录入操作人', (await page.locator('[data-details-index]').textContent()).includes('账房甲'))
  await page.locator('[data-edit="remarks"]').click()
  await page.locator('#inline-edit-remarks').fill('经过手机端复核')
  await page.locator('[data-save]').click()
  await page.locator('.gb-timeline-operator').waitFor({ state: 'visible', timeout: 10000 })
  check('修改历史保留操作人', (await page.locator('.gb-timeline-operator').first().textContent()).includes('账房甲'))
  await page.screenshot({ path: join(OUT, '390-operator-history.png') })
  await page.locator('#modal-close').click()
  await page.waitForTimeout(250)

  await enter(page, '打开异常核对')
  await page.locator('#review-btn').click()
  await page.locator('.gb-review-queue').waitFor({ state: 'visible' })
  check('异常核对面板可见', await page.getByText('大额礼金', { exact: true }).first().isVisible())
  check('异常核对弹窗不超出手机屏幕', await modalFits(page, 390, 844))
  await page.getByText('已核对', { exact: true }).first().click()
  await page.waitForTimeout(250)
  check('标为已核对后队列清空', (await page.locator('.gb-review-queue').textContent()).includes('本轮异常已核对完'))
  await page.locator('#modal-close').click()
  await page.waitForTimeout(250)
  check('已核对后工具栏徽标消失', !(await page.locator('#review-btn .main-tool-badge').count()))
  await page.locator('#review-btn').click()
  await page.locator('.gb-review-queue').waitFor({ state: 'visible' })
  await page.getByText('重新显示已核对记录', { exact: true }).click()
  check('可恢复已核对记录', await page.getByText('大额礼金', { exact: true }).first().isVisible())
  await page.locator('#modal-close').click()
  await page.waitForTimeout(250)

  await enter(page, '打开年度报告')
  await page.locator('#stats-btn').click()
  await page.locator('#annual-report-btn').waitFor({ state: 'visible' })
  await page.locator('#annual-report-btn').click()
  await page.locator('.gb-annual-report').waitFor({ state: 'visible' })
  check('年度报告可见且包含年度金额', await page.getByText('年度礼金', { exact: true }).isVisible())
  check('年度报告弹窗不超出手机屏幕', await modalFits(page, 390, 844))
  await page.screenshot({ path: join(OUT, '390-annual-report.png') })
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '打印 / 保存为 PDF' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  check('年度报告可打开打印页', (await popup.title()).includes('年度人情报告'), await popup.title())
  await popup.close()
  await page.locator('#modal-close').click()
  await page.waitForTimeout(250)

  await enter(page, '查看来宾档案')
  await page.locator('#guest-profile-btn').click()
  await page.locator('.gb-profile-panel').waitFor({ state: 'visible' })
  await page.locator('.gb-profile-person').first().waitFor({ state: 'visible', timeout: 15000 })
  check('来宾档案聚合当前账簿', (await page.locator('.gb-profile-panel').textContent()).includes('测试客'))
  check('来宾档案弹窗不超出手机屏幕', await modalFits(page, 390, 844))
  await page.screenshot({ path: join(OUT, '390-guest-profile.png') })
  await page.locator('#modal-close').click()
  await page.waitForTimeout(250)

  await enter(page, '打开备份健康中心')
  await page.locator('.main-back').click()
  await page.locator('#home-settings-btn').waitFor({ state: 'visible' })
  await page.locator('#home-settings-btn').click()
  await page.locator('[data-settings-act="backuphealth"]').waitFor({ state: 'visible' })
  await page.locator('[data-settings-act="backuphealth"]').click()
  await page.locator('.gb-backup-health').waitFor({ state: 'visible' })
  check('备份健康中心可见', (await page.locator('.gb-backup-health').textContent()).includes('备份健康中心'))
  check('备份健康中心弹窗不超出手机屏幕', await modalFits(page, 390, 844))
  await page.screenshot({ path: join(OUT, '390-backup-health.png') })
  await page.locator('#modal-close').click()

  await enter(page, '创建第二本账簿并验证跨簿档案')
  const secondEventName = `第二账簿-${Date.now().toString(36).slice(-4)}`
  await createLedgerFromHome(page, secondEventName)
  await addGift(page, '测试客', 100)
  await page.locator('#guest-profile-btn').click()
  await page.locator('.gb-profile-panel').waitFor({ state: 'visible' })
  await page.locator('.gb-profile-person').first().waitFor({ state: 'visible', timeout: 15000 })
  const profileText = await page.locator('.gb-profile-panel').textContent()
  check('来宾档案汇总两本已解锁账簿', profileText.includes(firstEventName) && profileText.includes(secondEventName), `${firstEventName} / ${secondEventName}`)
  check('跨簿档案弹窗不超出手机屏幕', await modalFits(page, 390, 844))
  await page.locator('#modal-close').click()
  check('新增功能无浏览器错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  await context.close()

  for (const [label, width, height] of VIEWPORTS) {
    await enter(page, `响应式 ${label}`)
    const extra = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: true })
    const view = await extra.newPage()
    currentPage = view
    await enter(view, `${label} 创建账簿`)
    await createLedger(view, `响应式-${label}-${Date.now().toString(36).slice(-4)}`)
    await enter(view, `${label} 录入礼金`)
    await addGift(view, '多分辨率来宾', 5000)
    const overflow = await view.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth))
    check(`${label} 记账页无横向溢出`, overflow <= 1, String(overflow))
    await enter(view, `${label} 打开核对面板`)
    await view.locator('#review-btn').click()
    await view.locator('.gb-review-queue').waitFor({ state: 'visible' })
    const reviewOverflow = await view.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth))
    check(`${label} 核对面板无横向溢出`, reviewOverflow <= 1, String(reviewOverflow))
    check(`${label} 核对面板未超出屏幕`, await modalFits(view, width, height))
    await view.locator('#modal-close').click()
    await extra.close()
  }
} catch (error) {
  check('新增功能核心链路', false, error.message.split('\n')[0])
  console.error(error.stack)
  if (currentPage) await currentPage.screenshot({ path: join(OUT, 'failure.png'), fullPage: true }).catch(() => {})
  if (pageErrors.length) console.error('page errors:', pageErrors.slice(0, 2).join('\n'))
} finally {
  await browser.close()
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
}
