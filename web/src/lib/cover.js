// 封面渲染：与旧版完全相同的 markup（屏幕预览、打印、PDF 共用一套）。
import { BLESSINGS, COVER_CORNERS, COVER_TASSEL, getCoverTemplate, getCoverStyle, isSolemnEvent } from './content.js'
import { escapeHtml } from './crypto.js'

function coverDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function renderCoverMarkup(event = {}, compact = false, homeCategory = 'red') {
  const t = getCoverTemplate(event, homeCategory)
  const solemn = isSolemnEvent(event, homeCategory)
  const style = getCoverStyle(event, homeCategory)
  const date = coverDate(event.startDateTime)
  const corner = COVER_CORNERS[style.corners] || COVER_CORNERS.floral
  const corners = ['tl', 'tr', 'bl', 'br']
    .map((side) => `<svg class="cover-corner cover-corner-${side}" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">${corner}</svg>`)
    .join('')
  const title = compact ? t.name + '礼簿' : event.name || '账簿名称'
  return `<div class="ledger-cover ${solemn ? 'solemn' : ''}" data-style="${style.id}" data-theme="${style.theme}" data-frame="${style.frame}" data-layout="${style.layout}" data-weave="${style.weave ? '1' : '0'}" data-template="${t.key}">
    <div class="cover-spine" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    ${corners}
    ${style.label ? `<div class="cover-toplabel">${escapeHtml(style.label)}</div>` : ''}
    <div class="cover-edition">${solemn ? '肃穆礼记' : '喜事礼记'}</div>
    ${style.medallion ? `<div class="cover-medallion" aria-hidden="true">${t.glyph}</div>` : ''}
    ${style.tassel ? COVER_TASSEL : ''}
    <div class="cover-name" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
    <div class="cover-blessing">${BLESSINGS[t.key] || ''}</div>
    ${!compact && (date || event.location) ? `<div class="cover-meta">${escapeHtml(date)}${event.location ? `<br>${escapeHtml(event.location)}` : ''}</div>` : ''}
    <div class="cover-seal" aria-hidden="true">${t.glyph}</div>
  </div>`
}
