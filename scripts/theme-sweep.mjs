// 逐页检查两套主题：截图 + 自动找「串色」。
//
// 串色 = 白事页面上出现红事的朱砂/赤金，或红事页面上出现白事的青黛。
// 做法：遍历可见元素的计算样式，把颜色换算成色相，落在对方主题的色相区间
// 且饱和度不低的，就报出来。
//
// 用法：node scripts/theme-sweep.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = process.argv[3] || '.shots/sweep'
const CDP_PORT = Number(process.env.CDP_PORT || 9334)
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const page = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})

let nextId = 1
const pending = new Map()
const errors = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails || {}
    errors.push('exception: ' + (d.exception?.description || d.text || '').split('\n')[0])
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
  if (res.exceptionDetails) throw new Error('evaluate: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text))
  return res.result.value
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'))
}

// 页面内的串色探针。颜色 → HSL 色相，再按主题判定。
const BLEED_PROBE = `
(() => {
  const solemn = document.body.classList.contains('theme-solemn');
  const parse = (v) => {
    const m = String(v).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3) return null;
    const a = p.length > 3 ? p[3] : 1;
    return a < 0.25 ? null : { r: p[0], g: p[1], b: p[2] };
  };
  const hsl = ({ r, g, b }) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const l = (mx + mn) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return { h, s, l };
  };
  // 红事禁用的色相：青黛（185–245）。白事禁用的：朱砂与赤金（-20–60）。
  const banned = (c) => {
    const { h, s, l } = hsl(c);
    if (s < 0.2 || l > 0.94 || l < 0.06) return false;
    return solemn ? (h >= 330 || h <= 62) : (h >= 185 && h <= 248);
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (out.length > 60) break;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor']) {
      const c = parse(cs[prop]);
      if (!c || !banned(c)) continue;
      const key = el.className + '|' + prop + '|' + cs[prop];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 70),
        prop,
        value: cs[prop],
        text: (el.textContent || '').trim().slice(0, 24),
      });
    }
  }
  return out;
})()
`

// 白事页面不该出现的喜庆字眼，红事页面不该出现的哀悼字眼
const WORDING_PROBE = `
(() => {
  const solemn = document.body.classList.contains('theme-solemn');
  const festiveWords = ['喜', '贺礼', '囍', '恭喜', '庆', '婚宴', '寿宴', '满月', '乔迁', '升学', '红事', '吉'];
  const solemnWords = ['奠', '丧', '追思', '哀', '逝', '殡', '祭', '吊唁', '白事'];
  const bad = solemn ? festiveWords : solemnWords;
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const el = n.parentElement;
    if (!el || el.closest('[hidden]') || el.offsetParent === null) continue;
    // 分类切换本来就要同时写着「红事 / 白事」，不算串词
    if (el.closest('.cat-switch')) continue;
    const t = (n.textContent || '').trim();
    if (!t) continue;
    for (const w of bad) {
      if (t.includes(w)) {
        hits.push({ word: w, text: t.slice(0, 50), cls: String(el.className).slice(0, 50) });
        break;
      }
    }
  }
  return hits.slice(0, 40);
})()
`

await send('Page.enable')
await send('Runtime.enable')

const findings = []
async function audit(label) {
  const bleed = await evaluate(BLEED_PROBE)
  const wording = await evaluate(WORDING_PROBE)
  findings.push({ screen: label, bleed, wording })
  const b = bleed.length, w = wording.length
  console.log(`${b || w ? '!' : '✓'} ${label}  串色 ${b}  用词 ${w}`)
}

const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.click(), 1`)
const setVal = (id, value) => evaluate(`
  (() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return 0;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`)

// 应用会记住上次打开的账簿，重新载入会直接进记账页。
// 不先退回首页的话，整轮白事其实都跑在红事账簿上。
async function gotoHome(category) {
  await send('Page.navigate', { url: BASE })
  await sleep(1900)
  for (let i = 0; i < 3; i++) {
    if (!(await evaluate(`!!document.querySelector('#main-screen')`))) break
    await click('.main-back')
    await sleep(900)
  }
  const onHome = await evaluate(`!!document.querySelector('#home-screen')`)
  if (!onHome) throw new Error('没能回到首页')

  await click(`[data-cat="${category}"]`)
  await sleep(450)
  await click('#modal-actions .modal-btn-primary')
  await sleep(700)

  const solemn = await evaluate(`document.body.classList.contains('theme-solemn')`)
  if (solemn !== (category === 'white')) {
    throw new Error(`分类没切过去：期望 ${category}，body solemn=${solemn}`)
  }
}

async function run(category) {
  const tag = category === 'white' ? 'white' : 'red'
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await gotoHome(category)
  await audit(`${tag}/首页`)
  await shot(`${tag}-01-home`)

  await click('#home-main-card')
  await sleep(700)
  await audit(`${tag}/模板页`)
  await shot(`${tag}-02-templates`)

  await click('.tpl-card')
  await sleep(900)
  await audit(`${tag}/创建页`)
  await shot(`${tag}-03-setup`)

  const name = (category === 'white' ? '追思' : '喜宴') + Date.now().toString(36).slice(-5)
  await setVal('event-name', name)
  await setVal('event-location', category === 'white' ? '追思厅' : '宴会厅')
  await sleep(300)
  await click('.setup-submit')
  await sleep(2600)
  await audit(`${tag}/记账页`)
  await shot(`${tag}-04-main-empty`)

  await setVal('guest-name', category === 'white' ? '李四' : '张三')
  await setVal('gift-amount', '666')
  await sleep(300)
  await click('#entry-panel-submit, .entry-panel button[type=submit]')
  await sleep(700)
  await audit(`${tag}/录入确认窗`)
  await shot(`${tag}-05-confirm`)
  await evaluate(`[...document.querySelectorAll('#modal-actions button')].find(b => b.textContent.includes('确认提交'))?.click(), 1`)
  await sleep(2400)
  await audit(`${tag}/记账页（有记录）`)
  await shot(`${tag}-06-main-filled`)

  // 明细窗
  await click('#gift-book-content .name-cell .name')
  await sleep(800)
  await audit(`${tag}/明细窗`)
  await shot(`${tag}-07-detail`)
  await click('#modal-close')
  await sleep(500)

  for (const [sel, label, file] of [
    ['#stats-btn', '统计窗', '08-stats'],
    ['#export-btn', '导出窗', '09-export'],
    ['#settings-btn', '设置窗', '10-settings'],
    ['#qr-show-btn', '收款码窗', '11-qr'],
    ['#print-btn', '打印窗', '12-print'],
  ]) {
    await click(sel)
    await sleep(1100)
    await audit(`${tag}/${label}`)
    await shot(`${tag}-${file}`)
    await click('#modal-close')
    await sleep(500)
    await evaluate(`document.querySelector('#print-view') && (document.querySelector('#print-close')?.click()), 1`)
    await sleep(300)
  }

  // 回首页，看最近账簿一行
  await gotoHome(category)
  await audit(`${tag}/首页（有账簿）`)
  await shot(`${tag}-13-home-recent`)
}

await run('red')
await run('white')

writeFileSync(join(OUT, 'sweep.json'), JSON.stringify({ findings, errors }, null, 2))

const bleeds = findings.filter((f) => f.bleed.length)
const words = findings.filter((f) => f.wording.length)
console.log('\n================ 串色 ================')
if (!bleeds.length) console.log('无')
for (const f of bleeds) {
  console.log(`\n【${f.screen}】`)
  for (const b of f.bleed) console.log(`   ${b.prop}=${b.value}  <${b.tag} class="${b.cls}">  ${b.text}`)
}
console.log('\n================ 用词 ================')
if (!words.length) console.log('无')
for (const f of words) {
  console.log(`\n【${f.screen}】`)
  for (const w of f.wording) console.log(`   「${w.word}」 ${w.text}   (.${w.cls})`)
}
if (errors.length) {
  console.log('\n================ 报错 ================')
  errors.forEach((e) => console.log('  ' + e))
}
ws.close()
