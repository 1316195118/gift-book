// 基于 CDP 的界面验证：打开页面、收集报错、走一遍核心流程并截图。
// 用法：node scripts/ui-check.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:18099/'
const OUT = process.argv[3] || '.shots'
const CDP_PORT = Number(process.env.CDP_PORT || 9334)
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openPage() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
  return res.json()
}

const page = await openPage()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
const errors = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails || {}
    errors.push('exception: ' + (d.exception?.description || d.text || '').split('\n')[0])
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    const e = msg.params.entry
    if (!/favicon/i.test(e.url || '')) errors.push('log: ' + e.text.slice(0, 120) + ' @ ' + (e.url || ''))
  }
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (res.exceptionDetails) {
    throw new Error('evaluate failed: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text))
  }
  return res.result.value
}

async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 })
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  await viewport(1440, 1000)
  await send('Page.navigate', { url: BASE })
  await sleep(1800)

  check('首页渲染', await evaluate(`!!document.querySelector('#home-screen #home-main-card')`))

  // 应用会记住上次选的分类，先确保停在红事，这样这一轮断言跟上次跑过什么无关
  if (!(await evaluate(`document.querySelector('[data-cat="red"]')?.classList.contains('active')`))) {
    await evaluate(`document.querySelector('[data-cat="red"]').click()`)
    await sleep(400)
    await evaluate(`document.querySelector('#modal-actions .modal-btn-primary')?.click()`)
    await sleep(600)
  }

  const title = await evaluate(`document.querySelector('#home-title')?.textContent || ''`)
  check('首页标题正确', title.includes('今日何喜'), title)
  await shot('01-home-red')

  // 切到白事
  await evaluate(`document.querySelector('[data-cat="white"]').click()`)
  await sleep(400)
  await evaluate(`document.querySelector('#modal-actions .modal-btn-primary')?.click()`)
  await sleep(500)
  const whiteTitle = await evaluate(`document.querySelector('#home-title')?.textContent || ''`)
  check('白事首页切换', whiteTitle.includes('白事'), whiteTitle)
  // 主题挂在 body 上（store.js 的 setBodyTheme），不在页面容器上
  const whiteClass = await evaluate(`document.body.className`)
  check('白事样式类生效', whiteClass.includes('theme-solemn'), whiteClass)
  await shot('02-home-white')

  // 回到红事
  await evaluate(`document.querySelector('[data-cat="red"]').click()`)
  await sleep(300)
  await evaluate(`document.querySelector('#modal-actions .modal-btn-primary')?.click()`)
  await sleep(500)

  // 进入模板页
  await evaluate(`document.querySelector('#home-main-card').click()`)
  await sleep(600)
  const tplCount = await evaluate(`document.querySelectorAll('.tpl-card').length`)
  check('模板页 5 个模板', tplCount === 5, String(tplCount))
  await shot('03-templates')

  // 用婚宴模板进入创建页
  await evaluate(`document.querySelector('[data-tpl="wedding"]').click()`)
  await sleep(800)
  const setupVisible = await evaluate(`!!document.querySelector('#setup-screen')`)
  const prefilled = await evaluate(`document.querySelector('#event-name')?.value || ''`)
  check('创建页打开并带出模板名', setupVisible && prefilled.includes('婚宴'), prefilled)
  const coverCount = await evaluate(`document.querySelectorAll('#cover-style-grid .cover-style-item').length`)
  check('红事 6 款封面', coverCount === 6, String(coverCount))
  const previewCover = await evaluate(`!!document.querySelector('#preview-cover .ledger-cover')`)
  check('封面实时预览', previewCover)
  await shot('04-setup')

  // 填写并创建
  const uniq = '测试' + Date.now().toString(36)
  await evaluate(`
    (() => {
      const set = (id, value) => {
        const el = document.getElementById(id);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('event-name', ${JSON.stringify(uniq)});
      set('event-location', '测试宴会厅');
      set('admin-password', 'pass1234');
      set('admin-password-confirm', 'pass1234');
    })()
  `)
  await sleep(300)
  await evaluate(`document.querySelector('.setup-submit').click()`)
  await sleep(2000)
  const mainVisible = await evaluate(`!!document.querySelector('#main-screen')`)
  check('创建账簿并进入记账页', mainVisible)
  if (!mainVisible) {
    const msg = await evaluate(`document.querySelector('#modal-content')?.textContent || ''`)
    check('创建失败原因', false, msg.slice(0, 120))
    return
  }
  await shot('05-main-empty')

  // 录入一笔
  await evaluate(`
    (() => {
      const set = (id, value) => {
        const el = document.getElementById(id);
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('guest-name', '张三');
      set('gift-amount', '888');
      set('remarks', '同事');
    })()
  `)
  await sleep(200)
  const chinese = await evaluate(`document.querySelector('.amount-chinese-preview')?.textContent || ''`)
  check('金额大写实时预览', chinese.includes('捌佰捌拾捌'), chinese)
  await evaluate(`document.querySelector('#entry-panel-submit, .entry-panel button[type=submit]').click()`)
  await sleep(500)
  const confirmOpen = await evaluate(`document.querySelector('#modal-title')?.textContent || ''`)
  check('录入确认弹窗', confirmOpen.length > 0, confirmOpen)
  await shot('06-confirm')

  await evaluate(`[...document.querySelectorAll('#modal-actions button')].find(b => b.textContent.includes('确认提交'))?.click()`)
  await sleep(2000)
  const giftCells = await evaluate(`document.querySelectorAll('#gift-book-content .name-cell .name').length`)
  check('礼簿出现记录', giftCells >= 1, String(giftCells))
  const total = await evaluate(`document.querySelector('.ledger-summary .summary-card span:last-child')?.textContent || ''`)
  check('汇总金额已更新', total.includes('888'), total)
  // 姓名格是 flex 容器（横排流），礼簿的竖排由金额列承担
  const upright = await evaluate(`getComputedStyle(document.querySelector('#gift-book-content .amount-chinese')).writingMode`)
  check('竖排礼簿样式', upright.includes('vertical'), upright)
  const centered = await evaluate(`(() => {
    const cell = document.querySelector('#gift-book-content .name-cell');
    const name = cell.querySelector('.name');
    if (!name) return null;
    const a = cell.getBoundingClientRect(), b = name.getBoundingClientRect();
    return Math.abs((a.left + a.width / 2) - (b.left + b.width / 2));
  })()`)
  check('姓名居中', centered !== null && centered <= 1.5, String(centered))
  await shot('07-main-filled')

  // 打开详情
  await evaluate(`document.querySelector('#gift-book-content .name-cell').click()`)
  await sleep(600)
  const detailTitle = await evaluate(`document.querySelector('#modal-title')?.textContent || ''`)
  check('详情弹窗', detailTitle.includes('张三'), detailTitle)
  await shot('08-detail')
  await evaluate(`document.querySelector('#modal-close').click()`)
  await sleep(300)

  // 统计
  await evaluate(`[...document.querySelectorAll('.main-tool')].find(b => b.textContent.trim() === '统计').click()`)
  await sleep(700)
  const statsRows = await evaluate(`document.querySelectorAll('.stats-table tbody tr').length`)
  check('统计表渲染', statsRows >= 1, String(statsRows))
  await shot('09-stats')
  await evaluate(`document.querySelector('#modal-close').click()`)
  await sleep(300)

  // 导出弹窗
  await evaluate(`[...document.querySelectorAll('.main-tool')].find(b => b.textContent.trim() === '导出').click()`)
  await sleep(600)
  const exportOptions = await evaluate(`document.querySelectorAll('.export-option').length`)
  check('导出三选一', exportOptions === 3, String(exportOptions))
  await shot('10-export')
  await evaluate(`document.querySelector('#modal-close').click()`)
  await sleep(300)

  // 设置弹窗
  await evaluate(`[...document.querySelectorAll('.main-tool')].find(b => b.textContent.trim() === '设置').click()`)
  await sleep(600)
  const settingsName = await evaluate(`document.getElementById('edit-event-name-input')?.value || ''`)
  check('设置弹窗带出账簿名', settingsName === uniq, settingsName)
  await shot('11-settings')
  await evaluate(`document.querySelector('#modal-close').click()`)
  await sleep(300)

  // 手机端
  await viewport(390, 844)
  await sleep(600)
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
  check('手机端无横向溢出', overflow <= 1, String(overflow))
  await shot('12-mobile')

  await viewport(1440, 1000)
  await sleep(300)
  // 回到首页
  await evaluate(`document.querySelector('.main-back').click()`)
  await sleep(900)
  const recent = await evaluate(`document.querySelectorAll('.recent-item').length`)
  check('首页显示最近账簿', recent >= 1, String(recent))
  await shot('13-home-recent')

  const realErrors = errors.filter((e) => !/chrome-extension:|siteHostMap/.test(e))
  check('无浏览器报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
}

try {
  await main()
} catch (error) {
  check('脚本执行', false, error.message)
}
console.log('\n结果：', results.filter((r) => r.ok).length, '/', results.length, '通过')
if (errors.length) {
  console.log('浏览器报错：')
  errors.slice(0, 10).forEach((e) => console.log('  -', e))
}
ws.close()
writeFileSync(join(OUT, 'ui-check.json'), JSON.stringify({ results, errors }, null, 2))
process.exit(results.every((r) => r.ok) ? 0 : 1)
