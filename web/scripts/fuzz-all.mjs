// 全功能乱字符暴力测试：API 边界 / XSS / 超长 / 控制字符 / 持久化。
// 用法：先启动隔离实例（:18299，临时 data），再 node scripts/fuzz-all.mjs
import { chromium } from 'playwright-core'
import { createHash } from 'node:crypto'

const BASE = process.env.FUZZ_BASE || 'http://127.0.0.1:18299'
const results = []
const rec = (level, name, detail = '') => {
  results.push({ level, name, detail })
  console.log(`${level}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const XSS = '<img src=x onerror=window.__xss=1>'
// 空字符串的哈希 = 无密码账簿，测试才能直接进入。
const NO_PASS = createHash('sha256').update('').digest('hex')

async function call(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, data }
}

const baseEvent = {
  name: 'fuzz', passwordHash: NO_PASS, theme: 'theme-festive', category: 'red',
  startDateTime: '2026-11-04T10:00', endDateTime: '2026-11-05T22:00',
  location: '', template: '婚宴', coverStyle: 'shuangxi', totalAmount: 0,
}

// ---------- API 边界 ----------
const apiCases = [
  ['非法 JSON', { path: '/api/events', method: 'POST', raw: '{"name":' }],
  ['name=null', { path: '/api/events', method: 'POST', body: { ...baseEvent, name: null } }],
  ['name=数字', { path: '/api/events', method: 'POST', body: { ...baseEvent, name: 123 } }],
  ['name=数组', { path: '/api/events', method: 'POST', body: { ...baseEvent, name: ['a'] } }],
  ['name 超长 100KB', { path: '/api/events', method: 'POST', body: { ...baseEvent, name: 'x'.repeat(100000) } }],
  ['缺 passwordHash', { path: '/api/events', method: 'POST', body: { ...baseEvent, passwordHash: undefined } }],
]
for (const [label, req] of apiCases) {
  const { status, data } = await call(req.path, req)
  const ok = status >= 400 && status < 500
  rec(ok ? 'PASS' : status >= 500 ? 'FAIL' : 'WARN', `API ${label}`, `status=${status} ${String(data?.message || '').slice(0, 40)}`)
}

// 建一本带 XSS 名称/地点的账簿，供 UI 阶段使用
const created = await call('/api/events', { method: 'POST', body: { ...baseEvent, name: XSS, location: XSS } })
const eventId = created.data?.data?.id
rec(created.status === 200 && eventId ? 'PASS' : 'FAIL', 'API 创建含 XSS 名称的账簿', `status=${created.status}`)

const giftCases = [
  ['缺 eventId', { path: '/api/gifts', method: 'POST', body: { encryptedContent: 'v1:x' } }],
  ['eventId 非存在值', { path: '/api/gifts', method: 'POST', body: { eventId: '../../etc/passwd', encryptedContent: 'v1:x' } }],
  ['encryptedContent=null', { path: '/api/gifts', method: 'POST', body: { eventId, encryptedContent: null } }],
  ['encryptedContent 1MB', { path: '/api/gifts', method: 'POST', body: { eventId, encryptedContent: 'x'.repeat(1000000) } }],
]
for (const [label, req] of giftCases) {
  const { status, data } = await call(req.path, req)
  const ok = status >= 400 && status < 500
  rec(ok ? 'PASS' : status >= 500 ? 'FAIL' : 'WARN', `API ${label}`, `status=${status} ${String(data?.message || '').slice(0, 40)}`)
}

const trav = await call('/api/events/..%2F..%2Fetc%2Fpasswd')
rec([400, 401, 404].includes(trav.status) ? 'PASS' : 'FAIL', 'API 路径穿越被拒', `status=${trav.status}`)

// ---------- UI 注入 ----------
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
let dialogs = 0
page.on('pageerror', (e) => errors.push(String(e)))
page.on('dialog', async (d) => { dialogs += 1; await d.dismiss() })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

const xssHome = await page.evaluate(() => Boolean(window.__xss))
rec(!xssHome ? 'PASS' : 'FAIL', 'XSS 未在首页执行')
const homeText = await page.locator('body').innerText()
rec(homeText.includes('<img') ? 'PASS' : 'WARN', 'XSS 名称以纯文本展示', homeText.includes('<img') ? '标签被转义显示' : '未找到该文本')

// 进入账簿
await page.locator('.recent-item').first().click().catch(() => {})
await page.waitForTimeout(1800)
const inMain = (await page.locator('.main-tools').count()) > 0
rec(inMain ? 'PASS' : 'FAIL', '进入含 XSS 名称的账簿', inMain ? '' : '未进入')

if (inMain) {
  const names = ['<svg/onload=x=1>', '张三🥳🎉', '\u200b\u200c\u200d', '\u202eABC', '𠮷'.repeat(30), 'O\'Brien & "Co"']
  let savedCount = 0
  for (const name of names) {
    await page.fill('#guest-name', name).catch(() => {})
    await page.fill('#gift-amount', '100').catch(() => {})
    await page.locator('#submit-gift-btn').click().catch(() => {})
    await page.waitForTimeout(500)
    // 录入是两段式：先弹「请确认录入信息」，再点「确认提交」。
    const confirm = page.locator('#modal-actions button', { hasText: '确认提交' })
    if (await confirm.count()) await confirm.first().click().catch(() => {})
    await page.waitForTimeout(900)
    const left = await page.inputValue('#guest-name').catch(() => '')
    if (!left) savedCount += 1
  }
  rec(savedCount > 0 ? 'PASS' : 'WARN', '乱字符姓名可正常录入', `${savedCount}/${names.length} 条成功`)

  // 直接按本次创建的 eventId 查接口确认落库（比 UI 文本/同名匹配可靠）
  const gifts = await call('/api/gifts?eventId=' + encodeURIComponent(eventId))
  const count = gifts.status === 200 ? Object.keys(gifts.data.data || {}).length : -1
  rec(count >= names.length ? 'PASS' : 'FAIL', '乱字符礼金已持久化', `count=${count}`)

  const xssMain = await page.evaluate(() => Boolean(window.__xss) || Boolean(window.x))
  rec(!xssMain ? 'PASS' : 'FAIL', '录入 XSS 未执行')

  // 搜索框乱字符
  await page.fill('#search-name', '<script>"\'&<>\u200b').catch(() => {})
  await page.locator('#search-top-btn').click().catch(() => {})
  await page.waitForTimeout(700)
  rec(errors.length === 0 ? 'PASS' : 'FAIL', '搜索乱字符不崩', errors.slice(0, 2).join(' | '))

  // 刷新后数据与转义仍正常（刷新会回到首页，需重新进账簿再查）
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const xssAfter = await page.evaluate(() => Boolean(window.__xss) || Boolean(window.x))
  rec(!xssAfter ? 'PASS' : 'FAIL', '刷新后 XSS 仍未执行')
  await page.locator('.recent-item').first().click().catch(() => {})
  await page.waitForTimeout(1800)
  const bookText = await page.locator('#gift-book-content').innerText().catch(() => '')
  rec(bookText.includes('张三') ? 'PASS' : 'WARN', '刷新后礼簿仍显示乱字符姓名', bookText.includes('张三') ? 'emoji 姓名可见' : '当前页未显示（分页/账簿不同）')
}

rec(errors.length === 0 ? 'PASS' : 'FAIL', '全程无页面错误', errors.slice(0, 3).join(' | '))
rec(dialogs === 0 ? 'PASS' : 'FAIL', '无 alert 弹窗被触发', `dialogs=${dialogs}`)

await browser.close()
const fails = results.filter((r) => r.level === 'FAIL')
const warns = results.filter((r) => r.level === 'WARN')
console.log(`\n结果：PASS ${results.length - fails.length - warns.length} / WARN ${warns.length} / FAIL ${fails.length}`)
process.exit(fails.length ? 1 : 0)
