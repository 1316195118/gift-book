// 封面渲染：与旧版完全相同的 markup（屏幕预览、打印、PDF 共用一套）。
import { BLESSINGS, COVER_CORNERS, COVER_MOTIFS, COVER_TASSEL, getCoverTemplate, getCoverStyle, isSolemnEvent, categoryForEvent } from './content.js'
import { escapeHtml } from './crypto.js'
import { coverArtworkFor } from './cover-art.js'

function coverDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function renderCoverMarkup(event = {}, compact = false, homeCategory = 'red') {
  const t = getCoverTemplate(event, homeCategory)
  const solemn = isSolemnEvent(event, homeCategory)
  const category = categoryForEvent(event, homeCategory)
  const style = getCoverStyle(event, homeCategory)
  const artwork = coverArtworkFor(style)
  const date = coverDate(event.startDateTime)
  const corner = COVER_CORNERS[style.corners] || COVER_CORNERS.floral
  const corners = ['tl', 'tr', 'bl', 'br']
    .map((side) => `<svg class="cover-corner cover-corner-${side}" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">${corner}</svg>`)
    .join('')
  // 自定义账簿不再套用「礼簿」：模板名本身就是班费、会费、活动款等业务称谓。
  const title = compact
    ? (category === 'custom' ? t.name : t.name + '礼簿')
    : (event.name || '账簿名称')
  const artSrc = escapeHtml(artwork.src)
  return `<div class="ledger-cover ${solemn ? 'solemn' : ''}" data-style="${style.id}" data-theme="${style.theme}" data-frame="${style.frame}" data-layout="${style.layout}" data-weave="${style.weave ? '1' : '0'}" data-template="${t.key}" data-art="${artwork.art}" data-panel="${artwork.panel}" data-ornament="${artwork.ornament}" data-tone="${artwork.tone}">
    <div class="cover-artwork" aria-hidden="true">
      <img class="cover-art" src="${artSrc}" data-cover-src="${artSrc}" alt="" width="1440" height="1920" decoding="async" fetchpriority="high" draggable="false" style="object-position:${artwork.focus}" />
      <span class="cover-art-wash"></span>
      <span class="cover-art-vignette"></span>
      <span class="cover-art-grain"></span>
    </div>
    <div class="cover-spine" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    ${corners}
    ${style.label ? `<div class="cover-toplabel">${escapeHtml(style.label)}</div>` : ''}
    <div class="cover-motif-wrap" aria-hidden="true">${COVER_MOTIFS[t.key] || ''}</div>
    ${style.medallion ? `<div class="cover-medallion" aria-hidden="true">${t.glyph}</div>` : ''}
    ${style.tassel ? COVER_TASSEL : ''}
    <div class="cover-title-panel">
      <div class="cover-edition"><span>${solemn ? '肃穆礼记' : category === 'custom' ? '通用记录' : '喜事礼记'}</span></div>
      <div class="cover-name" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="cover-blessing">${BLESSINGS[t.key] || ''}</div>
    </div>
    ${!compact && (date || event.location) ? `<div class="cover-meta">${escapeHtml(date)}${event.location ? `<br>${escapeHtml(event.location)}` : ''}</div>` : ''}
    <div class="cover-seal" aria-hidden="true">${t.glyph}</div>
  </div>`
}
