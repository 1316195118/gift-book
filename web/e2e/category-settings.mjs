// 首页分类显示偏好：设置开关、至少保留一项、隐藏当前分类、刷新后持久化。
// 用法：先启动隔离实例，再 BASE_URL=http://127.0.0.1:18199 node e2e/category-settings.mjs
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setFamilyCategory } from './prefs-helper.mjs'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const OUT = process.env.SHOT_DIR || join('..', '.shots', 'category-settings')
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

async function dismissLightModals(page) {
  for (let index = 0; index < 3; index += 1) {
    const skip = page.getByText('暂不开启', { exact: true }).first()
    if (await skip.count()) {
      await skip.click({ force: true }).catch(() => {})
      await page.waitForTimeout(150)
      continue
    }
    if (!(await page.locator('#modal').isVisible().catch(() => false))) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

async function openCategorySettings(page) {
  await page.locator('#home-settings-btn').click()
  await page.locator('[data-settings-act="categories"]').waitFor({ state: 'visible' })
  const isFirst = (await page.locator('.gb-settings-item').first().textContent()).includes('首页分类')
  await page.locator('[data-settings-act="categories"]').click()
  await page.locator('.gb-category-settings').waitFor({ state: 'visible' })
  return isFirst
}

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addInitScript(() => {
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

  check('默认显示三个分类', (await page.locator('.cat-switch .cat-btn').count()) === 3)
  const categoryIsFirst = await openCategorySettings(page)
  check('首页分类是设置里的第一项', categoryIsFirst)
  check('设置里有三个分类开关', (await page.locator('.gb-category-option').count()) === 3)
  check('默认三项全部开启', await Promise.all(['red', 'white', 'custom'].map(async (key) => (
    page.locator(`#category-setting-${key}`).isChecked()
  ))).then((items) => items.every(Boolean)))
  await page.screenshot({ path: join(OUT, '01-category-settings.png'), fullPage: true })

  await page.locator('#category-setting-white').uncheck({ force: true })
  await page.locator('#category-setting-custom').uncheck({ force: true })
  check('只剩一个分类时最后一个开关被锁定', await page.locator('#category-setting-red').isDisabled())
  await page.locator('.gb-category-settings .modal-btn-primary').click()
  await page.locator('.gb-category-settings').waitFor({ state: 'hidden' })

  check('只保留红事时首页不再显示分类切换条', (await page.locator('.cat-switch').count()) === 0)
  check('首页当前主题切回红事', (await page.locator('body').getAttribute('data-occasion')) === 'red')
  check('偏好按设备保存', await page.evaluate(() => localStorage.getItem('giftbook_enabled_categories.v1') === '["red"]'))

  await page.reload({ waitUntil: 'networkidle' })
  await dismissLightModals(page)
  check('刷新后仍只显示红事', (await page.locator('.cat-switch .cat-btn').count()) === 0)

  await openCategorySettings(page)
  check('刷新后偏好仍只有一个开关开启', await page.locator('#category-setting-red').isChecked())
  await page.getByRole('button', { name: '全部显示', exact: true }).click()
  await page.locator('.gb-category-settings .modal-btn-primary').click()
  await page.locator('.gb-category-settings').waitFor({ state: 'hidden' })
  check('恢复全部显示后三个分类重新出现', (await page.locator('.cat-switch .cat-btn').count()) === 3)

  await setFamilyCategory(page, 'white')
  await dismissLightModals(page)
  check('准备隐藏当前白事分类', (await page.locator('body').getAttribute('data-occasion')) === 'white')
  await openCategorySettings(page)
  await page.locator('#category-setting-white').uncheck({ force: true })
  await page.locator('.gb-category-settings .modal-btn-primary').click()
  await page.locator('.gb-category-settings').waitFor({ state: 'hidden' })
  check('关闭当前分类后自动切到仍显示的红事', (await page.locator('body').getAttribute('data-occasion')) === 'red')
  check('白事入口已从首页移除', (await page.locator('[data-cat="white"]').count()) === 0)
} catch (error) {
  console.error('FAIL:', error.message.split('\n')[0])
  failures.push(`执行中断: ${error.message.split('\n')[0]}`)
} finally {
  if (errors.length) failures.push(...errors)
  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
  console.log(`结果: ${failures.length ? `${failures.length} 项失败` : '全部通过'}`)
  await browser.close()
  if (failures.length) process.exit(1)
}
