// 端到端冒烟：真实二进制 + Edge，覆盖「按钮响应 / 懒加载失败 / 版本更新 / 关闭键命中」。
// 用法：先启动 giftbook.exe（-port 18299 -data/-config 指向临时目录），再 node scripts/e2e-smoke.mjs
import { chromium } from 'playwright-core'

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:18299'
const results = []
const pageErrors = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })

// ---- 主流程：默认上下文（带 SW，贴近真实） ----
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.on('pageerror', (err) => pageErrors.push(String(err)))
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push(msg.text())
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

// 1) 首页版本号 → 更新说明
const hasChip = (await page.locator('.version-chip').count()) > 0
check('首页版本号存在', hasChip)
if (hasChip) {
  await page.locator('.version-chip').click()
  await page.waitForTimeout(700)
  const title = await page.locator('#modal-title').innerText().catch(() => '')
  check('版本号点击打开更新说明', title.includes('更新说明'), title)
  // 关闭键是否真的可点（不被遮罩/细框盖住）
  const closeHit = await page.evaluate(() => {
    const btn = document.querySelector('#modal-close')
    if (!btn) return false
    const r = btn.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return Boolean(top && (top === btn || btn.contains(top)))
  })
  check('关闭键可被命中（无遮挡）', closeHit)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('ESC 能关闭弹窗', (await page.locator('#modal-container').count()) === 0)
}

// 2) 创建账簿进入主界面
let inMain = false
if (await page.locator('#home-create-btn').count()) {
  await page.locator('#home-create-btn').click()
  await page.waitForTimeout(400)
  if (await page.locator('.tpl-card').count()) {
    await page.locator('.tpl-card').first().click()
    await page.waitForTimeout(400)
  }
  if (await page.locator('#event-name').count()) {
    await page.fill('#event-name', 'E2E 测试账簿')
    await page.locator('.setup-submit').click()
    await page.waitForTimeout(1800)
    inMain = (await page.locator('.main-tools').count()) > 0
  }
}
check('能创建账簿并进入记录页', inMain)

// 3) 工具栏按钮逐个点击：必须有弹窗响应
const tools = [
  ['#settings-btn', '设置'],
  ['#stats-btn', '统计'],
  ['#export-btn', '导出'],
  ['#print-btn', '打印'],
]
for (const [sel, label] of tools) {
  if (!inMain || !(await page.locator(sel).count())) {
    check(`点击「${label}」有响应`, false, '按钮不存在')
    continue
  }
  await page.locator(sel).click()
  await page.waitForTimeout(900)
  const opened = (await page.locator('#modal-container').count()) > 0
  check(`点击「${label}」有响应`, opened)
  if (opened) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
}
await context.close()

// ---- 故障注入：禁用 SW + 冻结空闲预取，确保测的是真实 import ----
const faultCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
const faultPage = await faultCtx.newPage()
faultPage.on('pageerror', (err) => pageErrors.push(String(err)))

// 4) chunk 404 → 必须提示刷新
await faultPage.addInitScript(() => {
  // 把预取推迟到测试之后，避免模块提前进内存。
  window.requestIdleCallback = (cb) => setTimeout(cb, 60000)
})
await faultPage.route('**/assets/changelog-*.js', (route) => route.fulfill({ status: 404, body: '' }))
await faultPage.goto(BASE, { waitUntil: 'domcontentloaded' })
await faultPage.waitForTimeout(250)
if ((await faultPage.locator('.version-chip').count()) > 0) {
  await faultPage.locator('.version-chip').click()
  await faultPage.waitForTimeout(1200)
  const text = await faultPage.locator('#gb-toast-stack').innerText().catch(() => '')
  check('懒加载失败有明确提示', /加载失败|刷新/.test(text), text.replace(/\s+/g, ' ').slice(0, 50))
} else {
  check('懒加载失败有明确提示', false, '未找到版本号')
}

// 5) 版本更新 → 提示刷新
await faultPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await faultPage.waitForTimeout(300)
await faultPage.route('**/build.json', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ build: '20991231-2359', version: '9.9.9' }),
  }),
)
await faultPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await faultPage.waitForTimeout(900)
const updateText = await faultPage.locator('#gb-toast-stack').innerText().catch(() => '')
check('发现新版本有提示', /新版本/.test(updateText), updateText.replace(/\s+/g, ' ').slice(0, 50))
await faultCtx.close()

// 6) 页面无未捕获错误
check('无未捕获页面错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

await page.screenshot({ path: 'scripts/e2e-last.png' }).catch(() => {})
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
