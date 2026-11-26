// 管理员登录后的家庭门回归：不再把管理员密码误送进「家庭访问码」输入框。
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const PASSWORD = 'adminpass123'
const stamp = Date.now().toString(36)
const secondFamilyName = `管理员回归第二家庭-${stamp}`
const secondFamilyCode = `adminfamily-${stamp}-2026`
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
  const state = await api('/api/auth')
  if (state.data?.enabled) {
    const login = await api('/api/auth', 'POST', { password: PASSWORD })
    if (!login.data?.success) throw new Error('已有管理员状态与回归密码不一致，请使用隔离实例运行')
  } else {
    const enable = await api('/api/auth', 'PUT', { enabled: true, password: PASSWORD })
    if (!enable.data?.success) throw new Error(`设置管理员密码失败：${JSON.stringify(enable.data)}`)
  }
  const created = await api('/api/families', 'POST', { name: secondFamilyName, accessCode: secondFamilyCode })
  if (!created.data?.success) throw new Error(`创建第二家庭失败：${JSON.stringify(created.data)}`)
  await api('/api/family/logout', 'POST', {})
  await page.reload({ waitUntil: 'networkidle' })

  await page.locator('.family-gate').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('.family-open-list').waitFor({ state: 'visible', timeout: 10000 })
  check('管理员会话下家庭门显示家庭列表', await page.locator('.family-open-list').isVisible())
  check('管理员不再看到家庭访问码输入框', !(await page.locator('#family-code').isVisible()))
  check('管理员不再重复显示管理员登录按钮', !(await page.locator('#family-admin-login').isVisible()))
  check('管理员已登录时不再显示首次设置入口', !(await page.locator('#family-admin-setup').isVisible()))

  // 退出管理员但保留家庭门，完整走一次“管理员密码登录 → 选择家庭”。
  await api('/api/auth', 'DELETE')
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#family-admin-login').click()
  await page.locator('#auth-password').fill(PASSWORD)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator('#auth-submit').click(),
  ])
  await page.locator('.family-gate').waitFor({ state: 'visible', timeout: 10000 })
  check('正确管理员密码登录后进入家庭选择', !(await page.locator('#family-code').isVisible()))

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.getByRole('button', { name: new RegExp(`进入「${secondFamilyName}」`) }).click(),
  ])
  await page.locator('#home-screen').waitFor({ state: 'visible', timeout: 10000 })
  check('管理员选家庭后正常进入首页', await page.locator('#home-screen').isVisible())
  check('管理员进入的是所选的第二个家庭', (await page.locator('.family-chip-name').textContent()).includes(secondFamilyName))
  check('管理员家庭路径无浏览器错误', browserErrors.length === 0, browserErrors.slice(0, 3).join(' | '))
} catch (error) {
  check('管理员家庭回归链路', false, error.message.split('\n')[0])
} finally {
  await context.close()
  await browser.close()
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
