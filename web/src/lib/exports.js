// 导出：Excel 明细、PDF 礼簿（A4 横向）、Word 文档（A4 纵向）。
import { state as st } from '../store.js'
import { openModal, closeModal, alert as showAlert } from './modal.js'
import { copyOf, isSolemnEvent } from './content.js'
import { amountToChinese, formatCurrency, escapeHtml } from './crypto.js'
import { buildPrintPages, prepareForPrint, PDF_PAGE_W_PT, PDF_PAGE_H_PT, collectPrintCss, rasterizePrintPage, buildPdfBlob, downloadBlob, printOptionsCss } from './printing.js'
import { XlsxLite } from './crypto.js'

const ITEMS_PER_PAGE = 12

export function openExport() {
  const ev = st.currentEvent
  if (!ev) return
  const copy = copyOf(ev, st.homeCategory)
  if (!st.gifts.length) return showAlert('无法导出', copy.exportEmpty)
  openModal(
    '',
    {
      type: 'export',
      eventName: ev.name,
      count: st.gifts.length,
      recordsLabel: copy.recordsLabel,
      bookTitle: copy.bookTitle,
      onPick: (format) => {
        if (format === 'excel') setTimeout(() => exportToExcel(), 80)
        if (format === 'pdf') setTimeout(() => exportLedgerPdf(), 120)
        if (format === 'word') setTimeout(() => exportToWord(), 80)
      },
    },
    [],
    { size: 'unlock', theme: isSolemnEvent(ev, st.homeCategory) ? 'theme-solemn' : 'theme-festive' },
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

function computeStats() {
  const out = { totalAmount: 0, totalGivers: st.gifts.length }
  st.gifts.forEach(({ data }) => {
    if (data) out.totalAmount += Number(data.amount) || 0
  })
  return out
}

export function exportToExcel() {
  const ev = st.currentEvent
  const copy = copyOf(ev, st.homeCategory)
  if (!st.gifts.length) return showAlert('无法导出', copy.exportEmpty)
  const stats = computeStats()
  const dateStr = new Date(ev.startDateTime).toLocaleDateString('zh-CN')
  const displayId = ev.displayId ? `No.${ev.displayId}` : ''
  const metaLine = [displayId, dateStr, ev.location, `共 ${stats.totalGivers} 位${copy.peopleNoun}`].filter(Boolean).join('　·　')
  const style = { title: 1, meta: 2, head: 3, center: 4, text: 5, money: 6, total: 7 }

  const rows = [
    [{ v: `${ev.name} ${copy.detailTitle}`, s: style.title }, null, null, null, null, null, null],
    [{ v: metaLine, s: style.meta }, null, null, null, null, null, null],
    [null],
    ['序号', '姓名', '金额', '大写金额', '收款方式', '备注', '录入时间'].map((v) => ({ v, s: style.head })),
  ]
  st.gifts.forEach((g, i) => {
    const d = g.data || {}
    rows.push([
      { v: i + 1, s: style.center },
      { v: `${isLate(g) ? '*补录 ' : ''}${d.name || ''}`, s: style.center },
      { v: Number(d.amount) || 0, s: style.money },
      { v: amountToChinese(d.amount), s: style.text },
      { v: d.type || '', s: style.center },
      { v: d.remarks || '', s: style.text },
      { v: d.timestamp ? new Date(d.timestamp).toLocaleString('zh-CN', { hour12: false }) : '', s: style.center },
    ])
  })
  const lastDataRow = rows.length
  rows.push([{ v: `${copy.printTotalGivers}：${stats.totalGivers} 位　　${copy.printTotalAmount}：${formatCurrency(stats.totalAmount)}`, s: style.total }, null, null, null, null, null, null])

  const rowHeights = { 1: 30, 2: 20, 3: 8, 4: 24 }
  for (let r = 5; r <= lastDataRow; r += 1) rowHeights[r] = 22
  rowHeights[lastDataRow + 1] = 24

  const sheets = [
    {
      name: copy.detailTitle,
      widths: [6, 14, 14, 26, 10, 30, 20],
      rows,
      merges: ['A1:G1', 'A2:G2', `A${lastDataRow + 1}:G${lastDataRow + 1}`],
      rowHeights,
      freeze: { ySplit: 4, topLeft: 'A5' },
      autoFilter: `A4:G${lastDataRow}`,
    },
  ]

  const history = []
  st.gifts.forEach((g, i) => {
    const d = g.data || {}
    ;(Array.isArray(d.history) ? d.history : []).forEach((entry) => {
      history.push([
        { v: i + 1, s: style.center },
        { v: d.name || '', s: style.center },
        { v: entry.changeLog || '修改记录', s: style.text },
        { v: entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false }) : '', s: style.center },
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
      widths: [6, 14, 52, 22],
      rows: historyRows,
      merges: ['A1:D1', 'A2:D2'],
      rowHeights: historyHeights,
      freeze: { ySplit: 4, topLeft: 'A5' },
      autoFilter: `A4:D${historyRows.length}`,
    })
  }
  XlsxLite.downloadWorkbook(sheets, `${ev.name}_${copy.fileSuffix}.xlsx`)
}

export function exportToWord() {
  const ev = st.currentEvent
  const copy = copyOf(ev, st.homeCategory)
  if (!st.gifts.length) return showAlert('无法导出', copy.exportEmpty)
  const solemn = isSolemnEvent(ev, st.homeCategory)
  const primary = solemn ? '#374151' : '#a3261e'
  const bg = solemn ? '#eef0f3' : '#fbeceb'
  const dateStr = new Date(ev.startDateTime).toLocaleDateString('zh-CN')
  const stats = computeStats()
  const displayId = ev.displayId ? `No.${ev.displayId}` : ''
  const metaLine = [displayId, dateStr, ev.location, `共 ${stats.totalGivers} 位${copy.peopleNoun}`].filter(Boolean).join('　·　')

  const rows = st.gifts
    .map((g, i) => {
      const d = g.data || {}
      const when = d.timestamp ? new Date(d.timestamp).toLocaleString('zh-CN', { hour12: false }) : ''
      const nameChars = Array.from(String(d.name || ''))
      const shownName = nameChars.slice(0, 12).join('') + (nameChars.length > 12 ? '…' : '')
      const nameClass = nameChars.length === 1 ? ' len1' : nameChars.length === 2 ? ' len2' : ''
      const amountText = formatCurrency(d.amount)
      return `<tr><td class="c">${i + 1}</td><td class="name${nameClass}">${isLate(g) ? '<span class="late">*补录</span>' : ''}${escapeHtml(shownName)}</td><td class="num${amountText.length > 12 ? ' small' : ''}">${amountText}</td><td class="cap">${escapeHtml(amountToChinese(d.amount))}</td><td class="c">${escapeHtml(d.type || '')}</td><td class="remark">${escapeHtml(d.remarks || '')}</td><td class="time">${escapeHtml(when)}</td></tr>`
    })
    .join('')

  const historyItems = []
  st.gifts.forEach((g, i) => {
    const data = g.data || {}
    ;(Array.isArray(data.history) ? data.history : []).forEach((entry) => {
      historyItems.push({ index: i + 1, name: data.name || '', log: entry.changeLog || '修改记录', when: entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN', { hour12: false }) : '' })
    })
  })
  const historySection = historyItems.length
    ? `<h2>附：修改记录</h2><table class="appendix"><thead><tr><th style="width:8%">序号</th><th style="width:16%">姓名</th><th>修改内容</th><th style="width:22%">修改时间</th></tr></thead><tbody>${historyItems.map((item) => `<tr><td class="c">${item.index}</td><td class="name">${escapeHtml(item.name)}</td><td class="remark">${escapeHtml(item.log)}</td><td class="time">${escapeHtml(item.when)}</td></tr>`).join('')}</tbody></table><p class="note">共 ${historyItems.length} 条修改留痕。${copy.historyNote}</p>`
    : ''

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escapeHtml(ev.name)}${copy.detailTitle}</title><style>@page { size: A4 portrait; margin: 1.8cm 1.6cm; } body { font-family: "SimSun", "Songti SC", serif; font-size: 10.5pt; color: #222; line-height: 1.5; } .doc-head { border-bottom: 2px solid ${primary}; padding-bottom: 10px; margin-bottom: 16px; } .doc-head .kicker { font-size: 8.5pt; letter-spacing: 4px; color: ${primary}; } .doc-head h1 { font-family: "KaiTi", "STKaiti", serif; font-size: 24pt; color: ${primary}; margin: 6px 0 6px; } .doc-head .meta { font-size: 9pt; color: #666; } table { width: 100%; border-collapse: collapse; font-size: 10pt; table-layout: fixed; } th, td { border: 1px solid #bbb; padding: 5px 6px; vertical-align: middle; } th { background: ${bg}; color: ${primary}; font-weight: bold; font-family: "KaiTi", serif; letter-spacing: .5px; } tr { page-break-inside: avoid; } tr:nth-child(even) td { background: #fafafa; } td.c { text-align: center; } td.num { text-align: center; white-space: nowrap; } td.num.small { font-size: 8pt; } td.name { text-align: center; word-break: break-all; white-space: normal; line-height: 1.35; } td.name .late { display: block; font-size: 8pt; font-weight: bold; color: ${primary}; line-height: 1.2; } td.name.len2 { letter-spacing: .6em; padding-left: .6em; } td.cap { font-size: 8.5pt; color: #444; line-height: 1.4; word-break: break-all; white-space: normal; } td.time { font-size: 8.5pt; color: #555; white-space: nowrap; text-align: center; } td.remark { text-align: left; word-break: break-word; } h2 { font-family: "KaiTi", serif; font-size: 15pt; color: ${primary}; margin: 20px 0 8px; padding-left: 9px; border-left: 4px solid ${primary}; } .appendix { font-size: 10pt; } .totals { margin-top: 12px; font-size: 10.5pt; } .totals b { color: ${primary}; font-size: 12pt; } .note { margin-top: 8px; font-size: 8.5pt; color: #777; } .foot { margin-top: 18px; padding-top: 8px; border-top: 1px dashed #ccc; font-size: 8.5pt; color: #888; }</style></head><body><div class="doc-head"><div class="kicker">${solemn ? '白 事 · 奠 仪' : '红 事 · 贺 礼'}</div><h1>${escapeHtml(ev.name)} ${copy.detailTitle}</h1><div class="meta">${escapeHtml(metaLine)}</div></div><table><thead><tr><th style="width:5%">序号</th><th style="width:11%">姓名</th><th style="width:11%">金额</th><th style="width:27%">大写金额</th><th style="width:8%">收款方式</th><th>备注</th><th style="width:16%">录入时间</th></tr></thead><tbody>${rows}</tbody></table><div class="totals">${copy.printTotalGivers}：<b>${stats.totalGivers}</b> 位　${copy.printTotalAmount}：<b>${formatCurrency(stats.totalAmount)}</b></div>${historySection}<div class="foot">本文件由${solemn ? '电子奠仪簿' : '电子礼簿'}导出 · ${new Date().toLocaleString('zh-CN', { hour12: false })}</div></body></html>`
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${ev.name}_${copy.fileSuffix}.doc`
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
  if (!st.gifts.length) return showAlert('无法导出', copy.exportEmpty)
  const printView = buildPrintPages()
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
    downloadBlob(blob, `${ev.name}_${copy.fileSuffix}.pdf`)
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
