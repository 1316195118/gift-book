// 未回礼名单：一次勾选多笔并批量登记回礼，也可把名单导成 Excel。
// 白事账簿不提供回礼，入口与函数都做了兜底。
import { state as st } from '../store.js'
import { openModal, closeModal, afterModalRender, alert as showAlert } from './modal.js'
import { escapeHtml, formatCurrency, XlsxLite } from './crypto.js'
import { copyOf, isSolemnEvent } from './content.js'
import { appendReturn, hasReturned } from './return-gift.js'
import { isArchived } from './archive.js'
import { updateWithHistory } from './ledger-actions.js'
import { syncEventTotal, loadGiftsForCurrentEvent } from '../bootstrap.js'
import { notify } from './notify.js'

const PAGE = 40
const MAX_BATCH = 50
const MIN_AMOUNT = 0.01
const MAX_AMOUNT = 1000000
const XLSX_THEME = { accent: 'FFAB2B21', soft: 'FFF9EAE4', paper: 'FFFAF4E9', line: 'FFE9DDC7', ink: 'FF241C14' }

function pendingGifts() {
  return (Array.isArray(st.gifts) ? st.gifts : []).filter((gift) => gift?.data && !hasReturned(gift.data))
}

export function openPendingReturns() {
  const ev = st.currentEvent
  if (!ev) return
  if (isSolemnEvent(ev, st.homeCategory)) {
    return showAlert('不支持', '白事账簿不提供回礼功能，也就没有未回礼名单。')
  }
  const copy = copyOf(ev, st.homeCategory)
  const all = pendingGifts()
  if (!all.length) {
    return showAlert('没有待回礼记录', `这本账簿的${copy.peopleNoun}都已登记过回礼，也可以到「导出 → 回礼明细」查看明细。`)
  }
  const selected = new Set()
  const rowAmounts = new Map()
  let keyword = ''
  let shown = PAGE
  const totalGift = all.reduce((sum, gift) => sum + (Number(gift.data.amount) || 0), 0)

  const html = `
    <div id="gb-pending-picker" class="gb-picker">
      <p class="gb-picker-intro">共 <b>${all.length}</b> 位${escapeHtml(copy.peopleNoun)}尚未回礼，原礼金合计 ${formatCurrency(totalGift)}。勾选后可一次登记回礼，也可以只导名单。</p>
      <div class="gb-form-grid">
        <div class="field"><label for="gb-pending-common">统一回礼金额（元）</label><input type="number" id="gb-pending-common" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="留空则逐行填写" /></div>
        <div class="field"><label for="gb-pending-note">回礼备注（选填）</label><input type="text" id="gb-pending-note" maxlength="200" placeholder="如：回赠茶叶" /></div>
      </div>
      <p class="gb-picker-hint">每行也可以单独填金额，优先于上面的统一金额；留空则使用统一金额。「导出名单」优先导出勾选的人，没勾选则导出当前筛选结果。每次登记都会写入修改痕迹，可随时在详情里撤销。</p>
      <div class="gb-picker-filters"><input type="search" id="gb-pending-keyword" placeholder="按姓名 / 备注查找" autocomplete="off" /></div>
      <div class="gb-picker-tools">
        <span id="gb-pending-count" class="gb-picker-count"></span>
        <span class="gb-picker-actions">
          <button type="button" class="gb-link-btn" data-pending-act="all">全选当前结果</button>
          <button type="button" class="gb-link-btn" data-pending-act="none">清空</button>
        </span>
      </div>
      <div id="gb-pending-list" class="gb-picker-list"></div>
      <div id="gb-pending-error" class="gb-inline-error" role="alert"></div>
      ${isArchived() ? '<p class="gb-inline-warn">这本账簿已结簿，处于只读状态；需要登记回礼请先到「设置」解除结簿。</p>' : ''}
    </div>`

  const setError = (text) => {
    const el = document.getElementById('gb-pending-error')
    if (el) el.textContent = text || ''
  }

  const visible = () => {
    const kw = keyword.trim().toLowerCase()
    return all.filter((gift) => {
      const data = gift.data || {}
      return !kw || `${data.name || ''} ${data.remarks || ''}`.toLowerCase().includes(kw)
    })
  }

  const render = () => {
    const list = document.getElementById('gb-pending-list')
    if (!list) return
    const matched = visible()
    const rows = matched
      .slice(0, shown)
      .map((gift) => {
        const data = gift.data || {}
        const id = escapeHtml(String(gift.id))
        const when = data.timestamp ? new Date(data.timestamp).toLocaleDateString('zh-CN') : ''
        return `<div class="gb-pick-row" data-row-id="${id}">
          <input type="checkbox" data-pending-id="${id}" ${selected.has(String(gift.id)) ? 'checked' : ''} aria-label="选择 ${escapeHtml(data.name || '')}" />
          <div class="gb-pick-main"><span class="gb-pick-name">${escapeHtml(data.name || '（无名）')}</span><span class="gb-pick-meta">${escapeHtml(data.relation || '未分类')} · 原礼金 ${formatCurrency(Number(data.amount) || 0)} · ${escapeHtml(when)}</span></div>
          <input type="number" class="gb-pick-amount-input" data-pending-amount="${id}" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="单独金额" value="${escapeHtml(rowAmounts.get(String(gift.id)) || '')}" aria-label="${escapeHtml(data.name || '')} 本次回礼金额" />
        </div>`
      })
      .join('')
    const more = matched.length > shown
      ? `<button type="button" class="gb-more-btn" data-pending-act="more">显示更多（还有 ${matched.length - shown} 条）</button>`
      : ''
    list.innerHTML = matched.length ? rows + more : '<div class="gb-empty">没有符合条件的记录。</div>'
    const counter = document.getElementById('gb-pending-count')
    if (counter) counter.textContent = `已选 ${selected.size} 位 / 共 ${all.length} 位待回礼`
  }

  const checkedRows = () => {
    const common = Number(document.getElementById('gb-pending-common')?.value)
    const note = String(document.getElementById('gb-pending-note')?.value || '').trim().slice(0, 200)
    const rows = []
    for (const id of selected) {
      const gift = st.gifts.find((item) => String(item.id) === id)
      if (!gift || hasReturned(gift.data)) continue
      const per = Number(rowAmounts.get(id))
      const amount = Number.isFinite(per) && per > 0 ? per : common
      rows.push({ id, amount, note })
    }
    return rows
  }

  const exportList = () => {
    const chosen = new Set(selected)
    // 勾了人只导勾中的；没勾时导当前筛选结果，避免导出一堆无关姓名。
    const list = chosen.size ? all.filter((gift) => chosen.has(String(gift.id))) : visible()
    if (!list.length) return setError('当前没有可导出的名单。')
    exportPendingExcel(list)
  }

  let busy = false
  const submit = async () => {
    if (busy) return
    if (isArchived()) return setError('账簿已结簿，请先解除结簿再登记回礼。')
    const rows = checkedRows()
    if (!rows.length) return setError('请先勾选要登记回礼的人。')
    for (const row of rows) {
      if (!Number.isFinite(row.amount) || row.amount < MIN_AMOUNT || row.amount > MAX_AMOUNT) {
        return setError(`「${st.gifts.find((g) => String(g.id) === row.id)?.data?.name || '某位'}」的回礼金额需在 0.01 ~ 1,000,000 元之间；请填统一金额或逐行填写。`)
      }
      if (Math.abs(Math.round(row.amount * 100) - row.amount * 100) > 0.0001) {
        return setError('回礼金额最多保留两位小数。')
      }
    }
    if (rows.length > MAX_BATCH) return setError(`一次最多登记 ${MAX_BATCH} 位，请分批操作。`)
    busy = true
    setError('正在登记回礼，请勿关闭页面…')
    let success = 0
    let failed = 0
    try {
      for (const row of rows) {
        const index = st.gifts.findIndex((gift) => String(gift.id) === row.id)
        if (index < 0) {
          failed += 1
          continue
        }
        const patch = appendReturn(st.gifts[index].data, row.amount, row.note)
        const log = `批量登记第 ${patch.returnRecords.length} 次回礼 ${formatCurrency(row.amount)}${row.note ? `（${row.note}）` : ''}`
        const done = await updateWithHistory(index, patch, log, { silent: true })
        if (done) success += 1
        else failed += 1
      }
      closeModal()
      syncEventTotal()
      if (failed) await loadGiftsForCurrentEvent()
      notify.success(
        `已登记 ${success} 位回礼`,
        failed ? `另有 ${failed} 位未成功，已重新同步账簿，请核对后再试。` : '每笔都写入了修改痕迹，可在礼金详情里查看或撤销。',
        { duration: 5000 },
      )
    } finally {
      busy = false
    }
  }

  // 批量登记按钮放在内容里，方便在弹窗中保持列表与勾选状态。
  openModal(
    '未回礼名单',
    { type: 'html', html },
    [
      { text: '关闭', class: 'modal-btn-ghost' },
      { text: '导出名单（Excel）', class: 'modal-btn-ghost', keepOpen: true, handler: exportList },
      {
        text: isArchived() ? '已结簿 · 不能登记' : '登记回礼',
        class: 'modal-btn-primary',
        keepOpen: true,
        handler: isArchived()
          ? () => setError('账簿已结簿，请先到「设置 → 结簿归档」解除结簿再登记回礼。')
          : () => submit().catch(() => setError('登记失败，请刷新后重试。')),
      },
    ],
    { size: 'large', dismissable: true },
  )

  afterModalRender(() => {
    const root = document.getElementById('gb-pending-picker')
    if (!root) return
    root.addEventListener('input', (event) => {
      if (event.target.id === 'gb-pending-keyword') {
        keyword = event.target.value
        shown = PAGE
        render()
        return
      }
      const amountInput = event.target.closest('[data-pending-amount]')
      if (amountInput) rowAmounts.set(amountInput.dataset.pendingAmount, amountInput.value)
    })
    root.addEventListener('change', (event) => {
      const box = event.target.closest('[data-pending-id]')
      if (!box) return
      if (box.checked) selected.add(box.dataset.pendingId)
      else selected.delete(box.dataset.pendingId)
      setError('')
      render()
    })
    root.addEventListener('click', (event) => {
      const act = event.target.closest('[data-pending-act]')?.dataset.pendingAct
      if (act === 'more') {
        shown += PAGE
        render()
        return
      }
      if (act === 'all') {
        visible().forEach((gift) => selected.add(String(gift.id)))
        setError('')
        render()
        return
      }
      if (act === 'none') {
        selected.clear()
        render()
        return
      }
    })
    render()
  })
}

export function exportPendingExcel(list) {
  const ev = st.currentEvent
  if (!ev) return
  const copy = copyOf(ev, st.homeCategory)
  const rows = [
    [{ v: `${ev.name} 未回礼名单`, s: 1 }, null, null, null, null, null],
    [{ v: `共 ${list.length} 位${copy.peopleNoun}尚未回礼　·　导出于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, s: 2 }, null, null, null, null, null],
    [null],
    ['序号', '姓名', '关系', '原礼金', '录入时间', '备注'].map((v) => ({ v, s: 3 })),
  ]
  list.forEach((gift, i) => {
    const data = gift.data || {}
    rows.push([
      { v: i + 1, s: 4 },
      { v: data.name || '', s: 4 },
      { v: data.relation || '未分类', s: 4 },
      { v: Number(data.amount) || 0, s: 6 },
      { v: data.timestamp ? new Date(data.timestamp).toLocaleString('zh-CN', { hour12: false }) : '', s: 4 },
      { v: data.remarks || '', s: 5 },
    ])
  })
  const last = rows.length
  const total = list.reduce((sum, gift) => sum + (Number(gift.data?.amount) || 0), 0)
  rows.push([{ v: `合计：${list.length} 位　·　原礼金 ${formatCurrency(total)}`, s: 7 }, null, null, null, null, null])
  const rowHeights = { 1: 30, 2: 20, 3: 8, 4: 24 }
  for (let r = 5; r <= last; r += 1) rowHeights[r] = 22
  rowHeights[last + 1] = 24
  XlsxLite.downloadWorkbook(
    [
      {
        name: '未回礼名单',
        theme: XLSX_THEME,
        widths: [6, 16, 12, 14, 22, 34],
        rows,
        merges: ['A1:F1', 'A2:F2', `A${last + 1}:F${last + 1}`],
        rowHeights,
        freeze: { ySplit: 4, topLeft: 'A5' },
        autoFilter: `A4:F${last}`,
      },
    ],
    `${ev.name}_未回礼名单.xlsx`,
  )
}
