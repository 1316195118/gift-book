// 打印与 PDF 共用的排版：封面页 + 明细页（每页 12 条）+ 备注附录页。
import { state as st } from '../store.js'
import { copyOf } from './content.js'
import { renderCoverMarkup } from './cover.js'
import { amountToChinese, formatCurrency, escapeHtml } from './crypto.js'
import { getPrintOptions, applyPrintOptionsToView, savePrintOptions, printOptionsCss } from './prefs.js'
import { openModal, alert as showAlert, afterModalRender } from './modal.js'

export const ITEMS_PER_PAGE = 12
export const PDF_PAGE_W_PT = 841.89
export const PDF_PAGE_H_PT = 595.28

function isLate(gift) {
  const data = gift?.data
  if (!data) return false
  if (data.late === true) return true
  if (data.late === false) return false
  const ev = st.currentEvent
  const at = data.timestamp ? new Date(data.timestamp).getTime() : NaN
  if (!ev || !Number.isFinite(at)) return false
  const start = ev.startDateTime ? new Date(ev.startDateTime).getTime() : NaN
  const end = ev.endDateTime ? new Date(ev.endDateTime).getTime() : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  return at < start || at > end
}

export function showPrintModal() {
  const ev = st.currentEvent
  if (!ev) return showAlert('提示', '请先进入一本账簿，再进行打印或导出。')
  const copy = copyOf(ev, st.homeCategory)
  if (!st.gifts.length) return showAlert('无法打印', `当前账簿没有任何${copy.recordNoun}记录，无需打印。`)
  const options = getPrintOptions()
  const chip = (name, value, label, active) =>
    `<label class="print-option-chip${active ? ' active' : ''}"><input type="radio" name="${name}" value="${value}" ${active ? 'checked' : ''} /><span>${label}</span></label>`
  const html = `
    <div class="print-options-body">
      <div class="print-option-group"><div class="print-option-label">字号</div><div class="print-option-chips">
        ${chip('fontSize', 'normal', '标准', options.fontSize === 'normal')}
        ${chip('fontSize', 'large', '大', options.fontSize === 'large')}
        ${chip('fontSize', 'xlarge', '特大', options.fontSize === 'xlarge')}
      </div></div>
      <div class="print-option-group"><div class="print-option-label">页边距</div><div class="print-option-chips">
        ${chip('margin', 'narrow', '窄', options.margin === 'narrow')}
        ${chip('margin', 'normal', '标准', options.margin === 'normal')}
        ${chip('margin', 'wide', '宽', options.margin === 'wide')}
      </div></div>
      <label class="print-option-toggle"><input type="checkbox" id="print-option-appendix" ${options.appendix ? 'checked' : ''} /><span>附上备注附录页</span></label>
      <p class="print-option-hint">设置会自动记住，打印与 PDF 导出共用；Ctrl+P 也可打开此面板。</p>
    </div>`
  openModal('打印设置', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '打印',
      class: 'modal-btn-primary',
      handler: () => {
        const fontSize = document.querySelector('input[name="fontSize"]:checked')?.value || 'normal'
        const margin = document.querySelector('input[name="margin"]:checked')?.value || 'normal'
        const appendix = document.getElementById('print-option-appendix')?.checked !== false
        savePrintOptions({ fontSize, margin, appendix })
        setTimeout(() => prepareForPrint(), 80)
      },
    },
  ])
  afterModalRender(() => {
    document.querySelectorAll('.print-option-chip input').forEach((input) => {
      input.addEventListener('change', () => {
        document.querySelectorAll('.print-option-chip').forEach((chipEl) => chipEl.classList.remove('active'))
        if (input.checked) input.closest('.print-option-chip')?.classList.add('active')
      })
    })
  })

}

function renderBookRows(items) {
  const copy = copyOf(st.currentEvent, st.homeCategory)
  const cells = { name: [], type: [], amount: [] }
  for (let i = 0; i < ITEMS_PER_PAGE; i += 1) {
    const gift = items[i]
    if (gift?.data) {
      const nameChars = Array.from(String(gift.data.name ?? ''))
      const shown = nameChars.slice(0, 24)
      const nameLen = shown.length > 3 ? 'long' : String(shown.length)
      const marks = `<div class="mark">${gift.data.remarks ? '<p>*已备注</p>' : ''}${gift.data.history?.length ? '<p>*已修改</p>' : ''}</div>`
      cells.name.push(`<div class="book-cell name-cell">${isLate(gift) ? '<div class="late-mark">*补录</div>' : ''}<div class="name${String(gift.data.name).length > 4 ? ' scale' : ''}" data-len="${nameLen}" style="--name-chars:${shown.length}">${shown.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}${nameChars.length > shown.length ? '<span>…</span>' : ''}</div>${marks}</div>`)
      const chinese = amountToChinese(gift.data.amount)
      const cnClass = chinese.length > 18 ? ' scale tiny' : chinese.length > 8 ? ' scale' : ''
      cells.amount.push(`<div class="book-cell amount-cell"><div class="amount-chinese${cnClass}" style="--amount-chars:${chinese.length}">${chinese}</div><div class="amount-numeric">${formatCurrency(gift.data.amount)}</div></div>`)
    } else {
      cells.name.push('<div class="book-cell name-cell"></div>')
      cells.amount.push('<div class="book-cell amount-cell"></div>')
    }
    cells.type.push(`<div class="book-cell type-cell">${escapeHtml(copy.bookType)}</div>`)
  }
  return `<div class="gift-book-row">${cells.name.join('')}</div><div class="gift-book-row flex-1">${cells.type.join('')}</div><div class="gift-book-row">${cells.amount.join('')}</div>`
}

export function buildPrintPages() {
  if (!st.gifts.length) return null
  const ev = st.currentEvent
  const copy = copyOf(ev, st.homeCategory)
  let printView = document.getElementById('print-view')
  if (printView) printView.remove()
  printView = document.createElement('div')
  printView.id = 'print-view'
  applyPrintOptionsToView(printView)
  const dateStr = new Date(ev.startDateTime).toLocaleDateString('zh-CN')

  const coverPage = document.createElement('div')
  coverPage.className = 'print-page print-cover-page'
  coverPage.innerHTML = renderCoverMarkup(ev, false, st.homeCategory)
  printView.appendChild(coverPage)

  const totalGiftPages = Math.ceil(st.gifts.length / ITEMS_PER_PAGE) || 1
  const stats = { totalAmount: 0, totalGivers: st.gifts.length }
  st.gifts.forEach(({ data }) => {
    if (data) stats.totalAmount += Number(data.amount) || 0
  })

  for (let i = 0; i < totalGiftPages; i += 1) {
    const pageGifts = st.gifts.slice(i * ITEMS_PER_PAGE, (i + 1) * ITEMS_PER_PAGE)
    const pageContainer = document.createElement('div')
    pageContainer.className = 'print-page'
    const content = document.createElement('div')
    content.className = 'print-book-content'
    content.innerHTML = renderBookRows(pageGifts)
    if (i === 0) {
      // 账簿名和「礼金明细」之间要有分隔，否则会连成「喜宴礼金明细」读不断句
      pageContainer.innerHTML += `<h1 class="print-header"><span class="print-header-name">${escapeHtml(ev.name)}</span><span class="print-header-sep">·</span><span class="print-header-kind">${copy.detailTitle}</span></h1>`
    }
    pageContainer.appendChild(content)

    const historyRows = []
    pageGifts.forEach((gift) => {
      if (!gift.data || !Array.isArray(gift.data.history)) return
      gift.data.history.forEach((entry) => {
        historyRows.push({ name: gift.data.name || '', text: entry.changeLog || '修改记录', when: entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN') : '' })
      })
    })
    if (historyRows.length) {
      const shown = historyRows.slice(0, 8)
      const historyBox = document.createElement('div')
      historyBox.className = 'print-history'
      historyBox.innerHTML =
        '<div class="print-history-title">本页修改记录</div><ol>' +
        shown.map((row) => `<li><b>${escapeHtml(row.name)}</b> ${escapeHtml(row.text)}${row.when ? ` <span>${escapeHtml(row.when)}</span>` : ''}</li>`).join('') +
        (historyRows.length > shown.length ? `<li>…另有 ${historyRows.length - shown.length} 条修改记录未显示</li>` : '') +
        '</ol>'
      pageContainer.appendChild(historyBox)
    }

    const pageSubtotal = pageGifts.reduce((sum, gift) => sum + (Number(gift.data?.amount) || 0), 0)
    const isLast = i === totalGiftPages - 1
    pageContainer.innerHTML += `
      <div class="print-footer">
        <p>日期: ${dateStr}</p>
        <p class="print-page-number">第 ${i + 1} / ${totalGiftPages} 页</p>
        <div class="print-footer-totals">
          <p>本页小计: ${formatCurrency(pageSubtotal)}</p>
          ${isLast ? `<span class="total-amount-print">${copy.printTotalGivers}: ${stats.totalGivers}</span><span class="ml-3 total-amount-print">${copy.printTotalAmount}: ${formatCurrency(stats.totalAmount)}</span>` : ''}
        </div>
      </div>`
    printView.appendChild(pageContainer)
  }

  if (getPrintOptions().appendix !== false) appendAppendix(printView, dateStr)
  return printView
}

function appendAppendix(printView, dateStr) {
  const copy = copyOf(st.currentEvent, st.homeCategory)
  const remarked = st.gifts.map((gift, index) => ({ ...gift, originalIndex: index })).filter((g) => g.data && g.data.remarks)
  if (!remarked.length) return
  const perPage = 10
  const total = Math.ceil(remarked.length / perPage)
  for (let j = 0; j < total; j += 1) {
    const items = remarked.slice(j * perPage, (j + 1) * perPage)
    const page = document.createElement('div')
    page.className = 'print-page'
    page.innerHTML = `
      <h1 class="print-header">${copy.appendixTitle}</h1>
      <table class="print-appendix-table"><thead><tr><th>姓名</th><th>记录索引</th><th>备注信息</th></tr></thead><tbody>
        ${items.map((item) => `<tr><td>${escapeHtml(item.data.name)}</td><td>第${Math.floor(item.originalIndex / ITEMS_PER_PAGE) + 1}页第${(item.originalIndex % ITEMS_PER_PAGE) + 1}位</td><td>${escapeHtml(item.data.remark || item.data.remarks)}</td></tr>`).join('')}
      </tbody></table>
      <div class="print-footer"><p>日期: ${dateStr}</p><p class="print-page-number">附录 第 ${j + 1} / ${total} 页</p><div class="print-footer-totals" style="opacity: 0"></div></div>`
    printView.appendChild(page)
  }
}

export function prepareForPrint() {
  const ev = st.currentEvent
  const printView = buildPrintPages()
  if (!printView) return showAlert('无法打印', `当前账簿没有任何${copyOf(ev, st.homeCategory).recordNoun}记录，无需打印。`)
  const dateStr = new Date(ev.startDateTime).toLocaleDateString('zh-CN')
  document.title = `${ev.name}${copyOf(ev, st.homeCategory).detailTitle}-${dateStr}`
  document.body.appendChild(printView)
  document.body.classList.add('printing')
  setTimeout(() => {
    window.print()
    setTimeout(() => {
      document.body.classList.remove('printing')
      document.getElementById('print-view')?.remove()
    }, 100)
  }, 0)
}

export function collectPrintCss() {
  const base = []
  const print = []
  const walk = (rules, bucket) => {
    for (const rule of rules) {
      if (rule.type === CSSRule.MEDIA_RULE) {
        const media = String(rule.conditionText || rule.media?.mediaText || '')
        if (/print/i.test(media)) walk(rule.cssRules, print)
        continue
      }
      if (rule.type === CSSRule.SUPPORTS_RULE) {
        walk(rule.cssRules, bucket)
        continue
      }
      if (rule.type === CSSRule.PAGE_RULE) continue
      bucket.push(rule.cssText)
    }
  }
  for (const sheet of document.styleSheets) {
    if (sheet.media?.mediaText === 'screen') continue
    let rules = null
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    if (rules) walk(rules, base)
  }
  return base.join('\n') + '\n' + print.join('\n')
}

export async function rasterizePrintPage(pageEl, css, themeClass, scale) {
  const widthPx = (297 / 25.4) * 96
  const heightPx = (209 / 25.4) * 96
  let markup = ''
  try {
    markup = new XMLSerializer().serializeToString(pageEl)
  } catch {
    markup = pageEl.outerHTML
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + widthPx + '" height="' + heightPx + '">' +
    '<foreignObject x="0" y="0" width="' + widthPx + '" height="' + heightPx + '">' +
    '<div xmlns="http://www.w3.org/1999/xhtml" id="print-view" class="' + themeClass + '">' +
    '<style><![CDATA[' + css + ']]></style>' +
    markup +
    '</foreignObject></svg>'
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(widthPx * scale)
  canvas.height = Math.round(heightPx * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height }
}

function pdfBase64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function buildPdfBlob(images, pageW, pageH) {
  const encoder = new TextEncoder()
  const parts = []
  let length = 0
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    parts.push(bytes)
    length += bytes.length
  }
  const offsets = []
  const beginObj = () => offsets.push(length)

  push('%PDF-1.4\n%âãÏÓ\n')
  beginObj()
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const pageObj = (i) => 3 + i * 3
  const imageObj = (i) => 4 + i * 3
  const contentObj = (i) => 5 + i * 3
  beginObj()
  push('2 0 obj\n<< /Type /Pages /Kids [' + images.map((_, i) => pageObj(i) + ' 0 R').join(' ') + '] /Count ' + images.length + ' >>\nendobj\n')
  images.forEach((image, i) => {
    beginObj()
    push(pageObj(i) + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /XObject << /Im0 ' + imageObj(i) + ' 0 R >> >> /Contents ' + contentObj(i) + ' 0 R >>\nendobj\n')
    const jpeg = pdfBase64ToBytes(String(image.dataUrl).split(',')[1] || '')
    beginObj()
    push(imageObj(i) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n')
    push(jpeg)
    push('\nendstream\nendobj\n')
    const content = 'q ' + pageW + ' 0 0 ' + pageH + ' 0 0 cm /Im0 Do Q'
    beginObj()
    push(contentObj(i) + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n')
  })
  const xrefStart = length
  let xref = 'xref\n0 ' + (offsets.length + 1) + '\n0000000000 65535 f \n'
  offsets.forEach((offset) => {
    xref += String(offset).padStart(10, '0') + ' 00000 n \n'
  })
  push(xref)
  push('trailer\n<< /Size ' + (offsets.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n')
  return new Blob(parts, { type: 'application/pdf' })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    link.remove()
  }, 1500)
}

export { printOptionsCss, pdfBase64ToBytes }
