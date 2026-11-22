// 导出：Excel 明细、PDF 礼簿（A4 横向）、Word 文档（A4 纵向）。
import { state as st } from '../store.js'
import { openModal, closeModal, alert as showAlert, afterModalRender } from './modal.js'
import { copyOf, isSolemnEvent } from './content.js'
import { amountToChinese, formatCurrency, escapeHtml, formatDate, formatDateTime, safeFileName } from './crypto.js'
import { buildPrintPages, prepareForPrint, PDF_PAGE_W_PT, PDF_PAGE_H_PT, collectPrintCss, rasterizePrintPage, buildPdfBlob, downloadBlob, printOptionsCss } from './printing.js'
import { XlsxLite } from './xlsx-lite.js'
import { hasReturned, returnRecordsOf } from './return-gift.js'
import { openImport } from './import.js'
import { scopeGifts, scopeInfo, scopeEmptyMessage, resetExportScope, openScopePicker } from './export-scope.js'

const ITEMS_PER_PAGE = 12

// 范围为空时的提示：区分「整本本来就空」和「这次勾选范围里没有记录」。
function emptyMessage(copy) {
  return scopeInfo().active ? scopeEmptyMessage() : copy.exportEmpty
}

function returnsEmptyMessage(copy) {
  return scopeInfo().active
    ? scopeEmptyMessage()
    : `当前账簿还没有登记回礼。先在礼金详情里登记回礼，再来导出${copy.peopleNoun}的回礼明细。`
}

// Excel 主题：与红事 / 白事的纸色、主色一致（ARGB）。
const XLSX_THEMES = {
  festive: { accent: 'FFAB2B21', soft: 'FFF9EAE4', paper: 'FFFAF4E9', line: 'FFE9DDC7', ink: 'FF241C14' },
  solemn: { accent: 'FF33475A', soft: 'FFEAEEF2', paper: 'FFF2F3F2', line: 'FFDDE1E1', ink: 'FF1A1F21' },
}
const xlsxTheme = (ev) => (isSolemnEvent(ev, st.homeCategory) ? XLSX_THEMES.solemn : XLSX_THEMES.festive)

export function openExport() {
  const ev = st.currentEvent
  if (!ev) return
  const copy = copyOf(ev, st.homeCategory)
  const info = scopeInfo()
  openModal(
    '',
    {
      type: 'export',
      eventName: ev.name,
      count: info.count,
      recordsLabel: copy.recordsLabel,
      bookTitle: copy.bookTitle,
      solemn: isSolemnEvent(ev, st.homeCategory),
      scopeLabel: info.label,
      scopeActive: info.active,
      onPick: (format) => {
        if (format === 'excel') setTimeout(() => exportToExcel(), 80)
        if (format === 'returns') setTimeout(() => openReturnsExport(), 80)
        if (format === 'pdf') setTimeout(() => exportLedgerPdf(), 120)
        if (format === 'word') setTimeout(() => exportToWord(), 80)
        if (format === 'import') setTimeout(() => openImport(), 80)
        if (format === 'scope') setTimeout(() => openScopePicker(() => openExport()), 80)
        if (format === 'scopeAll') {
          resetExportScope()
          setTimeout(() => openExport(), 80)
        }
        // 未回礼名单会反向调用记账模块的写入函数，按需加载避免静态循环。
        if (format === 'pending') {
          setTimeout(async () => {
            const module = await import('./pending-returns.js')
            module.openPendingReturns()
          }, 80)
        }
      },
    },
    [],
    { size: 'unlock', theme: isSolemnEvent(ev, st.homeCategory) ? 'theme-solemn' : 'theme-festive', dismissable: true },
  )
}

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

// 统计与页面/打印共用同一份实现，避免「导出合计和页面不一致」。
import { computeStats as computeLedgerStats } from './stats-core.js'

export function exportToExcel() {
  const ev = st.currentEvent
  const copy = copyOf(ev, st.homeCategory)
  if (!scopeGifts().length) return showAlert('无法导出', emptyMessage(copy))
  const stats = computeLedgerStats(scopeGifts())
  const dateStr = formatDate(ev.startDateTime)
  const displayId = ev.displayId ? `No.${ev.displayId}` : ''
  const metaLine = [displayId, dateStr, ev.location, `共 ${stats.totalGivers} 位${copy.peopleNoun}`].filter(Boolean).join('　·　')
  const style = { title: 1, meta: 2, head: 3, center: 4, text: 5, money: 6, total: 7 }

  const rows = [
    [{ v: `${ev.name} ${copy.detailTitle}`, s: style.title }, null, null, null, null, null, null, null],
    [{ v: metaLine, s: style.meta }, null, null, null, null, null, null, null],
    [null],
    ['序号', '姓名', '金额', '大写金额', '收款方式', '关系', '备注', '录入时间'].map((v) => ({ v, s: style.head })),
  ]
  scopeGifts().forEach((g, i) => {
    const d = g.data || {}
    const blank = d.kind === 'blank'
    rows.push([
      { v: i + 1, s: style.center },
      { v: blank ? '— 跳过 —' : `${isLate(g) ? '*补录 ' : ''}${d.name || ''}`, s: style.center },
      { v: blank ? '—' : Number(d.amount) || 0, s: style.money },
      { v: blank ? '—' : amountToChinese(d.amount), s: style.text },
      { v: blank ? '' : d.type || '', s: style.center },
      { v: blank ? '' : d.relation || '未分类', s: style.center },
      { v: blank ? '占位行，不计入人数与金额' : d.remarks || '', s: style.text },
      { v: formatDateTime(d.timestamp), s: style.center },
    ])
  })
  const lastDataRow = rows.length
  rows.push([{ v: `${copy.printTotalGivers}：${stats.totalGivers} 位　　${copy.printTotalAmount}：${formatCurrency(stats.totalAmount)}`, s: style.total }, null, null, null, null, null, null, null])

  const rowHeights = { 1: 30, 2: 20, 3: 8, 4: 24 }
  for (let r = 5; r <= lastDataRow; r += 1) rowHeights[r] = 22
  rowHeights[lastDataRow + 1] = 24

  const sheets = [
    {
      name: copy.detailTitle,
      theme: xlsxTheme(ev),
      widths: [6, 14, 14, 26, 10, 10, 26, 20],
      rows,
      merges: ['A1:H1', 'A2:H2', `A${lastDataRow + 1}:H${lastDataRow + 1}`],
      rowHeights,
      freeze: { ySplit: 4, topLeft: 'A5' },
      autoFilter: `A4:H${lastDataRow}`,
    },
  ]

  const history = []
  scopeGifts().forEach((g, i) => {
    const d = g.data || {}
    ;(Array.isArray(d.history) ? d.history : []).forEach((entry) => {
      history.push([
        { v: i + 1, s: style.center },
        { v: d.name || '', s: style.center },
        { v: entry.changeLog || '修改记录', s: style.text },
        { v: formatDateTime(entry.timestamp), s: style.center },
      ])
    })
  })
  if (history.length) {
    const historyRows = [
      [{ v: `${ev.name} 修改记录`, s: style.title }, null, null, null],
      [{ v: `共 ${history.length} 条修改留痕　·　${copy.historyNote}`, s: style.meta }, null, null, null],
      [null],
      ['序号', '姓名', '修改内容', '修改时间'].map((v) => ({ v, s: style.head })),
      ...history,
    ]
    const historyHeights = { 1: 30, 2: 20, 3: 8, 4: 24 }
    for (let r = 5; r < historyRows.length + 1; r += 1) historyHeights[r] = 24
    sheets.push({
      name: '修改记录',
      theme: xlsxTheme(ev),
      widths: [6, 14, 52, 22],
      rows: historyRows,
      merges: ['A1:D1', 'A2:D2'],
      rowHeights: historyHeights,
      freeze: { ySplit: 4, topLeft: 'A5' },
      autoFilter: `A4:D${historyRows.length}`,
    })
  }
  XlsxLite.downloadWorkbook(sheets, `${safeFileName(ev.name)}_${copy.fileSuffix}.xlsx`)
}

// ---- 回礼明细：Excel / PDF / Word 三种格式 ----

// 汇总「已回礼的人与金额」，三种格式共用同一份数据。
function collectReturns() {
  const ev = st.currentEvent
  if (!ev) return null
  const list = scopeGifts()
    .filter((g) => hasReturned(g.data))
    .map((g) => {
      const d = g.data
      const records = returnRecordsOf(d)
      const total = records.reduce((sum, r) => sum + Number(r.amount || 0), 0)
      const last = records[records.length - 1]
      return {
        name: d.name || '',
        relation: d.relation || '未分类',
        gift: Number(d.amount) || 0,
        total,
        times: records.length,
        lastAt: last?.timestamp || '',
        notes: records.map((r) => r.note).filter(Boolean).join('；'),
      }
    })
  return { ev, list, total: list.reduce((sum, r) => sum + r.total, 0) }
}

function returnsMetaLine(ev, list, total, copy) {
  return [
    ev.displayId ? `No.${ev.displayId}` : '',
    `已回礼 ${list.length} 位${copy.peopleNoun}`,
    `回礼合计 ${formatCurrency(total)}`,
  ].filter(Boolean).join('　·　')
}

// 入口：先选格式（与账簿导出同样的三种文件类型）。
export function openReturnsExport() {
  const ev = st.currentEvent
  if (!ev) return
  if (isSolemnEvent(ev, st.homeCategory)) {
    return showAlert('不支持', '白事账簿不提供回礼功能，无需导出回礼明细。')
  }
  const copy = copyOf(ev, st.homeCategory)
  const data = collectReturns()
  if (!data.list.length) {
    return showAlert('无法导出', returnsEmptyMessage(copy))
  }
  const html = `
    <div class="export-options">
      <button type="button" class="export-option" data-returns-fmt="excel">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5v10M15 9.5v10"/></svg></span>
        <span class="export-text"><b>Excel 表格</b><small>.xlsx · 带封面与主题底色</small></span>
      </button>
      <button type="button" class="export-option" data-returns-fmt="pdf">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 13h6M9 16.5h4"/></svg></span>
        <span class="export-text"><b>PDF 明细</b><small>A4 横向 · 带封面</small></span>
      </button>
      <button type="button" class="export-option" data-returns-fmt="word">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h14v16H5z"/><path d="M8 8l1.6 8 1.4-5 1.4 5L14 8"/></svg></span>
        <span class="export-text"><b>Word 文档</b><small>A4 纵向 · 带封面</small></span>
      </button>
    </div>
    <p class="unlock-note">${scopeInfo().active ? `当前导出范围：${scopeInfo().label}；` : ''}共 ${data.list.length} 位${copy.peopleNoun}已登记回礼，合计 ${formatCurrency(data.total)}；只列已回礼的人，每人一行并标注为回礼。</p>`
  openModal('回礼明细', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }])
  afterModalRender(() => {
    document.querySelectorAll('[data-returns-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.dataset.returnsFmt
        closeModal()
        if (fmt === 'excel') setTimeout(() => exportReturnsExcel(), 80)
        if (fmt === 'pdf') setTimeout(() => exportReturnsPdf(), 80)
        if (fmt === 'word') setTimeout(() => exportReturnsWord(), 80)
      })
    })
  })
}

// Excel：封面页 + 明细（主题配色）。
export function exportReturnsExcel() {
  const data = collectReturns()
  if (!data?.list.length) return showAlert('无法导出', returnsEmptyMessage(copy))
  const { ev, list, total: totalReturned } = data
  const copy = copyOf(ev, st.homeCategory)
  const style = { title: 1, meta: 2, head: 3, center: 4, text: 5, money: 6, total: 7 }
  const metaLine = returnsMetaLine(ev, list, totalReturned, copy)

  const rows = [
    [{ v: `${ev.name} 回礼明细`, s: style.title }, null, null, null, null, null, null, null, null],
    [{ v: metaLine, s: style.meta }, null, null, null, null, null, null, null, null],
    [null],
    ['序号', '姓名', '关系', '原礼金', '回礼金额', '回礼次数', '最近回礼时间', '备注', '类型'].map((v) => ({ v, s: style.head })),
  ]
  list.forEach((r, i) => {
    rows.push([
      { v: i + 1, s: style.center },
      { v: r.name, s: style.center },
      { v: r.relation, s: style.center },
      { v: r.gift, s: style.money },
      { v: r.total, s: style.money },
      { v: r.times, s: style.center },
      { v: r.lastAt ? formatDateTime(r.lastAt) : '', s: style.center },
      { v: r.notes, s: style.text },
      { v: '回礼', s: style.center },
    ])
  })
  const lastDataRow = rows.length
  rows.push([{ v: `已回礼 ${list.length} 位　·　回礼合计：${formatCurrency(totalReturned)}`, s: style.total }, null, null, null, null, null, null, null, null])

  const rowHeights = { 1: 30, 2: 20, 3: 8, 4: 24 }
  for (let r = 5; r <= lastDataRow; r += 1) rowHeights[r] = 22
  rowHeights[lastDataRow + 1] = 24

  const theme = xlsxTheme(ev)
  const solemn = isSolemnEvent(ev, st.homeCategory)
  const coverRows = []
  const coverHeights = {}
  const pushCover = (text, styleIdx, height) => {
    coverRows.push([{ v: text, s: styleIdx }, ...Array(7).fill(null)])
    coverHeights[coverRows.length] = height
  }
  const startText = formatDateTime(ev.startDateTime)
  pushCover('', 11, 24)
  pushCover('', 11, 30)
  pushCover(ev.name, 12, 56)
  pushCover(`${solemn ? '白事 · 奠仪' : '红事 · 贺礼'} · 回礼明细`, 13, 34)
  pushCover('', 11, 16)
  pushCover(startText ? `时间：${startText}` : '', 14, 28)
  pushCover(ev.location ? `地点：${ev.location}` : '', 14, 28)
  pushCover('', 11, 12)
  pushCover(`已回礼 ${list.length} 位${copy.peopleNoun}　·　回礼合计 ${formatCurrency(totalReturned)}`, 13, 34)
  pushCover('', 11, 12)
  pushCover(`本表只列已登记回礼的${copy.peopleNoun}：每人一行，回礼金额为多次回礼的累计；「类型」列统一标注为回礼。`, 14, 64)
  pushCover(`导出于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, 14, 30)
  pushCover('', 11, 24)

  XlsxLite.downloadWorkbook(
    [
      {
        name: '封面',
        theme,
        widths: [14, 14, 14, 14, 14, 14, 14, 14],
        rows: coverRows,
        merges: coverRows.map((_, i) => `A${i + 1}:H${i + 1}`),
        rowHeights: coverHeights,
      },
      {
        name: '回礼明细',
        theme,
        widths: [6, 14, 10, 12, 12, 10, 20, 26, 8],
        rows,
        merges: ['A1:I1', 'A2:I2', `A${lastDataRow + 1}:I${lastDataRow + 1}`],
        rowHeights,
        freeze: { ySplit: 4, topLeft: 'A5' },
        autoFilter: `A4:I${lastDataRow}`,
      },
    ],
    `${safeFileName(ev.name)}_回礼明细.xlsx`,
  )
}

// Word：A4 纵向，封面头 + 表格 + 合计。
export function exportReturnsWord() {
  const data = collectReturns()
  if (!data?.list.length) return showAlert('无法导出', returnsEmptyMessage(copy))
  const { ev, list, total } = data
  const copy = copyOf(ev, st.homeCategory)
  const solemn = isSolemnEvent(ev, st.homeCategory)
  const primary = solemn ? '#33475a' : '#ab2b21'
  const bg = solemn ? '#eef0f3' : '#f9eae4'
  const rows = list
    .map(
      (r, i) =>
        `<tr><td class="c">${i + 1}</td><td class="c">${escapeHtml(r.name)}</td><td class="c">${escapeHtml(r.relation)}</td><td class="num">${formatCurrency(r.gift)}</td><td class="num">${formatCurrency(r.total)}</td><td class="c">${r.times}</td><td class="time">${r.lastAt ? escapeHtml(formatDateTime(r.lastAt)) : ''}</td><td class="remark">${escapeHtml(r.notes)}</td><td class="c">回礼</td></tr>`,
    )
    .join('')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escapeHtml(ev.name)} 回礼明细</title><style>
    @page { size: A4 portrait; margin: 1.8cm 1.6cm; }
    body { font-family: "SimSun","Songti SC",serif; font-size: 10.5pt; color: #222; line-height: 1.5; }
    .doc-head { border-bottom: 2px solid ${primary}; padding-bottom: 10px; margin-bottom: 16px; text-align: center; }
    .doc-head .kicker { font-size: 8.5pt; letter-spacing: 4px; color: ${primary}; }
    .doc-head h1 { font-family: "KaiTi","STKaiti",serif; font-size: 24pt; color: ${primary}; margin: 6px 0; }
    .doc-head .meta { font-size: 9pt; color: #666; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 5px 6px; vertical-align: middle; }
    th { background: ${bg}; color: ${primary}; font-weight: bold; }
    td.c { text-align: center; } td.num { text-align: right; white-space: nowrap; } td.time { text-align: center; font-size: 8.5pt; color: #555; }
    td.remark { text-align: left; word-break: break-word; }
    tr { page-break-inside: avoid; }
    .totals { margin-top: 12px; font-size: 10.5pt; text-align: right; }
    .note { margin-top: 10px; font-size: 8.5pt; color: #777; }
  </style></head><body>
    <div class="doc-head"><div class="kicker">${solemn ? '白 事 · 奠 仪' : '红 事 · 贺 礼'} · 回 礼</div>
    <h1>${escapeHtml(ev.name)} 回礼明细</h1>
    <div class="meta">${escapeHtml(returnsMetaLine(ev, list, total, copy))}</div></div>
    <table><thead><tr><th style="width:6%">序号</th><th style="width:12%">姓名</th><th style="width:9%">关系</th><th style="width:11%">原礼金</th><th style="width:12%">回礼金额</th><th style="width:8%">次数</th><th style="width:14%">最近回礼</th><th>备注</th><th style="width:7%">类型</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals">已回礼 ${list.length} 位 · 合计 <b>${formatCurrency(total)}</b></div>
    <div class="note">本文件只列已登记回礼的${copy.peopleNoun}，每人一行，回礼金额为多次回礼的累计；「类型」列统一标注为回礼。</div>
  </body></html>`
  downloadBlob(new Blob([html], { type: 'application/msword' }), `${safeFileName(ev.name)}_回礼明细.doc`)
}

// PDF：A4 横向，与礼簿同一套渲染链（逐页转图再写 PDF）。
const RETURNS_PER_PAGE = 16

export async function exportReturnsPdf() {
  const data = collectReturns()
  if (!data?.list.length) return showAlert('无法导出', returnsEmptyMessage(copy))
  const { ev, list, total } = data
  const copy = copyOf(ev, st.homeCategory)
  const themeClass = isSolemnEvent(ev, st.homeCategory) ? 'theme-solemn' : 'theme-festive'
  const totalPages = Math.max(1, Math.ceil(list.length / RETURNS_PER_PAGE))
  const printView = document.createElement('div')
  printView.id = 'print-view'
  printView.style.cssText = 'position:fixed;left:-9999px;top:0;width:297mm;'
  const pages = []
  for (let p = 0; p < totalPages; p += 1) {
    const slice = list.slice(p * RETURNS_PER_PAGE, (p + 1) * RETURNS_PER_PAGE)
    const page = document.createElement('div')
    page.className = 'print-page'
    const head =
      p === 0
        ? `<h1 class="print-header"><span class="print-header-name">${escapeHtml(ev.name)}</span><span class="print-header-sep">·</span><span class="print-header-kind">回礼明细</span></h1><p class="returns-print-meta">${escapeHtml(returnsMetaLine(ev, list, total, copy))}</p>`
        : `<h1 class="print-header"><span class="print-header-name">${escapeHtml(ev.name)}</span><span class="print-header-sep">·</span><span class="print-header-kind">回礼明细（续）</span></h1>`
    // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
    page.innerHTML = `${head}
      <table class="returns-print-table"><thead><tr><th>序号</th><th>姓名</th><th>关系</th><th>原礼金</th><th>回礼金额</th><th>次数</th><th>最近回礼</th><th>备注</th><th>类型</th></tr></thead>
      <tbody>${slice
        .map(
          (r, i) =>
            `<tr><td>${p * RETURNS_PER_PAGE + i + 1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.relation)}</td><td class="num">${formatCurrency(r.gift)}</td><td class="num">${formatCurrency(r.total)}</td><td>${r.times}</td><td>${r.lastAt ? escapeHtml(formatDateTime(r.lastAt)) : ''}</td><td class="note-cell">${escapeHtml(r.notes)}</td><td>回礼</td></tr>`,
        )
        .join('')}</tbody></table>
      <div class="returns-print-foot">第 ${p + 1} / ${totalPages} 页 · 已回礼 ${list.length} 位 · 合计 ${formatCurrency(total)}</div>`
    printView.appendChild(page)
    pages.push(page)
  }
  document.body.appendChild(printView)
  const progress = showPdfProgress(pages.length)
  try {
    const css = collectPrintCss() + '\n' + printOptionsCss()
    const images = []
    for (let i = 0; i < pages.length; i += 1) {
      progress.update(`正在排版第 ${i + 1} / ${pages.length} 页…`)
      images.push(await rasterizePrintPage(pages[i], css, themeClass, 2))
    }
    progress.update('正在写入 PDF…')
    const blob = buildPdfBlob(images, PDF_PAGE_W_PT, PDF_PAGE_H_PT)
    downloadBlob(blob, `${safeFileName(ev.name)}_回礼明细.pdf`)
  } catch (error) {
    console.error('回礼 PDF 生成失败:', error)
    showAlert('导出失败', 'PDF 生成失败，请重试；也可改用 Excel 或 Word。')
  } finally {
    progress.close()
    printView.remove()
  }
}

export function exportToWord() {
  const ev = st.currentEvent
  const copy = copyOf(ev, st.homeCategory)
  if (!scopeGifts().length) return showAlert('无法导出', emptyMessage(copy))
  const solemn = isSolemnEvent(ev, st.homeCategory)
  const primary = solemn ? '#374151' : '#a3261e'
  const bg = solemn ? '#eef0f3' : '#fbeceb'
  const dateStr = formatDate(ev.startDateTime)
  const stats = computeLedgerStats(scopeGifts())
  const displayId = ev.displayId ? `No.${ev.displayId}` : ''
  const metaLine = [displayId, dateStr, ev.location, `共 ${stats.totalGivers} 位${copy.peopleNoun}`].filter(Boolean).join('　·　')

  const rows = scopeGifts()
    .map((g, i) => {
      const d = g.data || {}
      const when = formatDateTime(d.timestamp)
      if (d.kind === 'blank') {
        return `<tr><td class="c">${i + 1}</td><td class="name">— 跳过 —</td><td class="num">—</td><td class="cap">—</td><td class="c"></td><td class="c"></td><td class="remark">占位行，不计入人数与金额</td><td class="time">${escapeHtml(when)}</td></tr>`
      }
      const nameChars = Array.from(String(d.name || ''))
      const shownName = nameChars.slice(0, 12).join('') + (nameChars.length > 12 ? '…' : '')
      const amountText = formatCurrency(d.amount)
      return `<tr><td class="c">${i + 1}</td><td class="name">${isLate(g) ? '<span class="late">*补录</span>' : ''}${escapeHtml(shownName)}</td><td class="num${amountText.length > 12 ? ' small' : ''}">${amountText}</td><td class="cap">${escapeHtml(amountToChinese(d.amount))}</td><td class="c">${escapeHtml(d.type || '')}</td><td class="c">${escapeHtml(d.relation || '未分类')}</td><td class="remark">${escapeHtml(d.remarks || '')}</td><td class="time">${escapeHtml(when)}</td></tr>`
    })
    .join('')

  const historyItems = []
  scopeGifts().forEach((g, i) => {
    const data = g.data || {}
    ;(Array.isArray(data.history) ? data.history : []).forEach((entry) => {
      historyItems.push({ index: i + 1, name: data.name || '', log: entry.changeLog || '修改记录', when: formatDateTime(entry.timestamp) })
    })
  })
  const historySection = historyItems.length
    ? `<h2>附：修改记录</h2><table class="appendix"><thead><tr><th style="width:8%">序号</th><th style="width:16%">姓名</th><th>修改内容</th><th style="width:22%">修改时间</th></tr></thead><tbody>${historyItems.map((item) => `<tr><td class="c">${item.index}</td><td class="name">${escapeHtml(item.name)}</td><td class="remark">${escapeHtml(item.log)}</td><td class="time">${escapeHtml(item.when)}</td></tr>`).join('')}</tbody></table><p class="note">共 ${historyItems.length} 条修改留痕。${copy.historyNote}</p>`
    : ''

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escapeHtml(ev.name)}${copy.detailTitle}</title><style>@page { size: A4 portrait; margin: 1.8cm 1.6cm; } body { font-family: "SimSun", "Songti SC", serif; font-size: 10.5pt; color: #222; line-height: 1.5; } .doc-head { border-bottom: 2px solid ${primary}; padding-bottom: 10px; margin-bottom: 16px; } .doc-head .kicker { font-size: 8.5pt; letter-spacing: 4px; color: ${primary}; } .doc-head h1 { font-family: "KaiTi", "STKaiti", serif; font-size: 24pt; color: ${primary}; margin: 6px 0 6px; } .doc-head .meta { font-size: 9pt; color: #666; } table { width: 100%; border-collapse: collapse; font-size: 10pt; table-layout: fixed; } th, td { border: 1px solid #bbb; padding: 5px 6px; vertical-align: middle; } th { background: ${bg}; color: ${primary}; font-weight: bold; font-family: "KaiTi", serif; letter-spacing: .5px; } tr { page-break-inside: avoid; } tr:nth-child(even) td { background: #fafafa; } td.c { text-align: center; } td.num { text-align: center; white-space: nowrap; } td.num.small { font-size: 8pt; } td.name { text-align: center; word-break: break-all; white-space: normal; line-height: 1.35; } td.name .late { display: block; font-size: 8pt; font-weight: bold; color: ${primary}; line-height: 1.2; } td.cap { font-size: 8.5pt; color: #444; line-height: 1.4; word-break: break-all; white-space: normal; } td.time { font-size: 8.5pt; color: #555; white-space: nowrap; text-align: center; } td.remark { text-align: left; word-break: break-word; } h2 { font-family: "KaiTi", serif; font-size: 15pt; color: ${primary}; margin: 20px 0 8px; padding-left: 9px; border-left: 4px solid ${primary}; } .appendix { font-size: 10pt; } .totals { margin-top: 12px; font-size: 10.5pt; } .totals b { color: ${primary}; font-size: 12pt; } .note { margin-top: 8px; font-size: 8.5pt; color: #777; } .foot { margin-top: 18px; padding-top: 8px; border-top: 1px dashed #ccc; font-size: 8.5pt; color: #888; }</style></head><body><div class="doc-head"><div class="kicker">${solemn ? '白 事 · 奠 仪' : '红 事 · 贺 礼'}</div><h1>${escapeHtml(ev.name)} ${copy.detailTitle}</h1><div class="meta">${escapeHtml(metaLine)}</div></div><table><thead><tr><th style="width:5%">序号</th><th style="width:11%">姓名</th><th style="width:11%">金额</th><th style="width:24%">大写金额</th><th style="width:8%">收款方式</th><th style="width:8%">关系</th><th>备注</th><th style="width:15%">录入时间</th></tr></thead><tbody>${rows}</tbody></table><div class="totals">${copy.printTotalGivers}：<b>${stats.totalGivers}</b> 位　${copy.printTotalAmount}：<b>${formatCurrency(stats.totalAmount)}</b></div>${historySection}<div class="foot">本文件由${solemn ? '电子奠仪簿' : '电子礼簿'}导出 · ${new Date().toLocaleString('zh-CN', { hour12: false })}</div></body></html>`
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${safeFileName(ev.name)}_${copy.fileSuffix}.doc`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 1000)
}

export async function exportLedgerPdf() {
  const ev = st.currentEvent
  const copy = copyOf(ev, st.homeCategory)
  if (!scopeGifts().length) return showAlert('无法导出', emptyMessage(copy))
  const printView = buildPrintPages(scopeGifts())
  if (!printView) return
  const pages = Array.from(printView.querySelectorAll('.print-page'))
  const themeClass = isSolemnEvent(ev, st.homeCategory) ? 'theme-solemn' : 'theme-festive'
  const progress = showPdfProgress(pages.length)
  try {
    const css = collectPrintCss() + '\n' + printOptionsCss()
    const images = []
    for (let i = 0; i < pages.length; i += 1) {
      progress.update(`正在排版第 ${i + 1} / ${pages.length} 页…`)
      images.push(await rasterizePrintPage(pages[i], css, themeClass, 2))
    }
    progress.update('正在写入 PDF…')
    const blob = buildPdfBlob(images, PDF_PAGE_W_PT, PDF_PAGE_H_PT)
    downloadBlob(blob, `${safeFileName(ev.name)}_${copy.fileSuffix}.pdf`)
  } catch (error) {
    console.error('PDF 生成失败:', error)
    showAlert('导出失败', 'PDF 生成失败，请重试；若仍失败可改用「打印 → 另存为 PDF」，或先导出 Excel / Word。')
  } finally {
    progress.close()
    printView.remove()
  }
}

function showPdfProgress(total) {
  const box = document.createElement('div')
  box.id = 'pdf-progress'
  // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
  box.innerHTML = `<div class="pdf-progress-card"><span class="pdf-progress-spin" aria-hidden="true"></span><div><b>正在生成 PDF…</b><small id="pdf-progress-text">共 ${total} 页</small></div></div>`
  document.body.appendChild(box)
  return {
    update(text) {
      const el = document.getElementById('pdf-progress-text')
      if (el) el.textContent = text
    },
    close() {
      box.remove()
    },
  }
}

export { prepareForPrint }
