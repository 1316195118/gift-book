// 打印打样：给红白两套各出一份真正的 A4 横向 PDF，用来核对版式。
//
// 用法：node scripts/print-proof.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = process.argv[3] || '.shots/print'
const CDP = Number(process.env.CDP_PORT || 9334)
mkdirSync(OUT, { recursive: true })
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
  if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.click(), 1`)
const setVal = (id2, v) => ev(`
  (() => { const el=document.getElementById(${JSON.stringify(id2)}); if(!el) return 0;
    const pr = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(pr,'value').set.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`)

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

async function gotoHome(cat) {
  await send('Page.navigate', { url: BASE }); await sleep(2200)
  for (let i = 0; i < 3; i++) {
    if (!(await ev(`!!document.querySelector('#main-screen')`))) break
    await click('.main-back'); await sleep(900)
  }
  if (!(await ev(`document.querySelector('[data-cat="${cat}"]')?.classList.contains('active')`))) {
    await click(`[data-cat="${cat}"]`); await sleep(450)
    await click('#modal-actions .modal-btn-primary'); await sleep(700)
  }
}

// 造一本有足够内容的账簿：跨 2 页明细 + 备注附录
const NAMES = ['张三', '李四', '王小明', '欧阳文忠', '赵六', '孙七', '周八', '吴九', '郑十', '陈一一',
  '褚二二', '卫三三', '蒋四四', '沈五五', '韩六六']

for (const cat of ['red', 'white']) {
  await gotoHome(cat)
  await click('#home-main-card'); await sleep(800)
  await click('.tpl-card'); await sleep(1000)
  const title = (cat === 'white' ? '追思打样' : '喜宴打样') + Date.now().toString(36).slice(-4)
  await setVal('event-name', title)
  await setVal('event-location', cat === 'white' ? '市殡仪馆 追思厅' : '某某大酒店 3 楼')
  await sleep(300)
  await click('.setup-submit'); await sleep(2800)

  for (let i = 0; i < NAMES.length; i++) {
    await setVal('guest-name', NAMES[i])
    await setVal('gift-amount', String(200 + i * 188))
    if (i % 4 === 0) await setVal('remarks', i === 0 ? '男方同事，另有同行三人' : '亲属')
    await sleep(200)
    await click('#entry-panel-submit, .entry-panel button[type=submit]')
    await sleep(650)
    await ev(`[...document.querySelectorAll('#modal-actions button')].find(b=>b.textContent.includes('确认提交'))?.click(), 1`)
    await sleep(1500)
  }

  // 字号 / 页边距用环境变量选，默认标准；用来验「特大 + 宽边距」会不会撑破版心
  const FS = process.env.PRINT_FONT || 'normal'
  const MG = process.env.PRINT_MARGIN || 'normal'
  await ev(`
    (async () => {
      const p = await import('/src/lib/prefs.js');
      p.savePrintOptions({ fontSize: ${JSON.stringify(FS)}, margin: ${JSON.stringify(MG)}, appendix: true });
      const m = await import('/src/lib/printing.js');
      const old = document.getElementById('print-view');
      if (old) old.remove();
      const v = m.buildPrintPages();
      document.body.appendChild(v);
      return v.querySelectorAll('.print-page').length;
    })()`)
  await sleep(900)
  const pages = await ev(`document.querySelectorAll('#print-view .print-page').length`)

  // 先切到打印介质，@media print 的规则才会生效；
  // 否则下面量到的全是屏幕样式，白查一遍。
  await send('Emulation.setEmulatedMedia', { media: 'print' })
  await sleep(600)

  // 版心溢出检查：有没有内容越出纸页，或被裁掉
  const spill = await ev(`
   (() => {
     const bad = [];
     document.querySelectorAll('#print-view .print-page').forEach((pg, i) => {
       const pr = pg.getBoundingClientRect();
       if (pg.scrollHeight - pg.clientHeight > 2) bad.push('第' + (i+1) + '页 纵向溢出 ' + (pg.scrollHeight - pg.clientHeight) + 'px');
       if (pg.scrollWidth - pg.clientWidth > 2) bad.push('第' + (i+1) + '页 横向溢出 ' + (pg.scrollWidth - pg.clientWidth) + 'px');
       pg.querySelectorAll('*').forEach(el => {
         const r = el.getBoundingClientRect();
         if (!r.width || !r.height) return;
         if (r.bottom > pr.bottom + 1.5 || r.right > pr.right + 1.5 || r.top < pr.top - 1.5) {
           const cls = String(el.className || '').slice(0, 30);
           if (cls && !bad.some(b => b.includes(cls))) bad.push('第' + (i+1) + '页 <' + el.tagName.toLowerCase() + ' class="' + cls + '"> 越出纸页');
         }
         if (el.scrollHeight - el.clientHeight > 2 && getComputedStyle(el).overflow === 'hidden' && (el.textContent||'').trim()) {
           const cls = String(el.className || '').slice(0, 30);
           if (cls && !bad.some(b => b.includes('裁掉') && b.includes(cls))) bad.push('第' + (i+1) + '页 <' + cls + '> 文字被裁掉 ' + (el.scrollHeight - el.clientHeight) + 'px');
         }
       });
     });
     return bad.slice(0, 12);
   })()`)
  if (spill.length) spill.forEach((s) => console.log('    ✗ ' + s))

  const { data } = await send('Page.printToPDF', {
    landscape: true, printBackground: true,
    paperWidth: 11.69, paperHeight: 8.27,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    preferCSSPageSize: true,
  })
  writeFileSync(join(OUT, `${cat}.pdf`), Buffer.from(data, 'base64'))

  // 同时把每一页单独截成图，方便逐页核对（PDF 不一定有渲染器可看）
  const boxes = await ev(`
    JSON.stringify([...document.querySelectorAll('#print-view .print-page')].map(p => {
      const r = p.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    }))`)
  const rects = JSON.parse(boxes)
  for (let i = 0; i < rects.length; i++) {
    const b = rects[i]
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 },
    })
    writeFileSync(join(OUT, `${cat}-p${i + 1}.png`), Buffer.from(shot.data, 'base64'))
  }

  // 打印层也要查串色：白事印出来不能见红见金，红事不能见青黛
  const bleed = await ev(`
   (() => {
     const solemn = document.body.classList.contains('theme-solemn');
     const parse = (v) => {
       const m = String(v).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
       const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
       if (p.length < 3) return null;
       const a = p.length > 3 ? p[3] : 1;
       return a < 0.25 ? null : { r: p[0], g: p[1], b: p[2] };
     };
     const hsl = ({ r, g, b }) => {
       r/=255; g/=255; b/=255;
       const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
       let h=0;
       if (d) { if (mx===r) h=((g-b)/d)%6; else if (mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360; }
       const l=(mx+mn)/2;
       return { h, s: d ? d/(1-Math.abs(2*l-1)) : 0, l };
     };
     const banned = (c) => {
       const { h, s, l } = hsl(c);
       if (s < 0.2 || l > 0.94 || l < 0.06) return false;
       return solemn ? (h >= 330 || h <= 62) : (h >= 185 && h <= 248);
     };
     const out = []; const seen = new Set();
     for (const el of document.querySelectorAll('#print-view *')) {
       const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
       const cs = getComputedStyle(el);
       if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
       for (const prop of ['color','backgroundColor','borderTopColor','borderLeftColor']) {
         const c = parse(cs[prop]); if (!c || !banned(c)) continue;
         const key = el.className + '|' + prop + '|' + cs[prop];
         if (seen.has(key)) continue; seen.add(key);
         out.push(prop + '=' + cs[prop] + '  <' + el.tagName.toLowerCase() + ' class="' + String(el.className).slice(0,44) + '">  ' + (el.textContent||'').trim().slice(0,20));
       }
     }
     return out.slice(0, 20);
   })()`)

  await send('Emulation.setEmulatedMedia', { media: '' })
  console.log(`${cat}: ${pages} 页 → ${cat}.pdf + ${rects.length} 张分页图  串色 ${bleed.length}`)
  bleed.forEach((b) => console.log('    ! ' + b))
}
ws.close()
