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
            <button id="settings-btn" class="main-tool" type="button" @click="openSettings()">设置</button>
            <button id="lock-btn" class="main-tool" type="button" @click="onToggleLock">{{ st.locked ? '解锁' : '锁定' }}</button>
            <button id="qr-show-btn" class="main-tool" type="button" @click="showQr">收款码</button>
            <button id="stats-btn" class="main-tool" type="button" @click="openStats">统计</button>
            <button type="button" class="main-tool large-text-toggle" :aria-pressed="st.largeText" @click="onToggleLargeText">{{ st.largeText ? '标准' : '大字' }}</button>
            <button id="print-btn" class="main-tool" type="button" @click="openPrint">打印</button>
            <button id="ocr-btn" class="main-tool" type="button" :disabled="!st.ocrAvailable" :title="st.ocrAvailable ? '扫描礼簿' : '当前部署未内置 OCR'" @click="openOcr">扫描礼簿</button>
            <button id="export-btn" class="main-tool main-tool-primary" type="button" @click="openExport">导出</button>
          </div>
        </div>
      </header>

      <div v-if="st.locked" class="lock-banner">
        <span>账簿已锁定，录入与修改已暂停。</span>
        <button id="unlock-btn" type="button" @click="onToggleLock">解锁</button>
      </div>

      <div v-if="st.syncMessage" class="sync-status" :class="{ 'sync-error': st.syncIsError }" role="status">
        <span>{{ st.syncMessage }}</span>
        <button id="retry-sync-btn" type="button" @click="onRetrySync">重试同步</button>
      </div>

      <div class="ledger-layout">
        <section class="entry-panel" aria-label="礼金录入">
          <div class="entry-heading">
            <h2>
              <span>{{ copy.entryTitle }}</span>
              <span v-if="queueCount" id="entry-pending" class="entry-pending"><i aria-hidden="true"></i>待同步<b>{{ queueCount }}</b></span>
            </h2>
            <p>{{ copy.entrySub }}</p>
          </div>

          <form id="add-gift-form" @submit.prevent="onSubmit" autocomplete="off">
            <div class="entry-field">
              <label for="guest-name">{{ copy.nameLabel }} <span class="field-counter">{{ entry.name.length }}/20</span></label>
              <div class="field-shell">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M4.8 19.5c.9-3.4 3.7-5.3 7.2-5.3s6.3 1.9 7.2 5.3" /></svg>
                <input v-model="entry.name" type="text" id="guest-name" :placeholder="copy.namePlaceholder" required maxlength="20" autocomplete="off" :disabled="st.locked" />
              </div>
            </div>

            <div class="entry-field">
              <label for="gift-amount">{{ copy.amountLabel }} <small>人民币 / 元</small></label>
              <div class="field-shell">
                <input v-model="entry.amount" type="number" id="gift-amount" data-suffix="元" placeholder="0.00" required min="0.01" max="1000000" step="0.01" inputmode="decimal" :disabled="st.locked" />
                <span class="field-suffix">元</span>
              </div>
              <div class="amount-chinese-preview" :class="{ 'is-filled': hasAmount }" aria-live="polite">{{ amountText }}</div>
            </div>

            <div class="entry-field entry-payment">
              <label>收款方式</label>
              <div class="payment-options">
                <label v-for="option in PAYMENT_OPTIONS" :key="option">
                  <input v-model="entry.type" type="radio" name="payment-type" :value="option" :disabled="st.locked" /><span>{{ option }}</span>
                </label>
              </div>
            </div>

            <div class="entry-field entry-relation">
              <label>关系 <small>选填 · 用于分类汇总</small></label>
              <div class="payment-options">
                <label>
                  <input v-model="entry.relation" type="radio" name="gift-relation" value="" :disabled="st.locked" /><span>未分类</span>
                </label>
                <label v-for="option in RELATION_OPTIONS" :key="option">
                  <input v-model="entry.relation" type="radio" name="gift-relation" :value="option" :disabled="st.locked" /><span>{{ option }}</span>
                </label>
              </div>
            </div>

            <div class="entry-field entry-remarks">
              <label for="remarks">备注 <small>选填 · {{ entry.remarks.length }}/4000</small></label>
              <textarea v-model="entry.remarks" id="remarks" :placeholder="copy.remarksPlaceholder" rows="2" maxlength="4000" :disabled="st.locked"></textarea>
            </div>

            <button type="submit" id="submit-gift-btn" :disabled="st.locked">确认录入</button>
            <p class="entry-hint">按回车核对并提交 · Shift + 回车换行</p>
          </form>
        </section>

        <section class="book-panel" :aria-label="copy.bookTitle + '与汇总'">
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
            <button id="search-top-btn" type="button" @click="onSearch">查找</button>
          </div>

          <div class="ledger-summary" aria-live="polite">
            <div class="summary-card primary"><span>{{ copy.totalLabel }}</span><span>{{ formatCurrency(displayTotal) }}</span></div>
            <div class="summary-card"><span>{{ copy.giversLabel }}</span><span>{{ stats.totalGivers }}</span></div>
            <div class="summary-card"><span>本页小计 / 元</span><span>{{ formatCurrency(subtotal) }}</span></div>
          </div>

          <div class="gift-book-frame">
            <div class="book-topline">
              <div class="book-caption">
                <h2>{{ copy.bookTitle }}</h2>
                <p>传统竖排 · 数字留痕</p>
              </div>
              <div class="book-navigation">
                <button id="prev-page-btn" type="button" aria-label="上一页" :disabled="st.currentPage <= 1" @click="pageBy(-1)">‹</button>
                <span>第 {{ st.currentPage }} / {{ pages }} 页</span>
                <button id="next-page-btn" type="button" aria-label="下一页" :disabled="st.currentPage >= pages" @click="pageBy(1)">›</button>
              </div>
            </div>
            <div class="book-scroll" tabindex="0" aria-label="礼簿明细，可横向滚动">
              <div id="gift-book-content" v-html="book"></div>
            </div>
            <p v-if="!items.length" class="book-empty-hint">{{ copy.emptyHint }}</p>
            <p class="book-note">{{ copy.bookNote }}</p>
          </div>
        </section>
      </div>
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
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { state as st } from '../store.js'
import { copyOf } from '../lib/content.js'
import { formatCurrency } from '../lib/crypto.js'
import { showHome, syncEventTotal } from '../bootstrap.js'
import { versionLabel, toggleLargeText, showChangelog, showNetworkDetails, verifyLedgerPassword } from '../lib/actions.js'
import { writeLocked } from '../lib/prefs.js'
import { netState as net } from '../lib/network.js'
import { queueFor } from '../lib/offline.js'
import { pulse } from '../lib/feedback.js'
import { playPage } from '../lib/sound.js'
import {
  PAYMENT_OPTIONS, RELATION_OPTIONS, entry, resetEntry, bookMarkup, computeStats, pageItems,
  totalPages, amountPreview, submitGift, runSearch, openGiftDetails, showQueueModal,
  openStats, openExport, openPrint, openSettings, openOcr, toggleLedgerLock, showQrDialog,
} from '../lib/ledger-view.js'

const dropdownOpen = ref(false)
const searchName = ref('')
const searchAmount = ref('')

const copy = computed(() => copyOf(st.currentEvent, st.homeCategory))
const version = computed(() => versionLabel())
const queueCount = computed(() => queueFor(st.currentEvent?.id).length)
const items = computed(() => pageItems())
const pages = computed(() => totalPages())
const stats = computed(() => computeStats(st.gifts))

// 汇总金额变化时做一次 count-up，避免数字硬跳；系统要求减动效时直接跳值。
const reduceMotion = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
const displayTotal = ref(0)
let totalRaf = 0
watch(
  () => stats.value.totalAmount,
  (next, prev) => {
    const to = Number(next) || 0
    if (prev === undefined || reduceMotion) {
      displayTotal.value = to
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
  const date = ev.startDateTime ? new Date(ev.startDateTime).toLocaleDateString('zh-CN') : ''
  return [ev.template, date, ev.location].filter(Boolean).join(' · ')
})

function pageBy(direction) {
  const next = st.currentPage + direction
  if (next >= 1 && next <= pages.value) {
    st.currentPage = next
    const el = document.getElementById('gift-book-content')
    if (el) {
      const cls = direction > 0 ? 'gb-page-turn-next' : 'gb-page-turn-prev'
      el.classList.remove('gb-page-turn-next', 'gb-page-turn-prev')
      void el.offsetWidth
      el.classList.add(cls)
      setTimeout(() => el.classList.remove(cls), 420)
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

const onSearch = () => runSearch(searchName.value, searchAmount.value)
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

function onKeydown(event) {
  if (event.key === 'Escape' && dropdownOpen.value) {
    dropdownOpen.value = false
    return
  }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'ArrowLeft') pageBy(-1)
  if (event.key === 'ArrowRight') pageBy(1)
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>
