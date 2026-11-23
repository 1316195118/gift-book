// 上线清单页面回归：条款、隐私、404 与公开宾客登记。
// 用法：BASE_URL=http://127.0.0.1:18199 node e2e/article-pages.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18199'
const OUT = process.env.SHOT_DIR || join('..', '.shots', 'article-pages')
mkdirSync(OUT, { recursive: true })

const browserPath = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium.executablePath(),
].find((candidate) => candidate && existsSync(candidate))
if (!browserPath) throw new Error('找不到 Edge/Chromium，请设置 E2E_BROWSER')

const browser = await chromium.launch({ executablePath: browserPath, headless: true })
const results = []
const failures = []

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
}

async function overflow(page) {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth))
}

async function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('button, a[href], [role="button"]')]
    .filter((el) => {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    })
    .filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width < 44 || rect.height < 44
    })
    .map((el) => `${el.tagName.toLowerCase()} ${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24)}`)
    .slice(0, 10))
}

for (const [width, height] of [[375, 812], [768, 1024]]) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  try {
    for (const route of ['/privacy', '/terms']) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      await page.locator('.policy-paper').waitFor({ state: 'visible' })
      check(`${width}px ${route} 无横向溢出`, (await overflow(page)) <= 1, String(await overflow(page)))
      check(`${width}px ${route} 触控目标合格`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' | '))
      check(`${width}px ${route} 标题独立`, (await page.title()).includes(route === '/privacy' ? '隐私政策' : '服务条款'), await page.title())
      await page.screenshot({ path: join(OUT, `${width}${route.replace('/', '-')}.png`), fullPage: true })
    }

    const missing = await page.goto(BASE + '/definitely-missing-page', { waitUntil: 'domcontentloaded' })
    check(`${width}px 404 返回真实状态码`, missing?.status() === 404, String(missing?.status()))
    check(`${width}px 404 有返回首页`, await page.getByRole('link', { name: '返回首页' }).isVisible())
    check(`${width}px 404 有快捷入口`, (await page.locator('.actions a').count()) >= 3)
    check(`${width}px 404 无横向溢出`, (await overflow(page)) <= 1, String(await overflow(page)))
    check(`${width}px 404 触控目标合格`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' | '))
    await page.screenshot({ path: join(OUT, `${width}-404.png`), fullPage: true })
    // 404 文档本身会在 Chromium 控制台产生“资源 404”，这是本轮预期的状态码。
    errors.length = 0

    const origin = new URL(BASE).origin
    const created = await context.request.post(BASE + '/api/events', {
      headers: { Origin: origin },
      data: { name: `宾客回归-${width}`, passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    })
    const createdBody = await created.json()
    check(`${width}px 宾客测试账簿已建立`, created.ok(), `${created.status()} ${JSON.stringify(createdBody).slice(0, 120)}`)
    const eventID = createdBody.data?.id
    const enabled = await context.request.post(BASE + `/api/events/${eventID}/guest`, {
      headers: { Origin: origin },
      data: { enabled: true },
    })
    const enabledBody = await enabled.json()
    const token = enabledBody.data?.token || ''
    check(`${width}px 宾客登记入口已开启`, enabled.ok() && Boolean(token), `${enabled.status()}`)

    await page.goto(BASE + `/?gift=${encodeURIComponent(token)}`, { waitUntil: 'networkidle' })
    await page.locator('.gb-guest-form').waitFor({ state: 'visible' })
    check(`${width}px 宾客页无横向溢出`, (await overflow(page)) <= 1, String(await overflow(page)))
    check(`${width}px 宾客页触控目标合格`, (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' | '))
    await page.getByRole('button', { name: '提交登记' }).click()
    check(`${width}px 宾客空表单有友好提示`, await page.getByText('请先填写您的姓名。').isVisible())
    await page.locator('#guest-name').fill('欧阳娜娜欧阳娜娜欧阳娜娜')
    await page.locator('#guest-amount').fill('888')
    await page.locator('#guest-relation').fill('亲友')
    await page.locator('#guest-note').fill('祝万事顺意')
    await page.getByRole('button', { name: '提交登记' }).click()
    await page.getByText('登记成功', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
    check(`${width}px 宾客提交成功`, true)
    check(`${width}px 提交后表单收起`, !(await page.locator('.gb-guest-form').count()))
    await page.screenshot({ path: join(OUT, `${width}-guest-done.png`), fullPage: true })
    check(`${width}px 页面无浏览器错误`, errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (error) {
    check(`${width}px 页面链路`, false, error.message.split('\n')[0])
  } finally {
    await context.close()
  }
}

await browser.close()
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, failures }, null, 2))
console.log(`\n结果：${results.filter((item) => item.ok).length}/${results.length} 通过，截图目录 ${OUT}`)
if (failures.length) process.exit(1)
