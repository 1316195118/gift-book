// 版面体检：把每个页面和弹窗按多个宽度走一遍，自动找这几类毛病。
//
//   overlap   正常流里的兄弟元素互相压住
//   covered   文字被别的元素盖住（挡字）
//   clipped   文字被容器裁掉，看不全
//   overflow  元素超出父容器
//   invisible 有文字但量不出尺寸，或字色和底色几乎一样
//   sizing    同一组重复素材（封面、卡片）尺寸不一致
//   contrast  正文对比度过低
//
// 用法：node scripts/layout-audit.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173/'
const OUT = process.argv[3] || '.shots/audit'
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
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
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

async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 })
  await sleep(450)
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'))
}

// ---------------------------------------------------------------------------
// 页面内的体检程序
// ---------------------------------------------------------------------------
const AUDIT = `
(() => {
  const out = [];
  const add = (kind, el, detail) => {
    if (out.length > 120) return;
    out.push({
      kind,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 64),
      id: el.id || '',
      text: (el.textContent || '').trim().slice(0, 34),
      detail,
    });
  };

  const rect = (el) => el.getBoundingClientRect();
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
    return cs;
  };

  // 只看会被人读到的元素：自己直接拥有文字的
  const ownText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  };

  const parseRGB = (v) => {
    const m = String(v).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // 往上找第一个不透明底色
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parseRGB(getComputedStyle(n).backgroundColor);
      if (c && c.a >= 0.85) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  // 只查「当前这一层」：弹窗开着的时候，底下那一整页本来就被盖住，
  // 把它们算成挡字会淹掉真正的问题。
  const layer = document.querySelector('#modal-container') || document.body;

  // 浏览器自绘的控件内部（option/optgroup）量出来恒为 0，不是版面问题
  const NATIVE = new Set(['OPTION', 'OPTGROUP', 'SCRIPT', 'STYLE', 'BR', 'svg', 'path', 'g']);

  const all = [...layer.querySelectorAll('*')].filter((el) => {
    if (el.closest('#print-view')) return false;       // 打印层另外查
    if (NATIVE.has(el.tagName) || el instanceof SVGElement) return false;
    if (el.closest('select')) return false;
    return vis(el);
  });

  // 整棵子树都塌掉（弹窗正在开合）时，只有最上面那一个才值得报
  const selfCollapsed = (el) => {
    const r = rect(el);
    if (r.width >= 1 && r.height >= 1) return false;
    const p = el.parentElement;
    if (!p) return true;
    const pr = rect(p);
    return pr.width >= 1 && pr.height >= 1;
  };

  // ---- 1. 有字却量不出尺寸 / 字色贴底色 ----
  for (const el of all) {
    const t = ownText(el);
    if (!t) continue;
    const r = rect(el);
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1) {
      if (selfCollapsed(el)) add('invisible', el, '有文字但量不出尺寸');
      continue;
    }

    const fg = parseRGB(cs.color);
    if (fg && fg.a > 0.5) {
      const cr = ratio(fg, bgOf(el));
      const size = parseFloat(cs.fontSize) || 14;
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (cr < 1.6) add('invisible', el, '字色几乎等于底色 对比 ' + cr.toFixed(2));
      else if (cr < need) add('contrast', el, '对比 ' + cr.toFixed(2) + ' < ' + need + '（' + Math.round(size) + 'px）');
    }

    // ---- 2. 文字被容器裁掉 ----
    const clipX = el.scrollWidth - el.clientWidth;
    const clipY = el.scrollHeight - el.clientHeight;
    const scrolls = /auto|scroll/.test(cs.overflowX + cs.overflowY);
    if (!scrolls && cs.overflow !== 'visible') {
      if (clipX > 2 && cs.textOverflow !== 'ellipsis') add('clipped', el, '横向裁掉 ' + clipX + 'px');
      if (clipY > 2 && !/line-clamp/.test(cs.webkitLineClamp || '') && cs.webkitLineClamp === 'none') add('clipped', el, '纵向裁掉 ' + clipY + 'px');
    }

    // ---- 3. 文字被别的元素盖住 ----
    // 只在元素确实露在外面时才判：滚动容器里被卷走的内容不算被挡住
    const scroller = (() => {
      let n = el.parentElement;
      while (n && n !== document.body) {
        const c = getComputedStyle(n);
        if (/auto|scroll/.test(c.overflowY + c.overflowX)) return n;
        n = n.parentElement;
      }
      return null;
    })();
    // 逐行判断：多行文字若某行已被卷进滚动区外，用户滚动即可看到，
    // 不该算「被底部按钮挡住」。用 Range 量真实行盒，比整块 rect 精确。
    const lineRects = (() => {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      return [...rg.getClientRects()].filter((x) => x.width > 2 && x.height > 2);
    })();
    for (const pr of lineRects.length ? lineRects : [r]) {
      let visible = true;
      if (scroller) {
        const sr = rect(scroller);
        // 只有整行都落在可视区内才判遮挡；跨在边界上的行，用户滚动即可看全。
        visible = pr.top >= sr.top - 1 && pr.bottom <= sr.bottom + 1 &&
          pr.left >= sr.left - 1 && pr.right <= sr.right + 1;
      }
      const cx = pr.left + Math.min(pr.width / 2, 40);
      const cy = pr.top + pr.height / 2;
      if (!visible || cx <= 0 || cy <= 0 || cx >= innerWidth || cy >= innerHeight) continue;
      // pointer-events:none 的装饰层本来就命中不到，命中结果没有意义
      const hit = cs.pointerEvents === 'none' ? null : document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        const hcs = getComputedStyle(hit);
        const hbg = parseRGB(hcs.backgroundColor);
        const opaque = (hbg && hbg.a > 0.3) || hcs.backdropFilter !== 'none';
        if (opaque && hcs.pointerEvents !== 'none') {
          add('covered', el, '被 <' + hit.tagName.toLowerCase() + ' class="' + String(hit.className || '').slice(0, 40) + '"> 盖住');
          break;
        }
      }
    }
  }

  // ---- 4. 正常流里的兄弟互相压住 ----
  const flow = (el) => {
    const cs = getComputedStyle(el);
    return cs.position === 'static' || cs.position === 'relative';
  };
  const parents = new Set(all.map((el) => el.parentElement).filter((p) => p && layer.contains(p)));
  for (const p of parents) {
    const kids = [...p.children].filter((el) => vis(el) && flow(el) && rect(el).width > 4 && rect(el).height > 4);
    const pcs = getComputedStyle(p);
    if (pcs.display.includes('grid')) continue;        // grid 允许显式重叠
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = rect(kids[i]), b = rect(kids[j]);
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 3 && oy > 3) {
          const area = ox * oy;
          const small = Math.min(a.width * a.height, b.width * b.height);
          if (area / small > 0.12) {
            add('overlap', kids[i], '与 <' + kids[j].tagName.toLowerCase() + ' class="' + String(kids[j].className || '').slice(0, 36) + '"> 重叠 ' + Math.round(ox) + '×' + Math.round(oy));
          }
        }
      }
    }
  }

  // ---- 5. 元素越出父容器 ----
  for (const el of all) {
    const p = el.parentElement;
    if (!p || p === document.body || !layer.contains(p)) continue;
    const pcs = getComputedStyle(p);
    if (/auto|scroll|hidden/.test(pcs.overflowX + pcs.overflowY)) continue;
    if (getComputedStyle(el).position === 'absolute' || getComputedStyle(el).position === 'fixed') continue;
    const a = rect(el), b = rect(p);
    if (b.width < 4) continue;
    const over = Math.max(b.left - a.left, a.right - b.right);
    if (over > 4) add('overflow', el, '横向超出父容器 ' + Math.round(over) + 'px');
  }

  // ---- 6. 同一组重复素材尺寸不一致 ----
  const groups = [
    ['.tpl-card .ledger-cover', '模板封面'],
    ['.tpl-card', '模板卡片'],
    ['.recent-item', '最近账簿卡片'],
    ['.cover-style-thumb .ledger-cover', '封面样式缩略图'],
    ['.summary-card', '汇总卡'],
    ['.gift-book-row:first-child .book-cell', '礼簿姓名格'],
  ];
  for (const [sel, label] of groups) {
    const els = [...layer.querySelectorAll(sel)].filter(vis);
    if (els.length < 2) continue;
    const ws = els.map((e) => rect(e).width), hs = els.map((e) => rect(e).height);
    const spread = (arr) => Math.max(...arr) - Math.min(...arr);
    if (spread(ws) > 1.5 || spread(hs) > 1.5) {
      add('sizing', els[0], label + ' 尺寸不一：宽 ' + Math.min(...ws).toFixed(0) + '–' + Math.max(...ws).toFixed(0) +
          '，高 ' + Math.min(...hs).toFixed(0) + '–' + Math.max(...hs).toFixed(0) + '（共 ' + els.length + ' 个）');
    }
  }

  // ---- 7. 装饰层压到文字上 ----
  // elementFromPoint 命中不到 pointer-events:none 的装饰（插图、水印、印章），
  // 所以这类「图压字」要单独按几何算，而且要用 Range 量真实的文字范围，
  // 不能用整块的盒子，否则满宽的块级元素会一直误报。
  const decor = all.filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.pointerEvents !== 'none') return false;
    if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
    if (parseFloat(cs.opacity) < 0.15) return false;
    const paints = cs.backgroundImage !== 'none' ||
      (parseRGB(cs.backgroundColor) || {}).a > 0.15 ||
      el.querySelector('svg, img, [style*="background"]');
    return !!paints;
  });

  if (decor.length) {
    for (const el of all) {
      const t = ownText(el);
      if (!t) continue;
      const rg = document.createRange();
      rg.selectNodeContents(el);
      const textRects = [...rg.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
      if (!textRects.length) continue;
      for (const d of decor) {
        if (d.contains(el) || el.contains(d)) continue;
        const b = rect(d);
        for (const r of textRects) {
          const ox = Math.min(r.right, b.right) - Math.max(r.left, b.left);
          const oy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
          if (ox > 2 && oy > 2) {
            add('covered', el, '文字压在装饰层 <' + d.tagName.toLowerCase() +
                ' class="' + String(d.className || '').slice(0, 36) + '"> 上 ' +
                Math.round(ox) + '×' + Math.round(oy));
            break;
          }
        }
      }
    }
  }

  // ---- 8. 功能键显示不全 ----
  // 按钮藏在横滑容器外面，或者被滚动容器裁掉一角。
  // 手机上那条横滑工具栏就是这么把「扫描礼簿」「导出」挤出屏幕的。
  for (const el of all) {
    if (!/^(BUTTON|A|SELECT)$/.test(el.tagName) && !(el.tagName === 'INPUT' && el.type === 'button')) continue;
    const r = rect(el);
    if (r.width < 4 || r.height < 4) continue;
    let n = el.parentElement;
    while (n && n !== document.body) {
      const cs2 = getComputedStyle(n);
      if (/auto|scroll/.test(cs2.overflowX + cs2.overflowY)) {
        const b = rect(n);
        const outX = Math.max(b.left - r.left, r.right - b.right);
        const outY = Math.max(b.top - r.top, r.bottom - b.bottom);
        // 纵向滚动是正常的阅读方式，只有横向藏起来的按钮才算问题
        if (outX > 2 && /auto|scroll/.test(cs2.overflowX)) {
          add('offscreen', el, '需要横滑才能看到，露出容器 ' + Math.round(outX) + 'px');
        } else if (outY > 2 && !/auto|scroll/.test(cs2.overflowY)) {
          add('offscreen', el, '被容器裁掉 ' + Math.round(outY) + 'px');
        }
        break;
      }
      n = n.parentElement;
    }
  }

  // ---- 9. 输入框里字压到图标 / 单位上 ----
  for (const inp of layer.querySelectorAll('input, textarea')) {
    if (!vis(inp)) continue;
    const cs2 = getComputedStyle(inp);
    const r = rect(inp);
    if (r.width < 8) continue;
    const contentL = r.left + parseFloat(cs2.paddingLeft || 0);
    const contentR = r.right - parseFloat(cs2.paddingRight || 0);
    const shell = inp.parentElement;
    if (!shell) continue;
    for (const sib of shell.children) {
      if (sib === inp || !vis(sib)) continue;
      const scs = getComputedStyle(sib);
      if (scs.position !== 'absolute' && scs.position !== 'fixed') continue;
      const b = rect(sib);
      if (b.bottom < r.top + 2 || b.top > r.bottom - 2) continue;   // 不在同一行
      if (b.right > contentL + 1 && b.left < contentR - 1) {
        add('overlap', inp, '输入内容区 ' + Math.round(contentL - r.left) + '–' + Math.round(contentR - r.left) +
            ' 与 <' + sib.tagName.toLowerCase() + ' class="' + String(sib.className || '').slice(0, 24) +
            '"> (' + Math.round(b.left - r.left) + '–' + Math.round(b.right - r.left) + ') 相撞，打字会压上去');
      }
    }
  }

  // ---- 10. 弹窗过大 ----
  const modal = document.querySelector('#modal');
  if (modal) {
    const r = rect(modal);
    if (r.height > innerHeight + 2) add('oversize', modal, '弹窗比屏幕还高 ' + Math.round(r.height - innerHeight) + 'px');
    if (r.width > innerWidth + 2) add('oversize', modal, '弹窗比屏幕还宽 ' + Math.round(r.width - innerWidth) + 'px');
    const body = modal.querySelector('#modal-content');
    if (body && body.scrollHeight <= body.clientHeight + 2 && r.height > innerHeight * 0.8) {
      add('oversize', modal, '内容不用滚动却占掉 ' + Math.round(r.height / innerHeight * 100) + '% 屏高');
    }
  }

  // ---- 11. 整页横向溢出 ----
  const de = document.documentElement;
  if (layer === document.body && de.scrollWidth - de.clientWidth > 2) {
    add('overflow', document.body, '整页横向溢出 ' + (de.scrollWidth - de.clientWidth) + 'px');
  }

  return out;
})()
`

await send('Page.enable')
await send('Runtime.enable')
// 无头浏览器默认可能带 prefers-reduced-motion: reduce，量到的是「关掉动画」的版面。
// MOTION=no-preference 可在动画真实生效的状态下复检，确保进场位移不会造成重叠。
if (process.env.MOTION === 'no-preference') {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
}

const report = []
async function audit(label) {
  // 查页面时先等弹窗彻底退场：正在淡出的弹窗会让一整棵子树量出 0×0
  if (!label.includes('窗')) {
    for (let i = 0; i < 12; i++) {
      if (!(await evaluate(`!!document.querySelector('#modal-container')`))) break
      await sleep(200)
    }
  }
  const found = await evaluate(AUDIT)
  report.push({ screen: label, found })
  const by = {}
  found.forEach((f) => { by[f.kind] = (by[f.kind] || 0) + 1 })
  const sum = Object.entries(by).map(([k, v]) => `${k} ${v}`).join('  ')
  console.log(`${found.length ? '!' : '✓'} ${label}${sum ? '   ' + sum : ''}`)
}

async function gotoHome(category) {
  await send('Page.navigate', { url: BASE })
  await sleep(1900)
  for (let i = 0; i < 3; i++) {
    if (!(await evaluate(`!!document.querySelector('#main-screen')`))) break
    await click('.main-back')
    await sleep(900)
  }
  if (!(await evaluate(`!!document.querySelector('#home-screen')`))) throw new Error('没能回到首页')
  if (!(await evaluate(`document.querySelector('[data-cat="${category}"]')?.classList.contains('active')`))) {
    await click(`[data-cat="${category}"]`)
    await sleep(450)
    await click('#modal-actions .modal-btn-primary')
    await sleep(700)
  }
  // LARGE_TEXT=1 打开「大字」模式再量一遍，这是最容易撑破版面的状态。
  if (process.env.LARGE_TEXT === '1') {
    const on = await evaluate(`document.documentElement.classList.contains('large-text')`)
    if (!on) {
      await click('.home-topbar .large-text-toggle')
      await sleep(450)
    }
  }
}

async function run(category, w, h, vp) {
  const tag = `${category}-${vp}`
  await viewport(w, h)
  await gotoHome(category)
  await audit(`${tag}/首页`)
  await shot(`${tag}-01-home`)

  await click('#home-main-card')
  await sleep(750)
  await audit(`${tag}/模板页`)
  await shot(`${tag}-02-templates`)

  await click('.tpl-card')
  await sleep(950)
  await audit(`${tag}/创建页`)
  await shot(`${tag}-03-setup`)

  // 展开「更多设置」，封面样式缩略图也要查
  await evaluate(`document.querySelector('#setup-screen details')?.setAttribute('open',''), 1`)
  await sleep(500)
  await audit(`${tag}/创建页（展开）`)
  await shot(`${tag}-04-setup-open`)

  const stress = process.env.STRESS === '1'
  const name = (category === 'white' ? '追思' : '喜宴') +
    (stress ? '府上亲属追思礼仪簿超长名称压力测试' : Date.now().toString(36).slice(-4))
  await setVal('event-name', name)
  await setVal('event-location', category === 'white' ? '追思厅' : '宴会厅')
  await sleep(300)
  await click('.setup-submit')
  await sleep(2700)
  await audit(`${tag}/记账页`)
  await shot(`${tag}-05-main`)

  // 录两笔，一笔长名字一笔长备注，专挑容易撑破的；STRESS=1 时进一步加长。
  const firstGift = stress ? '欧阳文忠先生府上亲属代表' : (category === 'white' ? '欧阳文忠先生' : '王小明')
  const firstRemark = stress
    ? '男方同事，长备注测试长备注测试长备注测试长备注测试长备注测试长备注测试'
    : '男方同事，长备注测试长备注测试'
  for (const [gname, amount, remark] of [
    [firstGift, '1888', firstRemark],
    [category === 'white' ? '李四' : '张三', '666', ''],
  ]) {
    await setVal('guest-name', gname)
    await setVal('gift-amount', amount)
    if (remark) await setVal('remarks', remark)
    await sleep(250)
    await click('#entry-panel-submit, .entry-panel button[type=submit]')
    await sleep(700)
    await evaluate(`[...document.querySelectorAll('#modal-actions button')].find(b => b.textContent.includes('确认提交'))?.click(), 1`)
    await sleep(2200)
  }
  await audit(`${tag}/记账页（有记录）`)
  await shot(`${tag}-06-main-filled`)

  await click('#gift-book-content .name-cell .name')
  await sleep(850)
  await audit(`${tag}/明细窗`)
  await shot(`${tag}-07-detail`)
  await click('#modal-close')
  await sleep(550)

  for (const [sel, label, file] of [
    ['#stats-btn', '统计窗', '08-stats'],
    ['#export-btn', '导出窗', '09-export'],
    ['#settings-btn', '设置窗', '10-settings'],
    ['#qr-show-btn', '收款码窗', '11-qr'],
    ['#print-btn', '打印窗', '12-print'],
  ]) {
    await click(sel)
    await sleep(1150)
    await audit(`${tag}/${label}`)
    await shot(`${tag}-${file}`)
    await click('#modal-close')
    await sleep(550)
  }

  await gotoHome(category)
  await audit(`${tag}/首页（有账簿）`)
  await shot(`${tag}-13-home-recent`)
}

// AUDIT_WIDTHS=320,390,768,1440 可覆盖更多断点；默认保留桌面/手机两档。
const VIEWPORTS = process.env.AUDIT_WIDTHS
  ? process.env.AUDIT_WIDTHS.split(',').map((w) => [`w${w.trim()}`, Number(w.trim()), 900])
  : [
      ['desktop', 1440, 1000],
      ['mobile', 390, 844],
    ]

for (const [vp, w, h] of VIEWPORTS) {
  for (const cat of ['red', 'white']) {
    console.log(`\n──────── ${cat} @ ${vp} (${w}px) ────────`)
    await run(cat, w, h, vp)
  }
}

writeFileSync(join(OUT, 'audit.json'), JSON.stringify(report, null, 2))

// 汇总：同一条毛病在多个页面重复出现时合并，先修共性问题
const bucket = new Map()
for (const r of report) {
  for (const f of r.found) {
    const key = [f.kind, f.tag, f.cls, f.id, f.detail.replace(/\d+/g, 'N')].join('|')
    if (!bucket.has(key)) bucket.set(key, { ...f, screens: [] })
    bucket.get(key).screens.push(r.screen)
  }
}
const rows = [...bucket.values()].sort((a, b) => b.screens.length - a.screens.length)
console.log('\n================ 汇总（按出现页面数排序）================')
if (!rows.length) console.log('没有发现问题')
for (const r of rows) {
  console.log(`\n[${r.kind}] <${r.tag}${r.id ? ' #' + r.id : ''} class="${r.cls}">`)
  console.log(`   ${r.detail}`)
  if (r.text) console.log(`   文字：${r.text}`)
  console.log(`   出现在 ${r.screens.length} 处：${r.screens.slice(0, 4).join('、')}${r.screens.length > 4 ? ' …' : ''}`)
}
console.log(`\n共 ${rows.length} 类问题，${report.reduce((n, r) => n + r.found.length, 0)} 处。`)
ws.close()
