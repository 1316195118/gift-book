// 主链路冒烟：建账 → 录入 → 同名重复确认 → 服务端近邻提醒 → 占位删除/撤销 → 统计/导出。
// 用法：先启动本地服务（默认 http://127.0.0.1:18199），再 `node e2e/smoke.mjs`；BASE_URL 可覆盖。
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push((e.stack || e.message).split('\n')[0]))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)) })
const step = async (name, fn) => {
  await fn()
  console.log('ok:', name)
}
const dismiss = async () => {
  for (let i = 0; i < 3; i += 1) {
    if (!(await page.locator('#modal-container').count())) return
    const s = page.getByText('暂不开启', { exact: true }).first()
    if (await s.count()) { await s.click({ force: true }).catch(() => {}); await page.waitForTimeout(250); continue }
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  }
}
try {
  await step('打开首页', async () => { await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await dismiss() })
  await step('创建账簿', async () => {
    await page.getByText('创建新账簿').last().click(); await page.waitForTimeout(500)
    await page.locator('#event-name').fill('E2E 冒烟')
    await page.locator('#start-date').fill('2026-11-17')
    await page.locator('#end-date').fill('2026-11-18')
    await page.locator('.setup-submit').click(); await page.waitForTimeout(1600); await dismiss()
  })
  await step('表单默认折叠（手机视口）', async () => {
    if (await page.locator('.entry-more-fields').isVisible()) throw new Error('手机视口应默认收起更多选项')
  })
  const add = async (name, amount) => {
    await page.locator('#guest-name').fill(name)
    await page.locator('#gift-amount').fill(String(amount))
    await page.locator('#submit-gift-btn').click(); await page.waitForTimeout(300)
    const ok = page.getByText('确认提交', { exact: true }).first()
    if (await ok.count()) await ok.click()
    await page.waitForTimeout(900)
  }
  await step('第一笔录入', async () => { await add('测试客', 300) })
  await step('同名同额触发重复确认', async () => {
    await page.locator('#guest-name').fill('测试客')
    await page.locator('#gift-amount').fill('300')
    await page.locator('#submit-gift-btn').click(); await page.waitForTimeout(300)
    if (!(await page.getByText('重复信息确认').count())) throw new Error('未出现重复确认')
    const ok = page.getByText('确认提交', { exact: true }).first()
    if (await ok.count()) await ok.click()
    await page.waitForTimeout(900)
  })
  await step('服务端近邻提醒', async () => {
    if (!(await page.getByText('可能重复录入').count())) throw new Error('未出现近邻提醒')
  })
  await step('占位删除可撤销', async () => {
    await page.locator('#submit-blank-btn').click(); await page.waitForTimeout(500)
    await page.getByText('跳过并占位', { exact: true }).first().click({ force: true }); await page.waitForTimeout(900)
    await page.locator('#gift-book-content .name-cell').filter({ hasText: '跳过' }).first().click({ force: true }); await page.waitForTimeout(700)
    await page.getByText('删除这一行', { exact: true }).first().click({ force: true }); await page.waitForTimeout(700)
    await page.locator('.modal-btn-danger').last().click({ force: true }); await page.waitForTimeout(900)
    if (!(await page.getByText('撤销', { exact: true }).first().count())) throw new Error('无撤销按钮')
    await page.getByText('撤销', { exact: true }).first().click(); await page.waitForTimeout(900)
    if (!(await page.locator('#gift-book-content .name-cell').filter({ hasText: '跳过' }).first().count())) throw new Error('撤销后未恢复')
  })
  await step('统计弹窗', async () => {
    await page.getByText('统计', { exact: true }).first().click(); await page.waitForTimeout(500)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  })
  await step('导出弹窗', async () => {
    await page.getByText('导出', { exact: true }).first().click(); await page.waitForTimeout(500)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  })
} catch (error) {
  console.error('FAIL:', error.message.split('\n')[0])
  errors.push('STEPFAIL ' + error.message.split('\n')[0])
} finally {
  console.log('errors:', errors.length ? errors.join('\n') : 'none')
  await browser.close()
  if (errors.length) process.exit(1)
}
