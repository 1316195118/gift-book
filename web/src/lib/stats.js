// 统计：汇总卡、按收款方式/按日期条形图、可搜索排序分页的明细表。
import { state as st } from '../store.js'
import { openModal, closeModal, afterModalRender } from './modal.js'
import { openCrossSummary } from './cross-summary.js'
import { copyOf, isSolemnEvent } from './content.js'
import { formatCurrency, formatDateTime, escapeHtml } from './crypto.js'
import { computeStats } from './stats-core.js'
import { openAnnualReport } from './insights.js'
export { computeStats }

// 同名记录：同名不等于重复（可能真是两位同名客人），只列出来供核对。
export function duplicateGroups(gifts = st.gifts) {
  const map = new Map()
  gifts.forEach((gift) => {
    const data = gift?.data
    if (!data || data.kind === 'blank' || !data.name) return
    const list = map.get(data.name) || []
    list.push({ amount: Number(data.amount) || 0, timestamp: data.timestamp, remarks: data.remarks || '' })
    map.set(data.name, list)
  })
  return [...map.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
}

export function openDuplicateNames() {
  const groups = duplicateGroups()
  if (!groups.length) return
  const html = `
    <div class="gb-dup-names">
      <p class="gb-picker-intro">共 <b>${groups.length}</b> 组同名记录。同名不一定是重复录入，请对照金额与时间核对。</p>
      <div class="gb-dup-list">
        ${groups.map(([name, list]) => `
          <div class="gb-dup-group">
            <div class="gb-dup-head"><b>${escapeHtml(name)}</b><span>${list.length} 笔 · 合计 ${formatCurrency(list.reduce((sum, item) => sum + item.amount, 0))}</span></div>
            <ul>${list.map((item) => `<li>${formatCurrency(item.amount)}<span>${formatDateTime(item.timestamp)}</span>${item.remarks ? `<em>${escapeHtml(item.remarks)}</em>` : ''}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>
      <p class="gb-picker-hint">统计金额按每一条记录累加；「送礼人数」按姓名去重，所以同名记录会影响笔数与金额，但不会重复增加人数。</p>
    </div>`
  openModal('同名记录', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }], { size: 'large', dismissable: true })
}

export function openStats() {
  const stats = computeStats(st.gifts)
  const copy = copyOf(st.currentEvent, st.homeCategory)
  const solemn = isSolemnEvent(st.currentEvent, st.homeCategory)
  // 白事不提供回礼功能：不展示「人情往来」。
  const returnSection = solemn ? '' : `<div class="stats-block"><h4 class="font-semibold mb-2">人情往来</h4><ul class="space-y-2">
          <li class="stat-line"><span>已回礼</span> <span>${formatCurrency(stats.totalReturned)}（${stats.returnedCount} 笔）</span></li>
          <li class="stat-line"><span>未回礼</span> <span>${stats.recordCount - stats.returnedCount} 笔</span></li>
          <li class="stat-line"><span>净人情</span> <span>${formatCurrency(stats.totalAmount - stats.totalReturned)}</span></li>
        </ul></div>`
  const html = `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 stats-body">
      <div id="grid-container" class="md:col-span-3"></div>
      <div class="space-y-4">
        <div class="flex justify-between p-3 bg-gray-100 rounded-lg"><span class="font-bold">${copy.statsGivers}:</span><span class="font-bold themed-text">${stats.uniqueGivers} 人</span></div>
        <div class="flex justify-between p-3 bg-gray-100 rounded-lg"><span class="font-bold">${copy.statsTotal}:</span><span class="font-bold themed-text">${formatCurrency(stats.totalAmount)}</span></div>
        <div class="stats-block"><h4 class="font-semibold mb-2">按收款方式</h4><ul class="space-y-1.5">${Object.entries(stats.byType).map(([type, amount]) => `<li class="stat-line"><span>${type}</span> <span>${formatCurrency(amount)}</span></li>`).join('')}</ul></div>
        <div class="stats-block"><h4 class="font-semibold mb-2">按关系</h4><ul class="space-y-1.5">${Object.entries(stats.byRelation).sort((a, b) => b[1] - a[1]).map(([relation, amount]) => `<li class="stat-line"><span>${escapeHtml(relation)}</span> <span>${formatCurrency(amount)}</span></li>`).join('') || '<li class="empty">暂无数据</li>'}</ul></div>
        ${returnSection}
        <div class="stats-block"><h4 class="font-semibold mb-2">概览</h4><ul class="space-y-2">
          <li class="stat-line"><span>记录笔数</span> <span>${stats.recordCount} 笔</span></li>
          <li class="stat-line"><span>人均礼金</span> <span>${formatCurrency(stats.average)}</span></li>
        </ul></div>
        <div class="stats-block"><h4 class="font-semibold mb-2">同名记录</h4>${duplicateGroups().length ? `<button type="button" id="dup-names-btn" class="gb-link-btn">检查同名（${duplicateGroups().length} 组）</button>` : '<p class="text-sm text-gray-500">没有同名记录。</p>'}</div>
        <div class="stats-block"><h4 class="font-semibold mb-2">年度报告</h4><button type="button" id="annual-report-btn" class="gb-link-btn">生成人情往来年度报告 →</button></div>
        <div class="stats-block"><h4 class="font-semibold mb-2">金额 Top 5</h4><ul class="space-y-2">${stats.topGivers.map(([name, amount], i) => `<li class="stat-line"><span>${i + 1}. ${escapeHtml(name)}</span> <span>${formatCurrency(amount)}</span></li>`).join('') || '<li class="empty">暂无数据</li>'}</ul></div>
      </div>
    </div>
    <div class="stats-charts">
      <div class="stats-chart"><h4>按收款方式</h4><div class="bar-chart" id="stats-by-type-chart"></div></div>
      <div class="stats-chart"><h4>按关系</h4><div class="bar-chart" id="stats-by-relation-chart"></div></div>
      <div class="stats-chart"><h4>按录入日期（近 14 天）</h4><div class="bar-chart" id="stats-by-day-chart"></div></div>
    </div>`
  openModal(copy.statsTitle, { type: 'html', html }, [
    { text: '关闭', class: 'border themed-button-secondary px-4 py-2 rounded' },
    {
      text: '跨账簿汇总',
      class: 'themed-button-primary px-4 py-2 rounded',
      handler: () => {
        closeModal()
        setTimeout(() => openCrossSummary(), 80)
      },
    },
  ], { size: 'large' })
  // 弹窗内容由 Vue 在下一帧挂载，等它进入 DOM 后再填充图表与表格。
  const rows = st.gifts.map((g) => [g.data.name, Number(g.data.amount), g.data.remarks || '无', g.data.type, g.data.relation || '未分类', formatDateTime(g.data.timestamp)])
  afterModalRender(() => {
    document.getElementById('dup-names-btn')?.addEventListener('click', () => openDuplicateNames())
    document.getElementById('annual-report-btn')?.addEventListener('click', () => {
      closeModal()
      setTimeout(() => openAnnualReport(), 120)
    })
    const table = renderStatsTable(document.getElementById('grid-container'), ['姓名', '金额 (元)', '备注', '收款类型', '关系', '录入时间'], rows)
    renderCharts(stats, table)
  })
}

function renderCharts(stats, table) {
  const typeBox = document.getElementById('stats-by-type-chart')
  if (typeBox) {
    const entries = Object.entries(stats.byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    const max = Math.max(1, ...entries.map(([, v]) => v))
    // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
    typeBox.innerHTML = entries.length
      ? entries.map(([type, amount]) => `<div class="bar-row" data-filter="${escapeHtml(type)}" title="点击筛选明细"><span class="bar-label">${escapeHtml(type)}</span><span class="bar-track"><span class="bar-fill" style="width:${((amount / max) * 100).toFixed(1)}%"></span></span><span class="bar-value">${formatCurrency(amount)}</span></div>`).join('')
      : '<p class="empty">暂无数据</p>'
    if (!typeBox.dataset.bound) {
      typeBox.dataset.bound = '1'
      typeBox.addEventListener('click', (event) => {
        const filter = event.target.closest('.bar-row')?.dataset.filter
        if (filter) table?.setQuery(filter)
      })
    }
  }
  const relationBox = document.getElementById('stats-by-relation-chart')
  if (relationBox) {
    const entries = Object.entries(stats.byRelation).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    const max = Math.max(1, ...entries.map(([, v]) => v))
    // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
    relationBox.innerHTML = entries.length
      ? entries.map(([relation, amount]) => `<div class="bar-row" data-filter="${escapeHtml(relation)}" title="点击筛选明细"><span class="bar-label">${escapeHtml(relation)}</span><span class="bar-track"><span class="bar-fill" style="width:${((amount / max) * 100).toFixed(1)}%"></span></span><span class="bar-value">${formatCurrency(amount)}</span></div>`).join('')
      : '<p class="empty">暂无数据</p>'
    if (!relationBox.dataset.bound) {
      relationBox.dataset.bound = '1'
      relationBox.addEventListener('click', (event) => {
        const filter = event.target.closest('.bar-row')?.dataset.filter
        if (filter) table?.setQuery(filter)
      })
    }
  }
  const dayBox = document.getElementById('stats-by-day-chart')
  if (dayBox) {
    const days = []
    const now = new Date()
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      days.push({ key: d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }), amount: 0 })
    }
    const byDay = {}
    st.gifts.forEach(({ data }) => {
      if (!data?.timestamp) return
      const d = new Date(data.timestamp)
      if (Number.isNaN(d.getTime())) return
      const key = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
      byDay[key] = (byDay[key] || 0) + Number(data.amount)
    })
    days.forEach((d) => {
      d.amount = byDay[d.key] || 0
    })
    const max = Math.max(1, ...days.map((d) => d.amount))
    // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
    dayBox.innerHTML = days
      .map((d) => `<div class="bar-row"><span class="bar-label">${d.key}</span><span class="bar-track"><span class="bar-fill" style="width:${((d.amount / max) * 100).toFixed(1)}%"></span></span><span class="bar-value">${d.amount ? formatCurrency(d.amount) : ''}</span></div>`)
      .join('')
  }
}

function renderStatsTable(container, columns, rows) {
  if (!container) return
  const PAGE_SIZE = 20
  const state = { q: '', sortCol: -1, sortDir: 1, page: 1 }
  // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
  container.innerHTML = `
    <div class="stats-table-wrap">
      <div class="stats-table-bar"><input type="search" id="stats-search" placeholder="搜索姓名、备注或收款方式" autocomplete="off" /><span class="stats-count" id="stats-count"></span></div>
      <div class="stats-table-scroll"><table class="stats-table"><thead><tr>${columns.map((c, i) => `<th scope="col" data-col="${i}" tabindex="0">${c}<span class="sort-mark" aria-hidden="true"></span></th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <div class="stats-pager"><button type="button" id="stats-prev">上一页</button><span id="stats-pageinfo"></span><button type="button" id="stats-next">下一页</button></div>
    </div>`
  const tbody = container.querySelector('tbody')
  const countEl = container.querySelector('#stats-count')
  const pageEl = container.querySelector('#stats-pageinfo')
  const prevBtn = container.querySelector('#stats-prev')
  const nextBtn = container.querySelector('#stats-next')

  const filtered = () => {
    const q = state.q.trim().toLowerCase()
    let list = rows
    if (q) list = rows.filter((r) => r.some((cell) => String(cell).toLowerCase().includes(q)))
    if (state.sortCol >= 0) {
      const col = state.sortCol
      list = [...list].sort((a, b) => {
        const x = a[col]
        const y = b[col]
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * state.sortDir
        return String(x).localeCompare(String(y), 'zh-CN') * state.sortDir
      })
    }
    return list
  }

  const paint = () => {
    const list = filtered()
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
    if (state.page > totalPages) state.page = totalPages
    const start = (state.page - 1) * PAGE_SIZE
    const pageRows = list.slice(start, start + PAGE_SIZE)
    // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
    tbody.innerHTML = pageRows.length
      ? pageRows
          .map((r) => `<tr>${r.map((cell, i) => {
            const isNum = i === 1
            const text = isNum && typeof cell === 'number' ? cell.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(cell)
            return `<td${isNum ? ' class="num"' : ''}>${escapeHtml(text)}</td>`
          }).join('')}</tr>`)
          .join('')
      : `<tr><td colspan="${columns.length}" class="empty">未找到匹配的记录</td></tr>`
    countEl.textContent = `共 ${list.length} 条`
    pageEl.textContent = `第 ${state.page} / ${totalPages} 页`
    prevBtn.disabled = state.page <= 1
    nextBtn.disabled = state.page >= totalPages
    container.querySelectorAll('th').forEach((th) => {
      const mark = th.querySelector('.sort-mark')
      const active = Number(th.dataset.col) === state.sortCol
      mark.textContent = active ? (state.sortDir > 0 ? '▲' : '▼') : ''
      th.classList.toggle('sorted', active)
    })
  }

  container.querySelector('#stats-search')?.addEventListener('input', (e) => {
    state.q = e.target.value
    state.page = 1
    paint()
  })
  container.querySelectorAll('th').forEach((th) => {
    const toggle = () => {
      const col = Number(th.dataset.col)
      if (state.sortCol === col) state.sortDir = -state.sortDir
      else {
        state.sortCol = col
        state.sortDir = 1
      }
      state.page = 1
      paint()
    }
    th.addEventListener('click', toggle)
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    })
  })
  prevBtn.addEventListener('click', () => {
    state.page -= 1
    paint()
  })
  nextBtn.addEventListener('click', () => {
    state.page += 1
    paint()
  })
  paint()
  return {
    setQuery(query) {
      const q = String(query || '')
      const input = container.querySelector('#stats-search')
      if (input) input.value = q
      state.q = q
      state.page = 1
      paint()
    },
  }
}

export { renderStatsTable }
