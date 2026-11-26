// 未开启管理员密码、本机可管理家庭时，设码家庭仍必须显示并使用家庭访问码。
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const ACCESS_CODE = 'local-family-2026'
const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium.executablePath(),
].find((candidate) => candidate && existsSync(candidate))
if (!browserPath) throw new Error('找不到浏览器：请设置 E2E_BROWSER')

const browser = await chromium.launch({ executablePath: browserPath, headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await context.newPage()
const failures = []
const browserErrors = []
page.on('pageerror', (error) => browserErrors.push((error.stack || error.message).split('\n')[0]))

function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
}

async function api(path, method = 'GET', body = null) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, data: await response.json().catch(() => ({})) }
  }, { path, method, body })
}

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const auth = await api('/api/auth')
  if (auth.data?.enabled) throw new Error('该回归需要未开启管理员密码的隔离实例')

  const updated = await api('/api/families/fam_default', 'PUT', { accessCode: ACCESS_CODE })
  if (!updated.data?.success) throw new Error(`设置家庭访问码失败：${JSON.stringify(updated.data)}`)
  await api('/api/family/logout', 'POST', {})
  await page.reload({ waitUntil: 'networkidle' })

  await page.locator('.family-gate').waitFor({ state: 'visible', timeout: 10000 })
  check('未开启管理员密码时保留家庭访问码输入框', await page.locator('#family-code').isVisible())
  check('本机管理权限不再冒充免码家庭列表', !(await page.locator('.family-open-list').isVisible()))
  check('未开启管理员密码时显示首次设置入口', await page.locator('#family-admin-setup').isVisible())

  await page.locator('#family-code').fill('wrong-family-code')
  await page.locator('#family-submit').click()
  await page.locator('#family-error').waitFor({ state: 'visible', timeout: 5000 })
  check('一次错误访问码只提示错误，不进入冷却', !(await page.locator('#family-error').textContent()).includes('秒后再试'))

  await page.locator('#family-code').fill(ACCESS_CODE)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator('#family-submit').click(),
  ])
  await page.locator('#home-screen').waitFor({ state: 'visible', timeout: 10000 })
  check('紧接着输入正确家庭访问码可正常进入', (await page.locator('.family-chip-name').textContent()).includes('我的家庭'))
  check('家庭访问码路径无浏览器错误', browserErrors.length === 0, browserErrors.slice(0, 3).join(' | '))
} catch (error) {
  check('家庭访问码路径', false, error.message.split('\n')[0])
} finally {
  await context.close()
  await browser.close()
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
