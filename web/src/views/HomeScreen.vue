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
          <button type="button" class="home-help-btn" id="home-settings-btn" @click="showHomeSettings">设置</button>
          <button v-if="st.family" type="button" class="home-help-btn family-chip" id="family-btn" :title="`当前家庭：${st.family.name}，点击切换`" @click="switchFamily">
            <span class="family-chip-name">{{ st.family.name }}</span><span class="family-chip-sub">切换</span>
          </button>
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
            <div class="choice-count">{{ st.eventsLoading && !st.eventsLoaded ? '正在读取' : `${homeCount} 本账簿` }}</div>
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

      <div ref="recentEl" id="recent-events" class="recent-list" :aria-busy="st.eventsLoading && !st.eventsLoaded">
        <div v-if="st.eventsLoading && !st.eventsLoaded" class="recent-skeleton-group" aria-label="正在加载最近账簿">
          <div v-for="n in 3" :key="n" class="recent-skeleton" aria-hidden="true">
            <span class="sk-line w60"></span>
            <span class="sk-line w40"></span>
            <span class="sk-line w80"></span>
          </div>
        </div>
        <div v-else-if="!recentEvents.length" class="recent-empty">还没有{{ isSolemn ? '白事' : '红事' }}账簿，点击「创建新账簿」开始第一本。</div>
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
              <span class="rd-date" :title="ceremonyTitle(ev)">{{ cardDateText(ev) }}</span>
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

      <footer class="home-footer"><span>本地部署 · 自主管理</span><span>建议开启自动备份，并定期导出留底</span></footer>
      <p class="home-legal">
        <button type="button" class="home-legal-btn" @click="showLicense">© 2026 Gift Book contributors · MIT License</button>
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { state as st } from '../store.js'
import { CATEGORY_TEXT, RED_TEMPLATES, WHITE_TEMPLATES, copyOf, isSolemnEvent } from '../lib/content.js'
import { ceremonyLabel, daysUntilText } from '../lib/ceremony.js'
import { showTemplates, showSetup, showHelpDialog, openEvent, showLicense } from '../lib/actions.js'
import { switchCategory } from '../lib/actions.js'
import { api } from '../lib/api.js'
import { showHomeSettings } from '../lib/home-settings.js'
import { readQueue } from '../lib/offline.js'

const recentEl = ref(null)
function onSwitchCategory(cat) {
  if (cat === st.homeCategory) return
  switchCategory(cat)
}
// 默认展示金额与人数；点眼睛才遮起来，隐私由用户自己控制
const masked = reactive(new Set())

const catText = computed(() => CATEGORY_TEXT[st.homeCategory])
const copy = computed(() => copyOf(null, st.homeCategory))
const isSolemn = computed(() => st.homeCategory === 'white')

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

// 最近账簿会渲染多张卡片；一次性读取并分组待同步队列，
// 避免每张卡片都重新解析一次 localStorage。
const pendingCounts = computed(() => {
  // paintQueueCount 更新状态后让这份分组结果失效，避免一直显示旧角标。
  void st.queueCount
  const counts = new Map()
  readQueue().forEach((item) => {
    const id = String(item.eventId)
    counts.set(id, (counts.get(id) || 0) + 1)
  })
  return counts
})
const pendingFor = (eventId) => pendingCounts.value.get(String(eventId)) || 0

const displayIdOf = (ev) => String(ev.displayId || '').padStart(3, '0').slice(-3)

const createdText = (ev) => (ev.createdAt ? String(ev.createdAt).slice(0, 10).replace(/-/g, '/') : '')

// 卡片优先显示「距今 N 天」；没填正期和结束日期时退回创建日期。
const cardDateText = (ev) => daysUntilText(ev) || createdText(ev)
const ceremonyTitle = (ev) => {
  const raw = ev?.ceremonyAt ? String(ev.ceremonyAt) : ev?.endDate ? String(ev.endDate) : ''
  if (!raw) return ''
  const at = new Date(ev.ceremonyAt ? raw : raw.slice(0, 10))
  if (Number.isNaN(at.getTime())) return ''
  const label = ev?.ceremonyAt ? ceremonyLabel(ev, st.homeCategory) : '账簿结束日期'
  return `${label}：${at.toLocaleString('zh-CN', { hour12: false })}`
}

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

// 切换家庭：清掉当前家庭会话并回到家庭门，避免把上一家的账簿带过去。
const switchFamily = async () => {
  try {
    await api.familyLogout()
  } catch {
    /* 即使退出接口失败也刷新，家庭门会重新校验 */
  }
  location.reload()
}

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
