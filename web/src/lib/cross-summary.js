// 跨账簿汇总：把本会话可解密的多个账簿按「姓名」聚合，看某人在各场事里的累计人情。
//
// 安全边界：礼金内容在浏览器端加密，服务端只有密文；会话只保存当前账簿的密码明文
// 与其他账簿的 ledgerKey（密钥摘要），因此只能汇总：
//   1) 无密码账簿；2) 与当前账簿同密码的账簿；3) 本会话内已解锁且密码可复用的账簿。
// 其余账簿会列在「需单独解锁」里，不臆造数据。
import { state as st, ledgerKeyForEvent, NO_PASSWORD_KEY } from '../store.js'
import { api } from './api.js'
import { decryptData } from '../bootstrap.js'
import { openModal, alert as showAlert } from './modal.js'
import { escapeHtml, formatCurrency } from './crypto.js'

export async function openCrossSummary() {
  let events = []
  try {
    const res = await api.listEvents()
    events = Array.isArray(res.data) ? res.data : Array.isArray(res.events) ? res.events : []
  } catch (error) {
    return showAlert('无法读取账簿列表', error.message || '请检查网络后重试。')
  }
  if (!events.length) return showAlert('没有账簿', '当前还没有任何账簿。')

  const passwords = [...new Set([st.currentPassword, NO_PASSWORD_KEY].filter((p) => typeof p === 'string'))]
  const byName = new Map()
  const skipped = []
  let scannedEvents = 0
  let scannedGifts = 0

  for (const ev of events) {
    const key = ledgerKeyForEvent(ev.id)
    if (ev.hasPassword && !key) {
      skipped.push({ name: ev.name, reason: '需先单独打开解锁' })
      continue
    }
    let list = null
    try {
      const res = await api.listGifts(ev.id, key)
      list = res.data || {}
    } catch (error) {
      skipped.push({ name: ev.name, reason: error.message || '读取失败' })
      continue
    }
    let unlocked = false
    for (const gift of Object.values(list)) {
      const cipher = gift?.encryptedContent
      if (!cipher) continue
      let data = null
      for (const pwd of passwords) {
        try {
          data = decryptData(cipher, pwd)
          break
        } catch {
          /* 换下一个密码 */
        }
      }
      if (!data?.name) continue
      unlocked = true
      scannedGifts += 1
      const amount = Number(data.amount) || 0
      const rec = byName.get(data.name) || { name: data.name, count: 0, total: 0, events: new Set(), relations: new Set() }
      rec.count += 1
      rec.total += amount
      rec.events.add(ev.name)
      if (data.relation) rec.relations.add(data.relation)
      byName.set(data.name, rec)
    }
    if (unlocked) scannedEvents += 1
    else if (Object.keys(list).length) skipped.push({ name: ev.name, reason: '密码不同，无法解密' })
  }

  const rows = [...byName.values()].sort((a, b) => b.total - a.total)
  renderSummary(rows, skipped, { scannedEvents, scannedGifts, totalEvents: events.length })
}

function renderSummary(rows, skipped, meta) {
  const head = `<div class="modal-notice modal-notice-warn" style="margin-bottom:10px"><strong>范围：</strong>已汇总 ${meta.scannedEvents} / ${meta.totalEvents} 本账簿、${meta.scannedGifts} 条记录。跨账簿只统计本会话可解密的账簿（无密码、同密码或已解锁）。</div>`
  const table = rows.length
    ? `<div style="overflow:auto"><table class="stats-table" style="width:100%"><thead><tr><th>姓名</th><th class="num">笔数</th><th class="num">累计金额</th><th class="num">涉及账簿</th><th>关系</th></tr></thead><tbody>${rows
        .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.count}</td><td class="num">${formatCurrency(r.total)}</td><td class="num">${r.events.size}</td><td>${escapeHtml([...r.relations].join('、') || '—')}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="empty">没有可汇总的记录。</p>'
  const skippedBox = skipped.length
    ? `<div class="modal-notice" style="margin-top:10px"><strong>未纳入（${skipped.length} 本）：</strong><ul>${skipped.slice(0, 10).map((s) => `<li>${escapeHtml(s.name)} — ${escapeHtml(s.reason)}</li>`).join('')}</ul>${skipped.length > 10 ? '<p class="hint">…仅显示前 10 本</p>' : ''}</div>`
    : ''
  openModal('跨账簿汇总', { type: 'html', html: head + table + skippedBox }, [{ text: '关闭', class: 'border themed-button-secondary px-4 py-2 rounded' }], { size: 'large' })
}
