// 临时探针：在指定宽度下打开最近一本账簿，跑一段页面内表达式，并截图。
// 用法：node scripts/probe.mjs <宽度逗号分隔> <表达式文件> [截图前缀]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const widths = (process.argv[2] || '390').split(',').map(Number)
const expr = readFileSync(process.argv[3], 'utf8')
const shotPrefix = process.argv[4] || ''
if (shotPrefix) mkdirSync('.shots/probe', { recursive: true })
const BASE = process.env.BASE || 'http://localhost:5173/'
const CDP = Number(process.env.CDP_PORT || 9334)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const page = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })
let id = 1
const pend = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
})
const send = (method, params = {}) => new Promise((res, rej) => { const i = id++; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}
await send('Page.enable'); await send('Runtime.enable')

for (const w of widths) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 })
  await send('Page.navigate', { url: BASE })
  await sleep(2400)
  for (let i = 0; i < 3; i++) {
    if (!(await ev(`!!document.querySelector('#main-screen')`))) break
    await ev(`document.querySelector('.main-back')?.click()`)
    await sleep(900)
  }
  // HOME_ONLY=1 时停在首页，用来查最近账簿卡片一类
  if (process.env.HOME_ONLY) {
    if (process.env.CAT && !(await ev(`document.querySelector('[data-cat="${process.env.CAT}"]')?.classList.contains('active')`))) {
      await ev(`document.querySelector('[data-cat="${process.env.CAT}"]')?.click()`); await sleep(450)
      await ev(`document.querySelector('#modal-actions .modal-btn-primary')?.click()`); await sleep(750)
    }
    console.log(`\n========== ${w}px ==========`)
    console.log(await ev(expr))
    if (shotPrefix) {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      writeFileSync(`.shots/probe/${shotPrefix}-${w}.png`, Buffer.from(data, 'base64'))
    }
    continue
  }

  // 新建一本无密码账簿，保证一定能进到记账页（点最近账簿可能撞上要密码的）
  await ev(`document.querySelector('#home-main-card')?.click()`); await sleep(850)
  await ev(`document.querySelector('.tpl-card')?.click()`); await sleep(1000)
  const set = (id2, v) => ev(`
    (() => { const el=document.getElementById(${JSON.stringify(id2)}); if(!el) return 0;
      const pr = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(pr,'value').set.call(el, ${JSON.stringify(v)});
      el.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`)
  await set('event-name', '探针' + Date.now().toString(36).slice(-4))
  await set('event-location', '宴会厅')
  await sleep(300)
  await ev(`document.querySelector('.setup-submit')?.click()`)
  await sleep(2800)
  if (process.env.WITH_GIFT) {
    await set('guest-name', '欧阳文忠')
    await set('gift-amount', '1888')
    await sleep(250)
    await ev(`document.querySelector('#entry-panel-submit, .entry-panel button[type=submit]')?.click()`)
    await sleep(900)
  }
  console.log(`\n========== ${w}px ==========`)
  console.log(await ev(expr))
  if (shotPrefix) {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(`.shots/probe/${shotPrefix}-${w}.png`, Buffer.from(data, 'base64'))
  }
}
ws.close()
