// 记账主页（原生 JS，零第三方依赖）。
import { state as st, subscribe } from '../store.js'
import { copyOf } from '../lib/content.js'
import { formatCurrency } from '../lib/crypto.js'
import { showHome, syncEventTotal } from '../bootstrap.js'
import { versionLabel, toggleLargeText, showChangelog, showNetworkDetails } from '../lib/actions.js'
import { netState as net } from '../lib/network.js'
import { queueFor } from '../lib/offline.js'
import { writeLocked } from '../lib/prefs.js'
import {
  PAYMENT_OPTIONS, entry, resetEntry, bookMarkup, computeStats, pageItems,
  totalPages, amountPreview, submitGift, runSearch, openGiftDetails, showQueueModal,
  openStats, openExport, openPrint, openSettings, openOcr, toggleLedgerLock, showQrDialog,
} from '../lib/ledger-view.js'
import { verifyLedgerPassword } from '../lib/actions.js'
import { success, info, pulse } from '../lib/feedback.js'

let dropdownOpen = false
let searchName = ''
let searchAmount = ''
let unlockPassword = ''
let unlockError = ''
let unlocking = false

const SKELETON = `
<div id="app-container">
  <div id="main-screen">
    <header class="main-header">
      <div class="main-header-main">
        <button class="main-back" type="button" id="main-back" aria-label="返回首页">返回</button>
        <div class="main-title-block">
          <div class="relative">
            <button type="button" class="event-switch" id="event-switch" aria-haspopup="menu">
              <span id="event-name-label"></span>
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" clip-rule="evenodd" /></svg>
            </button>
            <div class="event-menu" id="event-menu" role="menu">
              <button type="button" role="menuitem" id="menu-switch">切换或新建账簿</button>
              <button type="button" role="menuitem" id="menu-edit">账簿设置</button>
              <button type="button" role="menuitem" id="menu-delete">删除账簿</button>
            </div>
          </div>
          <p class="main-sub" id="main-sub"></p>
        </div>
      </div>

      <div class="main-header-right">
        <div class="main-status">
          <button type="button" class="net-chip net-chip-sm" id="net-chip"><span class="net-dot" aria-hidden="true"></span><span class="net-text"></span></button>
          <button type="button" id="queue-chip" class="queue-chip" style="display:none">待同步</button>
          <button type="button" class="version-chip version-chip-sm" id="version-chip">v--</button>
        </div>
        <div class="main-tools">
          <button id="settings-btn" class="main-tool" type="button">设置</button>
          <button id="lock-btn" class="main-tool" type="button">锁定</button>
          <button id="qr-show-btn" class="main-tool" type="button">收款码</button>
          <button id="stats-btn" class="main-tool" type="button">统计</button>
          <button type="button" class="main-tool large-text-toggle" id="large-text-toggle">大字</button>
          <button id="print-btn" class="main-tool" type="button">打印</button>
          <button id="ocr-btn" class="main-tool" type="button">扫描礼簿</button>
          <button id="export-btn" class="main-tool main-tool-primary" type="button">导出</button>
        </div>
      </div>
    </header>

    <div class="lock-banner" id="lock-banner" style="display:none">
      <span>账簿已锁定，录入与修改已暂停。</span>
      <button id="unlock-btn" type="button">解锁</button>
    </div>

    <div class="sync-status" id="sync-status" style="display:none" role="status">
      <span id="sync-text"></span>
      <button id="retry-sync-btn" type="button">重试同步</button>
    </div>

    <div class="ledger-layout">
      <section class="entry-panel" aria-label="礼金录入">
        <div class="entry-heading">
          <h2>
            <span id="entry-title"></span>
            <span class="entry-pending" id="entry-pending" style="display:none"><i aria-hidden="true"></i>待同步<b id="entry-pending-count">0</b></span>
          </h2>
          <p id="entry-sub"></p>
        </div>

        <form id="add-gift-form" autocomplete="off">
          <div class="entry-field">
            <label for="guest-name"><span id="name-label"></span> <span class="field-counter" id="name-counter">0/20</span></label>
            <div class="field-shell">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M4.8 19.5c.9-3.4 3.7-5.3 7.2-5.3s6.3 1.9 7.2 5.3" /></svg>
              <input type="text" id="guest-name" placeholder="" required maxlength="20" autocomplete="off" />
            </div>
          </div>

          <div class="entry-field">
            <label for="gift-amount"><span id="amount-label">金额</span> <small>人民币 / 元</small></label>
            <div class="field-shell">
              <input type="number" id="gift-amount" data-suffix="元" placeholder="0.00" required min="0.01" max="1000000" step="0.01" inputmode="decimal" />
              <span class="field-suffix">元</span>
            </div>
            <div class="amount-chinese-preview" id="amount-preview" aria-live="polite"></div>
          </div>

          <div class="entry-field entry-payment">
            <label>收款方式</label>
            <div class="payment-options" id="payment-options"></div>
          </div>

          <div class="entry-field entry-remarks">
            <label for="remarks">备注 <small>选填 · <span id="remarks-counter">0</span>/4000</small></label>
            <textarea id="remarks" placeholder="" rows="2" maxlength="4000"></textarea>
          </div>

          <button type="submit" id="submit-gift-btn">确认录入</button>
          <p class="entry-hint">按回车核对并提交 · Shift + 回车换行</p>
        </form>
      </section>

      <section class="book-panel" aria-label="礼簿与汇总">
        <div class="book-search">
          <div class="search-field">
            <div class="field-shell">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
              <input type="text" id="search-name" placeholder="按姓氏或全名查找" autocomplete="off" />
            </div>
          </div>
          <div class="search-field search-field-amount">
            <div class="field-shell">
              <input type="number" id="search-amount" placeholder="金额" min="0" step="0.01" inputmode="decimal" />
              <span class="field-suffix">元</span>
            </div>
          </div>
          <button id="search-top-btn" type="button">查找</button>
        </div>

        <div class="ledger-summary" aria-live="polite">
          <div class="summary-card primary"><span id="total-label"></span><span id="total-amount"></span></div>
          <div class="summary-card"><span id="givers-label"></span><span id="total-givers"></span></div>
          <div class="summary-card"><span>本页小计 / 元</span><span id="subtotal-amount"></span></div>
        </div>

        <div class="gift-book-frame">
          <div class="book-topline">
            <div class="book-caption">
              <h2 id="book-title"></h2>
              <p>传统竖排 · 数字留痕</p>
            </div>
            <div class="book-navigation">
              <button id="prev-page-btn" type="button" aria-label="上一页">‹</button>
              <span id="page-indicator">第 1 / 1 页</span>
              <button id="next-page-btn" type="button" aria-label="下一页">›</button>
            </div>
          </div>
          <div class="book-scroll" tabindex="0" aria-label="礼簿明细，可横向滚动">
            <div id="gift-book-content"></div>
          </div>
          <p class="book-empty-hint" id="book-empty" style="display:none"></p>
          <p class="book-note" id="book-note"></p>
        </div>
      </section>
    </div>

    <div class="lock-veil" id="lock-veil" style="display:none" role="dialog" aria-modal="true" aria-label="账簿已锁定">
      <div class="lock-veil-card">
        <div class="lock-veil-seal" aria-hidden="true">锁</div>
        <h3>账簿已锁定</h3>
        <p>内容已隐藏。输入管理密码即可解锁。</p>
        <form id="unlock-form" style="display:none">
          <input type="password" id="unlock-password" placeholder="管理密码" autocomplete="current-password" />
          <div class="lock-veil-error" id="unlock-error" role="alert" style="display:none"></div>
          <button type="submit" class="themed-button-primary" id="unlock-submit">解锁账簿</button>
        </form>
        <button type="button" class="themed-button-primary" id="unlock-no-pwd" style="display:none">解锁账簿</button>
      </div>
    </div>
  </div>
</div>`

function eventSub() {
  const ev = st.currentEvent || {}
  const date = ev.startDateTime ? new Date(ev.startDateTime).toLocaleDateString('zh-CN') : ''
  return [ev.template, date, ev.location].filter(Boolean).join(' · ')
}

function pageBy(direction) {
  const next = st.currentPage + direction
  if (next >= 1 && next <= totalPages()) st.currentPage = next
}

function onUnlockSubmit() {
  return (async () => {
    if (unlocking) return
    unlocking = true
    const submit = document.getElementById('unlock-submit')
    const errEl = document.getElementById('unlock-error')
    const input = document.getElementById('unlock-password')
    unlockError = ''
    errEl.style.display = 'none'
    errEl.textContent = ''
    submit.disabled = true
    submit.textContent = '解锁中…'
    try {
      const result = await verifyLedgerPassword(st.currentEvent.id, unlockPassword)
      if (result.ok) {
        st.locked = false
        writeLocked(st.currentEvent.id, false)
        unlockPassword = ''
      } else {
        unlockError = result.message || '管理密码不正确'
        errEl.textContent = unlockError
        errEl.style.display = ''
      }
    } catch (err) {
      unlockError = err.message || '无法连接服务器，请稍后重试'
      errEl.textContent = unlockError
      errEl.style.display = ''
    } finally {
      unlocking = false
      submit.disabled = false
      submit.textContent = '解锁账簿'
    }
  })()
}

export function mountMain(root) {
  root.innerHTML = SKELETON
  const $ = (id) => root.querySelector(id)
  const copy = () => copyOf(st.currentEvent, st.homeCategory)

  // 收款方式单选
  $('#payment-options').innerHTML = PAYMENT_OPTIONS.map(
    (option) => `<label><input type="radio" name="payment-type" value="${option}" ${entry.type === option ? 'checked' : ''} /><span>${option}</span></label>`,
  ).join('')

  const refs = {
    screen: $('#main-screen'),
    eventNameLabel: $('#event-name-label'),
    mainSub: $('#main-sub'),
    netChip: $('#net-chip'),
    netText: $('#net-chip').querySelector('.net-text'),
    queueChip: $('#queue-chip'),
    versionChip: $('#version-chip'),
    lockBanner: $('#lock-banner'),
    unlockBtn: $('#unlock-btn'),
    syncStatus: $('#sync-status'),
    syncText: $('#sync-text'),
    entryTitle: $('#entry-title'),
    entryPending: $('#entry-pending'),
    entryPendingCount: $('#entry-pending-count'),
    entrySub: $('#entry-sub'),
    nameLabel: $('#name-label'),
    nameCounter: $('#name-counter'),
    amountPreview: $('#amount-preview'),
    remarksCounter: $('#remarks-counter'),
    submitBtn: $('#submit-gift-btn'),
    totalLabel: $('#total-label'),
    totalAmount: $('#total-amount'),
    giversLabel: $('#givers-label'),
    totalGivers: $('#total-givers'),
    subtotalAmount: $('#subtotal-amount'),
    bookTitle: $('#book-title'),
    pageIndicator: $('#page-indicator'),
    prevBtn: $('#prev-page-btn'),
    nextBtn: $('#next-page-btn'),
    bookContent: $('#gift-book-content'),
    bookEmpty: $('#book-empty'),
    bookNote: $('#book-note'),
    lockVeil: $('#lock-veil'),
    unlockForm: $('#unlock-form'),
    unlockNoPwd: $('#unlock-no-pwd'),
    eventMenu: $('#event-menu'),
    amountLabel: $('#amount-label'),
    nameInput: $('#guest-name'),
    amountInput: $('#gift-amount'),
    remarksInput: $('#remarks'),
    lockBtn: $('#lock-btn'),
    largeTextToggle: $('#large-text-toggle'),
    ocrBtn: $('#ocr-btn'),
  }

  // 礼簿内容没变就不重写 DOM：网络探测每 15 秒会触发一次订阅，
  // 无差别 innerHTML 重建会打断正在进行的点击/选择并丢失滚动位置。
  let lastBook = ''
  let lastLocked = st.locked
  let lastTotal = null
  let lastPage = st.currentPage

  function update() {
    const cp = copy()
    const qCount = queueFor(st.currentEvent?.id).length
    const items = pageItems()
    const stats = computeStats()
    const subtotal = items.reduce((sum, gift) => sum + (Number(gift.data?.amount) || 0), 0)
    const pages = totalPages()

    refs.screen.classList.toggle('main-locked', st.locked)
    refs.eventNameLabel.textContent = st.currentEvent?.name || ''
    refs.mainSub.textContent = eventSub()

    const level = net.health.level
    refs.netChip.className = `net-chip net-chip-sm is-${level}`
    refs.netText.textContent = net.health.text
    refs.queueChip.style.display = qCount ? '' : 'none'
    refs.queueChip.textContent = `待同步 ${qCount} 条`
    refs.versionChip.textContent = `v${versionLabel()}`

    refs.lockBanner.style.display = st.locked ? '' : 'none'
    refs.syncStatus.style.display = st.syncMessage ? '' : 'none'
    refs.syncStatus.classList.toggle('sync-error', st.syncIsError)
    refs.syncText.textContent = st.syncMessage || ''

    refs.entryTitle.textContent = cp.entryTitle
    refs.entryPending.style.display = qCount ? '' : 'none'
    refs.entryPendingCount.textContent = String(qCount)
    refs.entrySub.textContent = cp.entrySub
    refs.nameLabel.textContent = cp.nameLabel
    refs.amountLabel.textContent = cp.amountLabel
    // 红/白事用语必须跟着文案表走，写死会在白事页冒出「礼金」等红事字眼。
    refs.nameInput.placeholder = cp.namePlaceholder
    refs.remarksInput.placeholder = cp.remarksPlaceholder
    refs.amountPreview.textContent = amountPreview(entry.amount)
    refs.amountPreview.classList.toggle('is-filled', Number(entry.amount) > 0)
    refs.remarksCounter.textContent = String((entry.remarks || '').length)
    refs.submitBtn.disabled = st.locked
    refs.submitBtn.textContent = st.locked ? '已锁定' : '确认录入'
    // 锁定时禁用全部录入控件；工具栏按钮状态跟随 store。
    ;[refs.nameInput, refs.amountInput, refs.remarksInput].forEach((el) => { el.disabled = st.locked })
    root.querySelectorAll('input[name="payment-type"]').forEach((radio) => { radio.disabled = st.locked })
    refs.lockBtn.textContent = st.locked ? '解锁' : '锁定'
    refs.lockBtn.setAttribute('aria-pressed', String(st.locked))
    refs.largeTextToggle.textContent = st.largeText ? '标准' : '大字'
    refs.largeTextToggle.setAttribute('aria-pressed', String(st.largeText))
    refs.ocrBtn.disabled = !st.ocrAvailable
    refs.ocrBtn.title = st.ocrAvailable ? '扫描礼簿' : '当前部署未内置 OCR'

    refs.totalLabel.textContent = cp.totalLabel
    refs.totalAmount.textContent = formatCurrency(stats.totalAmount)
    refs.giversLabel.textContent = cp.giversLabel
    refs.totalGivers.textContent = String(stats.totalGivers)
    refs.subtotalAmount.textContent = formatCurrency(subtotal)

    refs.bookTitle.textContent = cp.bookTitle
    refs.pageIndicator.textContent = `第 ${st.currentPage} / ${pages} 页`
    refs.prevBtn.disabled = st.currentPage <= 1
    refs.nextBtn.disabled = st.currentPage >= pages
    const book = bookMarkup()
    if (book !== lastBook) {
      refs.bookContent.innerHTML = book
      lastBook = book
    }
    const hasItems = (st.gifts || []).length > 0
    refs.bookEmpty.style.display = hasItems ? 'none' : ''
    refs.bookEmpty.textContent = cp.emptyHint
    refs.bookNote.textContent = cp.bookNote

    refs.lockVeil.style.display = st.locked ? '' : 'none'
    const hasPassword = Boolean(st.currentEvent?.hasPassword)
    refs.unlockForm.style.display = hasPassword ? '' : 'none'
    refs.unlockNoPwd.style.display = hasPassword ? 'none' : ''
    refs.eventMenu.style.display = dropdownOpen ? '' : 'none'

    // 状态提示：锁定状态与总额变化都只在实际改变时提示一次。
    if (st.locked !== lastLocked) {
      lastLocked = st.locked
      if (st.locked) info('账簿已锁定，录入与修改已暂停')
      else success('账簿已解锁', { duration: 2200 })
    }
    if (lastTotal !== null && stats.totalAmount !== lastTotal) pulse(refs.totalAmount)
    lastTotal = stats.totalAmount

    // 翻页给一个方向性的落纸反馈：按钮、方向键、程序改页码都会走到这里。
    if (st.currentPage !== lastPage) {
      const dir = st.currentPage > lastPage ? 1 : -1
      lastPage = st.currentPage
      refs.bookContent.style.setProperty('--gb-turn-x', `${dir * 10}px`)
      refs.bookContent.classList.remove('gb-page-turn')
      void refs.bookContent.offsetWidth
      refs.bookContent.classList.add('gb-page-turn')
    }
  }

  // 顶部工具栏
  $('#main-back').addEventListener('click', showHome)
  $('#event-switch').addEventListener('click', (e) => {
    e.stopPropagation()
    dropdownOpen = !dropdownOpen
    update()
  })
  $('#menu-switch').addEventListener('click', () => { dropdownOpen = false; showHome() })
  $('#menu-edit').addEventListener('click', () => { dropdownOpen = false; openSettings() })
  $('#menu-delete').addEventListener('click', () => { dropdownOpen = false; openSettings({ section: 'delete' }) })
  $('#net-chip').addEventListener('click', showNetworkDetails)
  $('#queue-chip').addEventListener('click', showQueueModal)
  $('#version-chip').addEventListener('click', showChangelog)
  $('#settings-btn').addEventListener('click', () => openSettings())
  $('#lock-btn').addEventListener('click', () => toggleLedgerLock())
  $('#qr-show-btn').addEventListener('click', () => showQrDialog())
  $('#stats-btn').addEventListener('click', () => openStats())
  $('#large-text-toggle').addEventListener('click', () => {
    info(st.largeText ? '已恢复标准字号' : '已开启大字模式', { duration: 1800 })
    toggleLargeText()
  })
  $('#print-btn').addEventListener('click', () => openPrint())
  $('#ocr-btn').addEventListener('click', () => openOcr())
  $('#export-btn').addEventListener('click', () => openExport())
  refs.unlockBtn.addEventListener('click', () => toggleLedgerLock())
  $('#retry-sync-btn').addEventListener('click', () => syncEventTotal())

  // 录入表单
  const nameInput = $('#guest-name')
  const amountInput = $('#gift-amount')
  const remarksInput = $('#remarks')
  nameInput.addEventListener('input', () => {
    entry.name = nameInput.value
    refs.nameCounter.textContent = `${nameInput.value.length}/20`
  })
  amountInput.addEventListener('input', () => {
    entry.amount = amountInput.value
    refs.amountPreview.textContent = amountPreview(entry.amount)
    refs.amountPreview.classList.toggle('is-filled', Number(entry.amount) > 0)
  })
  remarksInput.addEventListener('input', () => {
    entry.remarks = remarksInput.value
    refs.remarksCounter.textContent = String(remarksInput.value.length)
  })
  $('#payment-options').addEventListener('change', (e) => {
    if (e.target.name === 'payment-type') entry.type = e.target.value
  })
  // submitGift 只接收 (giftData, resetForm)：原生 DOM 没有 v-model，
  // 必须在 resetForm 里同步清空输入框与收款方式，否则提交后旧值会留在界面上。
  const resetForm = () => {
    resetEntry()
    nameInput.value = ''
    amountInput.value = ''
    remarksInput.value = ''
    refs.nameCounter.textContent = '0/20'
    refs.remarksCounter.textContent = '0'
    refs.amountPreview.textContent = ''
    refs.amountPreview.classList.remove('is-filled')
    root.querySelectorAll('input[name="payment-type"]').forEach((radio) => {
      radio.checked = radio.value === entry.type
    })
    nameInput.focus()
  }
  $('#add-gift-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const gift = { ...entry }
    submitGift(gift, () => {
      resetForm()
      // resetForm 只在服务端确认保存后被调用，离线暂存走的是右下角离线卡片，不在这里提示。
      success('已录入', {
        detail: `${gift.name} · ${formatCurrency(Number(gift.amount) || 0)}`,
        duration: 2600,
      })
    })
  })

  // 搜索
  $('#search-top-btn').addEventListener('click', () => runSearch(searchName, searchAmount))
  $('#search-name').addEventListener('keyup', (e) => { searchName = e.target.value; if (e.key === 'Enter') runSearch(searchName, searchAmount) })
  $('#search-amount').addEventListener('keyup', (e) => { searchAmount = e.target.value; if (e.key === 'Enter') runSearch(searchName, searchAmount) })

  // 翻页
  refs.prevBtn.addEventListener('click', () => pageBy(-1))
  refs.nextBtn.addEventListener('click', () => pageBy(1))

  // 解锁表单
  refs.unlockForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const input = $('#unlock-password')
    unlockPassword = input.value
    onUnlockSubmit()
  })
  refs.unlockNoPwd.addEventListener('click', () => toggleLedgerLock())

  // 礼簿点击（打开明细 / 收起菜单）
  refs.bookContent.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-gift-index]')
    if (cell && cell.classList.contains('name-cell')) {
      const index = Number(cell.dataset.giftIndex)
      if (Number.isFinite(index)) openGiftDetails(index)
    }
  })

  function onDocClick(event) {
    if (dropdownOpen && !event.target.closest('#event-switch') && !event.target.closest('#event-menu')) {
      dropdownOpen = false
      update()
    }
  }
  function onKeydown(event) {
    if (event.key === 'Escape' && dropdownOpen) {
      dropdownOpen = false
      update()
      return
    }
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'ArrowLeft') pageBy(-1)
    if (event.key === 'ArrowRight') pageBy(1)
  }

  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)

  update()
  const unsub = subscribe(update)
  return {
    unmount() {
      unsub()
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKeydown)
    },
  }
}
