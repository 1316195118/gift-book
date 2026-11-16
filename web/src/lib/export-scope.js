// 导出范围：整本账簿 / 仅勾选的记录。
// Excel、PDF、Word 与回礼明细共用同一份选中集合，避免各格式口径不一致。
import { reactive } from 'vue'
import { state as st } from '../store.js'
import { openModal, afterModalRender } from './modal.js'
import { escapeHtml, formatCurrency, formatDate } from './crypto.js'
import { isSolemnEvent, RELATION_OPTIONS } from './content.js'
import { hasReturned } from './return-gift.js'

const PAGE = 40

export const exportScope = reactive({ mode: 'all', ids: [] })

export function resetExportScope() {
  exportScope.mode = 'all'
  exportScope.ids = []
}

// 每次导出都重新取一次，避免选中某条后礼簿刷新导致引用失效。
export function scopeGifts() {
  const all = Array.isArray(st.gifts) ? st.gifts : []
  if (exportScope.mode !== 'selected') return all
  const chosen = new Set(exportScope.ids.map(String))
  return all.filter((gift) => chosen.has(String(gift.id)))
}

export function scopeInfo() {
  const total = Array.isArray(st.gifts) ? st.gifts.length : 0
  const count = scopeGifts().length
  return {
    active: exportScope.mode === 'selected',
    total,
    count,
    label: exportScope.mode === 'selected' ? `仅选中的 ${count} 条` : `整本账簿 ${total} 条`,
  }
}

export function scopeEmptyMessage() {
  return '当前导出范围内没有记录。请回到「导出 → 选择记录」重新勾选，或改用整本账簿。'
}

export function openScopePicker(onDone) {
  const ev = st.currentEvent
  if (!ev) return
  const all = Array.isArray(st.gifts) ? [...st.gifts] : []
  const selected = new Set(exportScope.mode === 'selected' ? exportScope.ids.map(String) : [])
  const filter = { keyword: '', relation: '', returned: '' }
  let shown = PAGE
  const solemn = isSolemnEvent(ev, st.homeCategory)
  const relations = [...new Set([...RELATION_OPTIONS, ...all.map((g) => g.data?.relation).filter(Boolean)])]

  const html = `
    <div id="gb-scope-picker" class="gb-picker">
      <div class="gb-picker-filters">
        <input type="search" id="gb-scope-keyword" placeholder="按姓名 / 备注查找" autocomplete="off" />
        <select id="gb-scope-relation"><option value="">全部关系</option>${relations.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select>
        ${solemn ? '' : '<select id="gb-scope-returned"><option value="">全部回礼状态</option><option value="yes">已回礼</option><option value="no">未回礼</option></select>'}
      </div>
      <div class="gb-picker-tools">
        <span id="gb-scope-count" class="gb-picker-count"></span>
        <span class="gb-picker-actions">
          <button type="button" class="gb-link-btn" data-scope-act="all">全选当前结果</button>
          <button type="button" class="gb-link-btn" data-scope-act="none">清空</button>
        </span>
      </div>
      <div id="gb-scope-list" class="gb-picker-list"></div>
      <div id="gb-scope-error" class="gb-inline-error" role="alert"></div>
      <p class="gb-picker-hint">勾选后点「确定」，Excel / PDF / Word 与回礼明细都只导出这些记录，合计也按所选范围计算；切换账簿会自动恢复为整本。</p>
    </div>`

  const setError = (text) => {
    const el = document.getElementById('gb-scope-error')
    if (el) el.textContent = text || ''
  }

  const visible = () => {
    const keyword = filter.keyword.trim().toLowerCase()
    return all.filter((gift) => {
      const data = gift.data || {}
      if (keyword && !`${data.name || ''} ${data.remarks || ''}`.toLowerCase().includes(keyword)) return false
      if (filter.relation && (data.relation || '未分类') !== filter.relation) return false
      if (filter.returned === 'yes' && !hasReturned(data)) return false
      if (filter.returned === 'no' && hasReturned(data)) return false
      return true
    })
  }

  // 勾选时只更新计数，不重建整张列表，避免输入框失焦、长列表滚动位置丢失。
  const updateCounter = (matchedCount) => {
    const counter = document.getElementById('gb-scope-count')
    if (counter) counter.textContent = `已选 ${selected.size} 条 · 筛选 ${matchedCount} 条 · 全本 ${all.length} 条`
  }

  const render = () => {
    const list = document.getElementById('gb-scope-list')
    if (!list) return
    const matched = visible()
    const rows = matched
      .slice(0, shown)
      .map((gift) => {
        const data = gift.data || {}
        const id = escapeHtml(String(gift.id))
        const when = formatDate(data.timestamp)
        return `<div class="gb-pick-row" data-row-id="${id}">
          <input type="checkbox" data-scope-id="${id}" ${selected.has(String(gift.id)) ? 'checked' : ''} aria-label="选择 ${escapeHtml(data.name || '')}" />
          <div class="gb-pick-main"><span class="gb-pick-name">${escapeHtml(data.name || '（无名）')}</span><span class="gb-pick-meta">${escapeHtml(data.relation || '未分类')} · ${escapeHtml(data.type || '')} · ${escapeHtml(when)}${hasReturned(data) && !solemn ? ' · 已回礼' : ''}</span></div>
          <span class="gb-pick-amount">${formatCurrency(Number(data.amount) || 0)}</span>
        </div>`
      })
      .join('')
    const more = matched.length > shown
      ? `<button type="button" class="gb-more-btn" data-scope-act="more">显示更多（还有 ${matched.length - shown} 条）</button>`
      : ''
    list.innerHTML = matched.length ? rows + more : '<div class="gb-empty">没有符合条件的记录，试试换个筛选条件。</div>'
    updateCounter(matched.length)
  }

  const back = () => {
    onDone?.()
  }

  openModal(
    '选择导出范围',
    { type: 'html', html },
    [
      { text: '取消', class: 'modal-btn-ghost', keepOpen: true, handler: back },
      {
        text: '使用整本',
        class: 'modal-btn-ghost',
        keepOpen: true,
        handler: () => {
          resetExportScope()
          back()
        },
      },
      {
        text: '确定',
        class: 'modal-btn-primary',
        keepOpen: true,
        handler: () => {
          if (!selected.size) {
            setError('请至少勾选一条记录，或点「使用整本」。')
            return
          }
          exportScope.mode = 'selected'
          exportScope.ids = [...selected]
          back()
        },
      },
    ],
    { size: 'large', dismissable: true },
  )

  afterModalRender(() => {
    const root = document.getElementById('gb-scope-picker')
    if (!root) return
    root.addEventListener('input', (event) => {
      if (event.target.id !== 'gb-scope-keyword') return
      filter.keyword = event.target.value
      shown = PAGE
      render()
    })
    root.addEventListener('change', (event) => {
      const box = event.target.closest('[data-scope-id]')
      if (box) {
        const id = box.dataset.scopeId
        if (box.checked) selected.add(id)
        else selected.delete(id)
        setError('')
        updateCounter(visible().length)
        return
      }
      if (event.target.id === 'gb-scope-relation' || event.target.id === 'gb-scope-returned') {
        filter[event.target.id === 'gb-scope-relation' ? 'relation' : 'returned'] = event.target.value
        shown = PAGE
        render()
      }
    })
    root.addEventListener('click', (event) => {
      const act = event.target.closest('[data-scope-act]')?.dataset.scopeAct
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
      // 点整行也能选中；点 checkbox 本身交给原生 change 处理。
      if (event.target.matches('input[type="checkbox"]')) return
      const row = event.target.closest('[data-row-id]')
      const box = row?.querySelector('input[type="checkbox"]')
      if (box) {
        box.checked = !box.checked
        box.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    render()
  })
}
