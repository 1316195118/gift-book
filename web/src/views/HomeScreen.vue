<template>
  <div id="home-screen" class="home-screen-wrap">
    <div class="home-inner">
      <header class="home-topbar">
        <div class="home-brand"><span class="seal">礼</span><span>电子礼簿</span></div>
        <div class="cat-switch" id="cat-switch" role="tablist" aria-label="事项分类">
          <button type="button" class="cat-btn" :class="{ active: st.homeCategory === 'red' }" role="tab" :aria-selected="st.homeCategory === 'red'" data-cat="red" @click="onSwitchCategory('red')">红事</button>
          <button type="button" class="cat-btn" :class="{ active: st.homeCategory === 'white' }" role="tab" :aria-selected="st.homeCategory === 'white'" data-cat="white" @click="onSwitchCategory('white')">白事</button>
        </div>
        <div class="home-top-actions">
          <button type="button" class="net-chip" :class="'is-' + net.health.level" :title="netTitle" @click="showNetworkDetails">
            <span class="net-dot" aria-hidden="true"></span><span class="net-text">{{ net.health.text }}</span><span class="net-label" aria-hidden="true">存储</span>
          </button>
          <button type="button" class="version-chip" title="查看更新说明" @click="showChangelog">v{{ version }}</button>
          <button type="button" class="home-help-btn large-text-toggle" :aria-pressed="st.largeText" @click="toggleLargeText">{{ st.largeText ? '标准字号' : '大字' }}</button>
          <button type="button" class="home-help-btn sound-toggle" :aria-pressed="soundOn" :title="soundOn ? '关闭提示音' : '开启提示音'" @click="toggleSound">{{ soundOn ? '音效开' : '静音' }}</button>
          <button type="button" class="home-help-btn" id="autobackup-btn" @click="showAutoBackupModal">备份</button>
          <button type="button" class="home-help-btn" id="access-btn" @click="showAccessModal">{{ st.authEnabled ? '访问保护 · 开' : '访问保护' }}</button>
          <button v-if="st.authEnabled" type="button" class="home-help-btn" id="logout-btn" @click="logout">退出</button>
        </div>
      </header>

      <section class="home-hero">
        <div class="hero-copy">
          <div class="eyebrow" id="home-eyebrow">{{ catText.eyebrow }}</div>
          <h1 id="home-title">{{ catText.title }}</h1>
          <div class="sub" id="home-sub">{{ catText.sub }}</div>
        </div>
        <div class="home-trust" aria-label="本地部署、加密存储、便捷导出">
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" stroke-linecap="round" /></svg>本地部署</span>
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" stroke-linecap="round" /></svg>加密存储</span>
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke-linecap="round" stroke-linejoin="round" /></svg>便捷导出</span>
        </div>
      </section>

      <div class="choice-grid">
        <div class="choice-card" id="home-main-card" role="button" tabindex="0" aria-label="选择礼簿模板" @click="showTemplates(st.homeCategory)" @keydown.enter.prevent="showTemplates(st.homeCategory)" @keydown.space.prevent="showTemplates(st.homeCategory)">
          <div class="hero-book-art" aria-hidden="true">
            <div class="book">
              <div class="book-pages"></div>
              <div class="book-cover">
                <div class="book-stitch"></div>
                <div class="book-frame">
                  <span class="book-edition">{{ isSolemn ? '肃 穆 礼 记' : '喜 事 礼 记' }}</span>
                  <span class="book-seal">{{ isSolemn ? '奠' : '囍' }}</span>
                  <span class="book-title">礼簿</span>
                  <span class="book-rule"></span>
                  <span class="book-sub">{{ isSolemn ? '肃 · 穆 · 记' : '壹 · 叁' }}</span>
                </div>
              </div>
            </div>
          </div>
          <div>
            <div class="choice-kicker">{{ catText.kicker }}</div>
            <div class="choice-title">{{ catText.cardTitle }}</div>
            <div class="choice-desc">{{ catText.cardDesc }}</div>
            <div class="choice-count">{{ homeCount }} 本账簿</div>
          </div>
          <div class="choice-go">{{ catText.go }}</div>
        </div>

        <aside class="home-side" aria-label="使用提示">
          <div class="home-side-kicker">三步开始</div>
          <ol class="home-side-steps">
            <li><span>01</span><div><b>选择场景</b><small>{{ copy.stepScene }}</small></div></li>
            <li><span>02</span><div><b>建立账簿</b><small>填写起止时间与地点，管理密码可选</small></div></li>
            <li><span>03</span><div><b>登记与导出</b><small>{{ copy.stepEntry }}</small></div></li>
          </ol>
          <button type="button" class="home-side-help" @click="showHelpDialog">查看完整使用说明</button>
        </aside>
      </div>

      <div class="section-head recent-head">
        <div class="recent-head-title">
          <h2>最近账簿</h2>
          <span class="section-note">打开后自动汇总金额与人数</span>
        </div>
        <div class="recent-nav" id="recent-nav">
          <span class="recent-nav-hint">左右滑动查看</span>
          <button type="button" class="recent-arrow" id="recent-prev" aria-label="上一组账簿" :disabled="!canPrev" @click="scrollRecent(-1)">‹</button>
          <button type="button" class="recent-arrow" id="recent-next" aria-label="下一组账簿" :disabled="!canNext" @click="scrollRecent(1)">›</button>
        </div>
      </div>

      <div ref="recentEl" id="recent-events" class="recent-list">
        <div v-if="!recentEvents.length" class="recent-empty">还没有{{ isSolemn ? '白事' : '红事' }}账簿，点击「创建新账簿」开始第一本。</div>
        <div
          v-for="ev in recentEvents"
          :key="ev.id"
          class="recent-item"
          :class="isSolemnEvent(ev) ? 'white' : 'red'"
          role="button"
          tabindex="0"
          @click="openEvent(ev)"
          @keydown.enter.prevent="openEvent(ev)"
        >
          <div class="recent-body">
            <div class="recent-top">
              <div class="rn">{{ ev.name || '未命名账簿' }}</div>
              <div class="recent-meta">
                <span v-if="pendingFor(ev.id)" class="recent-pending-badge">待同步 {{ pendingFor(ev.id) }}</span>
                <span v-if="ev.displayId" class="ledger-no">No.{{ displayIdOf(ev) }}</span>
              </div>
            </div>
            <div class="rd">
              <span class="rd-date">{{ createdText(ev) }}</span>
              <span v-if="ev.template" class="rd-dot">·</span>
              <span v-if="ev.template">{{ ev.template }}</span>
              <span v-if="ev.location" class="rd-dot">·</span>
              <span v-if="ev.location" class="rd-loc">{{ ev.location }}</span>
            </div>
            <div class="rfoot">
              <span class="rtag">{{ templateLabel(ev) }}</span>
              <div class="recent-money">
                <span class="rm-value" :class="{ hidden: masked.has(ev.id) }"><span class="rm-count">{{ countText(ev) }}</span><span class="rm-amount">{{ amountText(ev) }}</span></span>
                <span class="rm-mask" :class="{ hidden: !masked.has(ev.id) }"><span>••• 人</span><span>¥••••</span></span>
                <button type="button" class="eye-btn" :aria-pressed="masked.has(ev.id)" :aria-label="masked.has(ev.id) ? '显示金额与人数' : '隐藏金额与人数'" @click.stop="toggleEye(ev.id)">
                  <svg v-if="!masked.has(ev.id)" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.6" /></svg>
                  <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.3 6.9A16.6 16.6 0 0 0 2 12s3.5 6 10 6a10.7 10.7 0 0 0 5.4-1.4" /></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="home-bottom">
        <p>一笔一份心意，一簿一段时光。</p>
        <button id="home-create-btn" class="home-create-btn" @click="createNew">＋ 创建新账簿</button>
      </div>

      <footer class="home-footer"><span>本地部署 · 自主管理</span><span>建议定期导出，妥善留存每一份记录</span></footer>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { state as st } from '../store.js'
import { CATEGORY_TEXT, RED_TEMPLATES, WHITE_TEMPLATES, copyOf, isSolemnEvent } from '../lib/content.js'
import { showTemplates, showSetup, showHelpDialog, openEvent, versionLabel, showChangelog } from '../lib/actions.js'
import { showAccessModal, showAutoBackupModal, logout, showNetworkDetails, switchCategory, toggleLargeText } from '../lib/actions.js'
import { netState as net } from '../lib/network.js'
import { queueFor } from '../lib/offline.js'
import { soundEnabled, setSoundEnabled } from '../lib/prefs.js'
import { playTheme, playTap } from '../lib/sound.js'

const recentEl = ref(null)
const soundOn = ref(soundEnabled())
function toggleSound() {
  const next = !soundOn.value
  setSoundEnabled(next)
  soundOn.value = soundEnabled()
  if (next) playTap()
}
function onSwitchCategory(cat) {
  if (cat === st.homeCategory) return
  playTheme(cat === 'white')
  switchCategory(cat)
}
const version = computed(() => versionLabel())
// 默认展示金额与人数；点眼睛才遮起来，隐私由用户自己控制
const masked = reactive(new Set())

const catText = computed(() => CATEGORY_TEXT[st.homeCategory])
const copy = computed(() => copyOf(null, st.homeCategory))
const isSolemn = computed(() => st.homeCategory === 'white')

const netTitle = computed(() =>
  net.health.level === 'bad' ? '网络异常，点击查看详情' : `网络正常 · ${net.health.text}，点击查看详情`,
)

const homeCount = computed(() => {
  const wantSolemn = st.homeCategory === 'white'
  return Object.values(st.cachedEvents || {}).filter((ev) => isSolemnEvent(ev, st.homeCategory) === wantSolemn).length
})

const recentEvents = computed(() => {
  const wantSolemn = st.homeCategory === 'white'
  return Object.values(st.cachedEvents || {})
    .filter((ev) => isSolemnEvent(ev, st.homeCategory) === wantSolemn)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 12)
})

const pendingFor = (eventId) => queueFor(eventId).length

const displayIdOf = (ev) => String(ev.displayId || '').padStart(3, '0').slice(-3)

const createdText = (ev) => (ev.createdAt ? String(ev.createdAt).slice(0, 10).replace(/-/g, '/') : '')

// 卡片标签显示创建时选的模板类型（婚宴/寿宴/满月酒…），老账簿没有模板时退回红事/白事
const templateLabel = (ev) => {
  const raw = String(ev.template || '').trim()
  if (!raw) return isSolemnEvent(ev, st.homeCategory) ? '白事' : '红事'
  const hit = [...RED_TEMPLATES, ...WHITE_TEMPLATES].find((t) => t.key === raw || t.name === raw)
  return hit ? hit.name : raw
}

const countText = (ev) => {
  const value = Number(ev.giftCount ?? ev.totalGivers)
  return Number.isFinite(value) ? `${value.toLocaleString('zh-CN')} 人` : '— 人'
}

const amountText = (ev) => {
  const total = Number(ev.totalAmount)
  // 没有金额时也要有个像样的占位，别显示成一条破折号
  if (ev.totalAmount === undefined || ev.totalAmount === null || isNaN(total)) return '¥0.00'
  return `¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const toggleEye = (id) => (masked.has(id) ? masked.delete(id) : masked.add(id))

const canPrev = ref(false)
const canNext = ref(false)
const syncArrows = () => {
  const el = recentEl.value
  if (!el) return
  canPrev.value = el.scrollLeft > 1
  canNext.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

const scrollRecent = (direction) => {
  const el = recentEl.value
  if (!el) return
  el.scrollBy({ left: direction * (el.clientWidth || 320), behavior: 'smooth' })
  setTimeout(syncArrows, 320)
}

const createNew = () => showSetup()

onMounted(() => {
  const el = recentEl.value
  if (!el) return
  el.scrollLeft = 0
  syncArrows()
  el.addEventListener('scroll', syncArrows, { passive: true })
  window.addEventListener('resize', syncArrows)
})

watch(
  () => recentEvents.value.length,
  () => nextTick(syncArrows),
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncArrows)
})
</script>
