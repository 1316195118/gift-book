<template>
  <div id="app-container">
    <div id="main-screen" :class="{ 'main-locked': st.locked }">
      <header class="main-header">
        <div class="main-header-main">
          <button class="main-back" type="button" @click="goHome" aria-label="返回首页">返回</button>
          <div class="main-title-block">
            <div class="relative">
              <button
                type="button"
                class="event-switch"
                :aria-expanded="dropdownOpen"
                aria-haspopup="menu"
                @click.stop="dropdownOpen = !dropdownOpen"
              >
                <span>{{ st.currentEvent?.name }}</span>
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" clip-rule="evenodd" /></svg>
              </button>
              <div v-if="dropdownOpen" class="event-menu" role="menu">
                <button type="button" role="menuitem" @click.prevent="menu('switch')">切换或新建账簿</button>
                <button type="button" role="menuitem" @click.prevent="menu('edit')">账簿设置</button>
                <button type="button" role="menuitem" @click.prevent="menu('delete')">删除账簿</button>
              </div>
            </div>
            <p class="main-sub">{{ eventSub }}</p>
          </div>
        </div>

        <div class="main-header-right">
          <div class="main-status">
            <button type="button" class="net-chip net-chip-sm" :class="'is-' + net.health.level" @click="openNetwork">
              <span class="net-dot" aria-hidden="true"></span><span class="net-text">{{ net.health.text }}</span>
            </button>
            <button v-if="queueCount" id="queue-chip" type="button" class="queue-chip" @click="showQueueModal">待同步 {{ queueCount }} 条</button>
            <button type="button" class="version-chip version-chip-sm" @click="openChangelog">v{{ version }}</button>
          </div>
          <div class="main-tools">
            <button id="settings-btn" class="main-tool" type="button" title="账簿设置：名称、时间、每页行数" @click="openSettings()">设置</button>
            <button id="lock-btn" class="main-tool" type="button" title="暂时锁定录入与修改" @click="onToggleLock">{{ st.locked ? '解锁' : '锁定' }}</button>
            <button id="qr-show-btn" class="main-tool" type="button" title="展示或上传收款码" @click="showQr">收款码</button>
            <button id="stats-btn" class="main-tool" type="button" title="金额、人数与分类汇总" @click="openStats">统计</button>
            <button type="button" class="main-tool large-text-toggle" :aria-pressed="st.largeText" @click="onToggleLargeText">{{ st.largeText ? '标准' : '大字' }}</button>
            <button id="print-btn" class="main-tool" type="button" title="打印礼簿（可选字号与页边距）" @click="openPrint">打印</button>
            <button id="ocr-btn" class="main-tool" type="button" :disabled="!st.ocrAvailable || readOnly" :title="st.ocrAvailable ? '扫描礼簿' : '当前部署未内置 OCR'" @click="openOcr">扫描礼簿</button>
            <button id="export-btn" class="main-tool main-tool-primary" type="button" title="导出 Excel / PDF / Word" @click="openExport">导出</button>
          </div>
        </div>
      </header>

      <div v-if="st.locked" class="lock-banner">
        <span>账簿已锁定，录入与修改已暂停。</span>
        <button id="unlock-btn" type="button" @click="onToggleLock">解锁</button>
      </div>
      <div v-else-if="isArchived()" class="gb-readonly-banner" role="status">
        <span>这本账簿已结簿归档，只能查看、统计与导出；如需继续登记，请到「设置 → 结簿归档」解除。</span>
      </div>

      <div v-if="st.syncMessage" class="sync-status" :class="{ 'sync-error': st.syncIsError }" role="status">
        <span>{{ st.syncMessage }}</span>
        <button id="retry-sync-btn" type="button" @click="onRetrySync">重试同步</button>
      </div>

      <div class="ledger-layout">
        <section id="entry-panel" class="entry-panel" aria-label="礼金录入">
          <div class="entry-heading">
            <h2>
              <span>{{ copy.entryTitle }}</span>
              <span v-if="queueCount" id="entry-pending" class="entry-pending"><i aria-hidden="true"></i>待同步<b>{{ queueCount }}</b></span>
            </h2>
            <p>{{ copy.entrySub }}</p>
          </div>

          <form id="add-gift-form" @submit.prevent="onSubmit" @keydown.alt.s.prevent="onBlank" autocomplete="off">
            <div class="entry-field">
              <label for="guest-name">{{ copy.nameLabel }} <span class="field-counter">{{ entry.name.length }}/20</span></label>
              <div class="field-shell">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M4.8 19.5c.9-3.4 3.7-5.3 7.2-5.3s6.3 1.9 7.2 5.3" /></svg>
                <input v-model="entry.name" type="text" id="guest-name" :placeholder="copy.namePlaceholder" required maxlength="20" autocomplete="off" :disabled="readOnly" />
              </div>
            </div>

            <div class="entry-field">
              <label for="gift-amount">{{ copy.amountLabel }} <small>人民币 / 元</small></label>
              <div class="field-shell">
                <input v-model="entry.amount" type="number" id="gift-amount" data-suffix="元" placeholder="0.00" required min="0" max="1000000" step="0.01" inputmode="decimal" :disabled="readOnly" />
                <span class="field-suffix">元</span>
              </div>
              <div class="amount-quick" aria-label="常用金额">
                <button v-for="quick in [100, 200, 500, 1000]" :key="quick" type="button" :disabled="readOnly" @click="entry.amount = String(quick)">{{ quick }}</button>
              </div>
              <div class="amount-chinese-preview" :class="{ 'is-filled': hasAmount }" aria-live="polite">{{ amountText }}</div>
            </div>

            <div class="entry-fold-row">
              <button v-if="hiddenFieldCount" type="button" class="entry-more-toggle" :aria-expanded="entryMore" @click="toggleEntryMore">
                <span>{{ entryMore ? '收起' : '展开' }}更多选项</span><small>{{ foldSummary }}</small>
              </button>
              <button type="button" class="entry-fields-btn" title="选择哪些字段显示在常用区" @click="openFieldPicker">字段</button>
            </div>
            <div v-show="entryMore || entryShow.type" class="entry-field entry-payment">
              <label>收款方式</label>
              <div class="payment-options">
                <label v-for="option in PAYMENT_OPTIONS" :key="option">
                  <input v-model="entry.type" type="radio" name="payment-type" :value="option" :disabled="readOnly" /><span>{{ option }}</span>
                </label>
              </div>
            </div>

            <div v-show="entryMore || entryShow.relation" class="entry-field entry-relation">
              <label>关系 <small>选填 · 用于分类汇总</small></label>
              <div class="payment-options">
                <label>
                  <input v-model="entry.relation" type="radio" name="gift-relation" value="" :disabled="readOnly" /><span>未分类</span>
                </label>
                <label v-for="option in RELATION_OPTIONS" :key="option">
                  <input v-model="entry.relation" type="radio" name="gift-relation" :value="option" :disabled="readOnly" /><span>{{ option }}</span>
                </label>
              </div>
            </div>

            <div v-show="entryMore || entryShow.remarks" class="entry-field entry-remarks">
              <label for="remarks">备注 <small>选填 · {{ entry.remarks.length }}/4000</small></label>
              <textarea v-model="entry.remarks" id="remarks" :placeholder="copy.remarksPlaceholder" rows="1" maxlength="4000" :disabled="readOnly"></textarea>
            </div>

            <div class="entry-submit-row">
              <button type="submit" id="submit-gift-btn" :disabled="readOnly">确认录入</button>
              <button type="button" id="submit-blank-btn" class="gb-blank-btn" :disabled="readOnly" title="占位一行，之后可以原位补录（Alt+S）" @click="onBlank">空白 / 跳过</button>
            </div>
            <p class="entry-hint">回车核对并提交 · Shift + 回车换行 · Alt + S 跳过 · Alt + N 回到姓名 · / 查找 · ←/→ 翻页</p>
          </form>
        </section>

        <section id="book-panel" class="book-panel" :aria-label="copy.bookTitle + '与汇总'">
          <div class="book-search">
            <div class="search-field">
              <div class="field-shell">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
                <input v-model="searchName" type="text" id="search-name" placeholder="按姓氏或全名查找" autocomplete="off" @keyup.enter="onSearch" />
              </div>
            </div>
            <div class="search-field search-field-amount">
              <div class="field-shell">
                <input v-model="searchAmount" type="number" id="search-amount" placeholder="金额" min="0" step="0.01" inputmode="decimal" @keyup.enter="onSearch" />
                <span class="field-suffix">元</span>
              </div>
            </div>
            <label class="search-flag" title="只看还没有回礼的记录"><input v-model="searchUnreturned" type="checkbox" />未回礼</label>
            <button id="search-top-btn" type="button" @click="onSearch">查找</button>
            <button id="batch-note-btn" type="button" @click="batchNote">批量备注</button>
          </div>

          <div class="ledger-summary" aria-live="polite">
            <div class="summary-card primary"><span>{{ copy.totalLabel }}</span><span>{{ formatCurrency(displayTotal) }}</span></div>
            <div class="summary-card"><span>{{ copy.giversLabel }}</span><span>{{ stats.totalGivers }}</span><small class="summary-sub">{{ stats.recordCount }} 笔 · 人均 {{ formatCurrency(stats.average) }}</small></div>
            <div class="summary-card"><span>本页小计 / 元</span><span>{{ formatCurrency(subtotal) }}</span></div>
          </div>

          <div class="gift-book-frame">
            <div class="book-topline">
              <div class="book-caption">
                <h2>{{ copy.bookTitle }}</h2>
                <p>传统竖排 · 数字留痕</p>
              </div>
              <div class="book-navigation">
                <button class="page-edge" type="button" aria-label="第一页" title="第一页（Home）" :disabled="st.currentPage <= 1" @click="jumpPage(1)">«</button>
                <button id="prev-page-btn" type="button" aria-label="上一页" title="上一页（←）" :disabled="st.currentPage <= 1" @click="pageBy(-1)">‹</button>
                <button type="button" class="book-page-label" title="点击输入页码" @click="startPageEdit">
                  <span>第 {{ st.currentPage }} / {{ pages }} 页</span>
                  <small v-if="pageRange">{{ pageRange.from }}–{{ pageRange.to }} 条</small>
                </button>
                <input v-if="pageEditing" id="page-jump" ref="pageJumpInput" v-model.number="pageInput" class="page-jump" type="number" min="1" :max="pages" inputmode="numeric" aria-label="跳转到页码" @keydown.enter.prevent="jumpToInput" @keydown.esc.prevent="cancelPageEdit" @blur="finishPageEdit" />
                <button v-if="pageEditing" type="button" class="page-jump-btn" aria-label="跳转" @mousedown.prevent @click="jumpToInput">跳</button>
                <button id="next-page-btn" type="button" aria-label="下一页" title="下一页（→）" :disabled="st.currentPage >= pages" @click="pageBy(1)">›</button>
                <button class="page-edge" type="button" aria-label="最后一页" title="最后一页（End）" :disabled="st.currentPage >= pages" @click="jumpPage(pages)">»</button>
              </div>
            </div>
            <div v-if="st.currentEvent && !st.giftsLoaded" class="book-skeleton" aria-busy="true" aria-label="正在加载礼簿">
              <div class="sk-block"><i class="sk-line w60"></i><i class="sk-line w40"></i><i class="sk-line w80"></i></div>
              <div class="sk-grid"><i v-for="n in 8" :key="n" class="sk-cell"></i></div>
            </div>
            <div v-if="!st.gifts.length" class="book-empty">这本账簿还没有记录，从左边录入第一笔吧。</div>
            <div v-else-if="!pageRange" class="book-empty">这一页没有记录。<button type="button" class="gb-link-btn" @click="jumpPage(1)">回到第一页</button></div>
            <div class="book-scroll" tabindex="0" aria-label="礼簿明细，可横向滚动">
              <div id="gift-book-content" v-html="book"></div>
            </div>
            <p v-if="!items.length" class="book-empty-hint">{{ copy.emptyHint }}</p>
            <p class="book-note">{{ copy.bookNote }}</p>
          </div>
        </section>
      </div>
    </div>

    <!-- 手机端快速跳转：录入与礼簿来回切换，不用长距离滚动。 -->
    <div class="mobile-jump" aria-label="快速跳转">
      <button type="button" @click="scrollToSection('entry')">录入</button>
      <button type="button" @click="scrollToSection('book')">礼簿</button>
    </div>

    <!-- 录入回执：手机端礼簿在表单上方，记完一笔看不到更新；这条浮在底部，可一键回礼簿定位。 -->
    <div v-if="receiptVisible && recentEntry.name" id="entry-receipt" class="entry-receipt" role="status">
      <span class="entry-receipt-dot" aria-hidden="true"></span>
      <span class="entry-receipt-text">已录入 <b>{{ recentEntry.name }}</b> · {{ formatCurrency(recentEntry.amount) }}</span>
      <button type="button" class="entry-receipt-link" @click="revealRecent">在礼簿中查看</button>
      <button type="button" class="entry-receipt-close" aria-label="关闭提示" @click="receiptVisible = false">×</button>
    </div>

    <!-- 锁定时整页磨砂遮罩：防止路过的人看到礼金内容 -->
    <div v-if="st.locked" class="lock-veil" role="dialog" aria-modal="true" aria-label="账簿已锁定">
      <div class="lock-veil-card">
        <div class="lock-veil-seal" aria-hidden="true">锁</div>
        <h3>账簿已锁定</h3>
        <p>内容已隐藏。输入管理密码即可解锁。</p>
        <form v-if="currentEvent?.hasPassword" @submit.prevent="onUnlockSubmit">
          <input v-model="unlockPassword" type="password" placeholder="管理密码" autocomplete="current-password" />
          <div v-if="unlockError" class="lock-veil-error" role="alert">{{ unlockError }}</div>
          <button type="submit" class="themed-button-primary" :disabled="unlocking">{{ unlocking ? '解锁中…' : '解锁账簿' }}</button>
        </form>
        <button v-else type="button" class="themed-button-primary" @click="onToggleLock">解锁账簿</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, reactive, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { state as st, updateSessionEvent } from '../store.js'
import { api } from '../lib/api.js'
import { openModal } from '../lib/modal.js'
import { copyOf } from '../lib/content.js'
import { formatCurrency, formatDate } from '../lib/crypto.js'
import { showHome, syncEventTotal, loadGiftsForCurrentEvent, loadEvents, setSyncStatus } from '../bootstrap.js'
import { versionLabel, toggleLargeText, showChangelog, showNetworkDetails, verifyLedgerPassword } from '../lib/actions.js'
import { writeLocked } from '../lib/prefs.js'
import { startRealtime, stopRealtime } from '../lib/realtime.js'
import { netState as net } from '../lib/network.js'
import { queueFor, clearAllLedgerCaches } from '../lib/offline.js'
import { pulse } from '../lib/feedback.js'
import { playPage } from '../lib/sound.js'
import {
  PAYMENT_OPTIONS, RELATION_OPTIONS, entry, resetEntry, bookMarkup, computeStats, pageItems,
  totalPages, amountPreview, submitGift, submitBlank, batchNote, runSearch, openGiftDetails, showQueueModal,
  openStats, openExport, openPrint, openSettings, openOcr, toggleLedgerLock, showQrDialog,
} from '../lib/ledger-view.js'
import { focusGiftRow } from '../lib/ledger-actions.js'
import { recentEntry } from '../lib/recent-entry.js'
import { isArchived } from '../lib/archive.js'
import { pageRangeFor } from '../lib/page-size.js'

const dropdownOpen = ref(false)
const searchName = ref('')
const searchAmount = ref('')
const searchUnreturned = ref(false)
const ENTRY_SHOW_KEY = 'gb-entry-show'
function readEntryShow() {
  try {
    const value = JSON.parse(localStorage.getItem(ENTRY_SHOW_KEY) || '{}')
    return { type: Boolean(value.type), relation: Boolean(value.relation), remarks: Boolean(value.remarks) }
  } catch {
    return { type: false, relation: false, remarks: false }
  }
}
const entryShow = reactive(readEntryShow())
const hiddenFieldCount = computed(() => [entryShow.type, entryShow.relation, entryShow.remarks].filter(Boolean).length === 3 ? 0 : 1)
const foldSummary = computed(() => {
  const hidden = []
  if (!entryShow.type) hidden.push('收款方式')
  if (!entryShow.relation) hidden.push('关系')
  if (!entryShow.remarks) hidden.push('备注')
  return hidden.length === 3 ? '收款方式 · 关系 · 备注' : hidden.length ? `折叠：${hidden.join(' · ')}` : '全部常用'
})
function openFieldPicker() {
  const fields = [['type', '收款方式'], ['relation', '关系'], ['remarks', '备注']]
  const html = `
    <div class="gb-field-picker">
      <p class="gb-picker-intro">勾选的字段直接显示在录入表单里，未勾选的收进「更多选项」。选择保存在本机。</p>
      ${fields.map(([key, label]) => `<label class="gb-field-row"><input type="checkbox" ${entryShow[key] ? 'checked' : ''} data-field="${key}" /><span>${label}</span></label>`).join('')}
    </div>`
  openModal('录入字段', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '保存',
      class: 'modal-btn-primary',
      handler: () => {
        document.querySelectorAll('[data-field]').forEach((box) => {
          const key = box.dataset.field
          if (key) entryShow[key] = box.checked
        })
        try { localStorage.setItem(ENTRY_SHOW_KEY, JSON.stringify(entryShow)) } catch { /* 隐私模式忽略 */ }
      },
    },
  ], { dismissable: true })
}

const ENTRY_MORE_KEY = 'gb-entry-more'
function readEntryMorePref() {
  try { return localStorage.getItem(ENTRY_MORE_KEY) === '1' } catch { return false }
}
const entryMore = ref(readEntryMorePref())
function toggleEntryMore() {
  entryMore.value = !entryMore.value
  try { localStorage.setItem(ENTRY_MORE_KEY, entryMore.value ? '1' : '0') } catch { /* 隐私模式忽略 */ }
}

// 录入回执只在刚记完的一小段时间里出现，避免常驻挡视线。
const receiptVisible = ref(false)
let receiptTimer = 0
watch(
  () => recentEntry.at,
  (at) => {
    clearTimeout(receiptTimer)
    if (!at || !recentEntry.name) {
      receiptVisible.value = false
      return
    }
    receiptVisible.value = true
    receiptTimer = window.setTimeout(() => {
      receiptVisible.value = false
    }, 12000)
  },
  { immediate: true },
)

const copy = computed(() => copyOf(st.currentEvent, st.homeCategory))
const version = computed(() => versionLabel())
const queueCount = computed(() => queueFor(st.currentEvent?.id).length)
const items = computed(() => pageItems())
const pages = computed(() => totalPages())
const stats = computed(() => computeStats(st.gifts))
// 结簿归档与手动锁定共用一套禁用逻辑，但只读横幅单独提示、不遮住礼簿。
const readOnly = computed(() => st.locked || isArchived())

// 汇总金额变化时做一次 count-up；但首次拿到账簿数据要直接显示，
// 否则进入账簿会先播 420ms 数字滚动，看起来像还在加载。
const reduceMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
const displayTotal = ref(0)
let totalRaf = 0
let totalHasData = false
watch(
  () => stats.value.totalAmount,
  (next, prev) => {
    const to = Number(next) || 0
    if (!totalHasData || prev === undefined || reduceMotion) {
      displayTotal.value = to
      totalHasData = st.gifts.length > 0
      return
    }
    const from = Number(displayTotal.value) || 0
    if (from === to) {
      displayTotal.value = to
      return
    }
    cancelAnimationFrame(totalRaf)
    const start = performance.now()
    const duration = 420
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      displayTotal.value = from + (to - from) * eased
      if (t < 1) totalRaf = requestAnimationFrame(tick)
      else displayTotal.value = to
    }
    totalRaf = requestAnimationFrame(tick)
  },
  { immediate: true },
)
onBeforeUnmount(() => cancelAnimationFrame(totalRaf))
const subtotal = computed(() => items.value.reduce((sum, gift) => sum + (Number(gift.data?.amount) || 0), 0))
const amountText = computed(() => amountPreview(entry.amount))
const hasAmount = computed(() => Number(entry.amount) > 0)
const book = computed(() => bookMarkup())
const eventSub = computed(() => {
  const ev = st.currentEvent || {}
  const date = formatDate(ev.startDateTime)
  return [ev.template, date, ev.location].filter(Boolean).join(' · ')
})

let pageTimer = 0
function pageBy(direction) {
  const next = st.currentPage + direction
  if (next >= 1 && next <= pages.value) {
    st.currentPage = next
    const el = document.getElementById('gift-book-content')
    if (el) {
      const cls = direction > 0 ? 'gb-page-turn-next' : 'gb-page-turn-prev'
      // 连翻时先清掉上一次的收尾定时器，否则旧定时器会把新动画提前掐断（闪跳）。
      clearTimeout(pageTimer)
      el.classList.remove('gb-page-turn-next', 'gb-page-turn-prev')
      void el.offsetWidth
      el.classList.add(cls)
      pageTimer = window.setTimeout(() => el.classList.remove(cls), 320)
    }
    playPage(direction)
  }
}

// 总额/人数变化时给汇总卡一次轻量强调，不做常驻动画。
watch(
  () => [stats.value.totalAmount, stats.value.totalGivers, subtotal.value],
  () => pulse(document.querySelector('.ledger-summary')),
)

function onSubmit() {
  submitGift({ ...entry }, resetEntry)
}

// 「跳过」占住纸簿里的一行，之后点那一格可以原位补录，后面的序号不会前移。
function onBlank() {
  submitBlank(resetEntry)
}

function scrollToSection(which) {
  const target = document.getElementById(which === 'entry' ? 'entry-panel' : 'book-panel')
  target?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
}

// 「在礼簿中查看」：翻到那一页并把它滚到视野中间，闪一下做定位。
async function revealRecent() {
  receiptVisible.value = false
  if (recentEntry.index < 0) {
    document.querySelector('.gift-book-frame')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    return
  }
  await focusGiftRow(recentEntry.index)
}

const onSearch = () => runSearch(searchName.value, searchAmount.value, { unreturned: searchUnreturned.value })
const goHome = () => showHome()
const onToggleLock = () => toggleLedgerLock()

// 锁定遮罩里的解锁表单
const unlockPassword = ref('')
const unlockError = ref('')
const unlocking = ref(false)
const currentEvent = computed(() => st.currentEvent)

async function onUnlockSubmit() {
  if (unlocking.value) return
  unlocking.value = true
  unlockError.value = ''
  try {
    const result = await verifyLedgerPassword(st.currentEvent.id, unlockPassword.value)
    if (result.ok) {
      st.locked = false
      writeLocked(st.currentEvent.id, false)
      unlockPassword.value = ''
    } else {
      unlockError.value = result.message || '管理密码不正确'
    }
  } catch (err) {
    unlockError.value = err.message || '无法连接服务器，请稍后重试'
  } finally {
    unlocking.value = false
  }
}

const onToggleLargeText = () => toggleLargeText()
const openChangelog = () => showChangelog()
const openNetwork = () => showNetworkDetails()
const onRetrySync = async () => {
  await syncEventTotal()
}
const showQr = () => showQrDialog()

function menu(action) {
  dropdownOpen.value = false
  if (action === 'switch') return showHome()
  if (action === 'edit') return openSettings()
  if (action === 'delete') return openSettings({ section: 'delete' })
}

function onDocClick(event) {
  const cell = event.target.closest?.('[data-gift-index]')
  if (cell && cell.classList.contains('name-cell')) {
    const index = Number(cell.dataset.giftIndex)
    if (Number.isFinite(index)) openGiftDetails(index)
  }
  if (dropdownOpen.value && !event.target.closest?.('.event-switch') && !event.target.closest?.('.event-menu')) {
    dropdownOpen.value = false
  }
}

const pageInput = ref(1)
const pageEditing = ref(false)
const pageJumpInput = ref(null)

async function startPageEdit() {
  pageInput.value = st.currentPage
  pageEditing.value = true
  await nextTick()
  pageJumpInput.value?.focus()
  pageJumpInput.value?.select()
}

function finishPageEdit() {
  pageEditing.value = false
}

function cancelPageEdit() {
  pageEditing.value = false
}
watch(
  () => st.currentPage,
  (value) => { pageInput.value = value },
  { immediate: true },
)
watch(pages, (value) => {
  if (pageInput.value > value) pageInput.value = value
})

const pageRange = computed(() => pageRangeFor(st.currentPage, st.gifts.length))

function jumpPage(target) {
  pageEditing.value = false
  const value = Math.min(Math.max(1, Number(target) || 1), pages.value)
  if (value !== st.currentPage) {
    playPage(value > st.currentPage ? 1 : -1)
    st.currentPage = value
  }
  pageInput.value = value
}

function jumpToInput() {
  jumpPage(pageInput.value)
  pageEditing.value = false
}

function onKeydown(event) {
  if (event.key === 'Escape' && dropdownOpen.value) {
    dropdownOpen.value = false
    return
  }
  // Alt+N 回到姓名框：手机外接键盘和桌面录入都常用。
  if (event.altKey && (event.key === 'n' || event.key === 'N')) {
    event.preventDefault()
    document.getElementById('guest-name')?.focus()
    return
  }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === '/') {
    event.preventDefault()
    document.getElementById('search-name')?.focus()
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    jumpPage(1)
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    jumpPage(pages.value)
    return
  }
  if (event.key === 'ArrowLeft') pageBy(-1)
  if (event.key === 'ArrowRight') pageBy(1)
}

// 其他设备写入后：防抖重拉当前账簿，保留页码，不打断正在输入的表单。
let remoteTimer = 0
let remoteWasAtEnd = false
let remotePage = 1
// 远端变更一律立即拉取：不再用 setTimeout 防抖，避免后台标签被节流后不刷新。
// 并发时只保留一次补拉，避免同一批变更把请求打满。
let giftRefreshing = false
let giftRefreshPending = false

async function refreshGiftsFromRemote() {
  if (st.locked) return
  if (giftRefreshing) {
    giftRefreshPending = true
    return
  }
  giftRefreshing = true
  const wasAtEnd = remoteWasAtEnd
  const page = remotePage
  try {
    await loadGiftsForCurrentEvent()
    if (st.gifts.length) st.currentPage = wasAtEnd ? totalPages() : Math.min(page, totalPages())
  } catch {
    /* 网络暂时不可用：恢复后由重连/网络状态回调补拉 */
  } finally {
    giftRefreshing = false
    if (giftRefreshPending) {
      giftRefreshPending = false
      remoteWasAtEnd = st.currentPage >= totalPages()
      remotePage = st.currentPage
      void refreshGiftsFromRemote()
    }
  }
}

let eventSyncing = false
async function syncEventSettings(eventId) {
  if (eventSyncing) return
  eventSyncing = true
  try {
    const result = await api.getEvent(eventId)
    if (result?.data) {
      st.currentEvent = { ...st.currentEvent, ...result.data }
      updateSessionEvent(st.currentEvent)
      st.currentPage = Math.min(st.currentPage, totalPages())
    }
  } catch {
    /* 拉不到就保持当前显示，下一次变更或刷新会再同步 */
  } finally {
    eventSyncing = false
  }
}

function onRemoteChange(payload) {
  if (payload.type === 'restore' || payload.type === 'family-restore') {
    clearTimeout(remoteTimer)
    remoteTimer = window.setTimeout(async () => {
      setSyncStatus('数据已恢复，正在刷新…', false)
      try {
        // 整站恢复会影响所有家庭：清掉全部家庭的礼金缓存，避免离线时读到恢复前的数据。
        clearAllLedgerCaches()
        await loadEvents()
        await loadGiftsForCurrentEvent()
      } finally {
        setSyncStatus('')
      }
    }, 400)
    return
  }
  if (!payload.eventId || payload.eventId !== st.currentEvent?.id) return
  // 别的设备改了账簿设置（每页行数、正期、名称…）：拉一次最新账簿，
  // 本机立刻按新行数重排，不用等刷新页面。
  if (payload.type === 'event') {
    // 不用定时器：后台标签会被浏览器节流，导致设置变更迟迟不生效。
    void syncEventSettings(payload.eventId)
    return
  }
  // 在「收到变更的当下」记下是否停在末页：后台标签被节流时，
  // 回调可能晚很多才执行，那时页码可能已经被别的回调改过。
  remoteWasAtEnd = st.currentPage >= totalPages()
  remotePage = st.currentPage
  void refreshGiftsFromRemote()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
  // 手机浏览器会冻结后台页面、断掉 SSE：切回前台时主动补一次同步，
  // 不用用户手动刷新才能看到别的设备新记的礼金或改过的每页行数。
  const resyncCurrent = async () => {
    if (!st.currentEvent) return
    const page = st.currentPage
    const wasAtEnd = page >= totalPages()
    try {
      const [event, loaded] = await Promise.all([
        api.getEvent(st.currentEvent.id).catch(() => null),
        loadGiftsForCurrentEvent().then(() => true).catch(() => false),
      ])
      if (event?.data) {
        st.currentEvent = { ...st.currentEvent, ...event.data }
        updateSessionEvent(st.currentEvent)
      }
      // loadGifts 会把页码拉到末页；这里按回到前台前的浏览位置恢复，
      // 只有原本就在末页的人才跟着最新一页走。
      if (loaded) st.currentPage = wasAtEnd ? totalPages() : Math.min(page, totalPages())
    } catch {
      /* 网络还没恢复时保持现状，下一次可见或 SSE 重连会再补 */
    }
  }
  const handleVisible = () => {
    if (document.visibilityState === 'visible') resyncCurrent()
  }
  document.addEventListener('visibilitychange', handleVisible)
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', handleVisible))
  // 网络从断开恢复、或 SSE 断线重连成功时，立即补一次当前账簿的变更。
  watch(
    () => net.health.level,
    (level, previous) => {
      if (level === 'good' && previous && previous !== 'good') resyncCurrent()
    },
  )
  startRealtime(onRemoteChange, resyncCurrent)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
  stopRealtime()
  clearTimeout(remoteTimer)
})
</script>
