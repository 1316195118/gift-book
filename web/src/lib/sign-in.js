// 签到表 / 席位表：按姓氏排序生成 A4 纵向表格，用隐藏 iframe 打印（无弹窗拦截、不污染主文档）。
import { state as st } from '../store.js'
import { copyOf, isSolemnEvent } from './content.js'
import { escapeHtml } from './crypto.js'
import { alert as showAlert } from './modal.js'

const PER_PAGE = 24

// 按中文姓名排序（localeCompare 对姓氏/拼音更稳），同一姓名保持原顺序。
export function sortForSignIn(gifts) {
  return [...gifts]
    .filter((g) => g?.data?.name)
    .sort((a, b) => String(a.data.name).localeCompare(String(b.data.name), 'zh-Hans-CN'))
}

export function buildSignInPages(list, { eventName, dateStr, location, total, theme }) {
  const pages = []
  const pageCount = Math.max(1, Math.ceil(list.length / PER_PAGE))
  for (let p = 0; p < pageCount; p += 1) {
    const slice = list.slice(p * PER_PAGE, (p + 1) * PER_PAGE)
    const rows = slice
      .map((g, i) => `<tr><td class="c">${p * PER_PAGE + i + 1}</td><td class="c name">${escapeHtml(g.data.name)}</td><td class="c">${escapeHtml(g.data.relation || '—')}</td><td class="sign"></td></tr>`)
      .join('')
    const meta = [dateStr, location, `共 ${total} 人`].filter(Boolean).join('　·　')
    pages.push(`<section class="sheet-page"><header><div class="kicker">${theme === 'solemn' ? '奠仪簿' : '礼金簿'}</div><h1>${escapeHtml(eventName)} · 签到表</h1><p class="meta">${escapeHtml(meta)}</p></header><table><thead><tr><th style="width:10%">序号</th><th style="width:24%">姓名</th><th style="width:18%">关系</th><th>签名</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="c">（无记录）</td></tr>'}</tbody></table><footer>第 ${p + 1} / ${pageCount} 页</footer></section>`)
  }
  return pages
}

export function openSignInSheet() {
  const ev = st.currentEvent
  if (!ev) return showAlert('提示', '请先进入一本账簿。')
  const copy = copyOf(ev, st.homeCategory)
  const list = sortForSignIn(st.gifts)
  if (!list.length) return showAlert('无法生成签到表', `当前账簿还没有${copy.recordNoun}记录。`)
  const solemn = isSolemnEvent(ev, st.homeCategory)
  const primary = solemn ? '#374151' : '#a3261e'
  const bg = solemn ? '#eef0f3' : '#f7efee'
  const dateStr = new Date(ev.startDateTime).toLocaleDateString('zh-CN')
  const pages = buildSignInPages(list, { eventName: ev.name, dateStr, location: ev.location, total: list.length, theme: solemn ? 'solemn' : 'festive' })
  const css = `
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "SimSun", "Songti SC", serif; color: #222; }
    .sheet-page { page-break-after: always; }
    .sheet-page:last-child { page-break-after: auto; }
    header { border-bottom: 2px solid ${primary}; padding-bottom: 8px; margin-bottom: 12px; }
    .kicker { font-size: 9pt; letter-spacing: 4px; color: ${primary}; }
    h1 { font-family: "KaiTi", "STKaiti", serif; font-size: 20pt; margin: 4px 0; color: ${primary}; }
    .meta { font-size: 9pt; color: #666; margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11pt; }
    th, td { border: 1px solid #999; padding: 7px 6px; height: 27px; vertical-align: middle; }
    th { background: ${bg}; color: ${primary}; font-family: "KaiTi", serif; font-weight: 600; }
    td.c { text-align: center; }
    td.name { font-size: 12pt; letter-spacing: 1px; }
    footer { margin-top: 8px; font-size: 8pt; color: #999; text-align: center; }
  `
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(ev.name)} 签到表</title><style>${css}</style></head><body>${pages.join('')}</body></html>`
  printHtml(html)
}

function printHtml(html) {
  const old = document.getElementById('sign-in-print-frame')
  if (old) old.remove()
  const frame = document.createElement('iframe')
  frame.id = 'sign-in-print-frame'
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()
  const fire = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } finally {
      setTimeout(() => frame.remove(), 1000)
    }
  }
  if (doc.readyState === 'complete') setTimeout(fire, 120)
  else frame.onload = () => setTimeout(fire, 120)
}
