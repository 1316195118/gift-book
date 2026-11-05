// 只读冒烟检查：不建任何账簿，只确认目标站点能正常渲染红白两套界面。
// 用来验证线上部署，不污染数据目录。
//
// 用法：node scripts/smoke.mjs <baseUrl> [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = process.argv[3] || '.shots/smoke'
const CDP = Number(process.env.CDP_PORT || 9334)
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pg = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(pg.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }) })

let id = 1
const pend = new Map()
const errs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { const { res } = pend.get(m.id); pend.delete(m.id); res(m.result) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0])
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
})
const send = (method, params = {}) => new Promise((res) => { const i = id++; pend.set(i, { res }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }))?.result?.value
const shot = async (n) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(OUT, n + '.png'), Buffer.from(data, 'base64'))
}
await send('Page.enable'); await send('Runtime.enable')

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function freshHome() {
  await send('Page.navigate', { url: BASE })
  await sleep(2500)
  for (let i = 0; i < 3; i++) {
    if (!(await ev(`!!document.querySelector('#main-screen')`))) break
    await ev(`document.querySelector('.main-back')?.click()`)
    await sleep(900)
  }
}

for (const [vp, w, h] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 })
  for (const cat of ['red', 'white']) {
    await freshHome()
    if (!(await ev(`document.querySelector('[data-cat="${cat}"]')?.classList.contains('active')`))) {
      await ev(`document.querySelector('[data-cat="${cat}"]')?.click()`); await sleep(450)
      await ev(`document.querySelector('#modal-actions .modal-btn-primary')?.click()`); await sleep(750)
    }
    const solemn = await ev(`document.body.classList.contains('theme-solemn')`)
    check(`${vp}/${cat} 首页渲染`, await ev(`!!document.querySelector('#home-main-card')`))
    check(`${vp}/${cat} 主题正确`, solemn === (cat === 'white'), solemn ? 'theme-solemn' : 'theme-festive')
    await shot(`${vp}-${cat}-home`)

    await ev(`document.querySelector('#home-main-card')?.click()`); await sleep(900)
    const n = await ev(`document.querySelectorAll('.tpl-card').length`)
    check(`${vp}/${cat} 模板 5 个`, n === 5, String(n))
    const raw = await ev(`JSON.stringify([...document.querySelectorAll('.tpl-card .ledger-cover')].map(e=>Math.round(e.getBoundingClientRect().height)))`)
    const hs = JSON.parse(raw || '[]')
    check(`${vp}/${cat} 封面等高`, hs.length > 0 && Math.max(...hs) - Math.min(...hs) <= 1, hs.length ? `${Math.min(...hs)}–${Math.max(...hs)}px` : '无封面')
    await shot(`${vp}-${cat}-templates`)
  }
}

// 第三方扩展的报错跟本站无关，单独滤掉
const mine = [...new Set(errs)].filter((e) => !/siteHostMap/.test(e))
console.log(mine.length ? '\n站点报错：\n  ' + mine.join('\n  ') : '\n站点无报错')
console.log(`\n结果：${pass} / ${pass + fail} 通过`)
ws.close()
process.exit(fail || mine.length ? 1 : 0)
