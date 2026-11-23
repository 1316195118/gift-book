<template>
  <div class="gb-profile-panel">
    <div class="gb-insight-hero">
      <div>
        <span class="gb-insight-kicker">跨账簿来宾档案</span>
        <h3>{{ loading ? '正在整理本会话已解锁账簿' : `${profiles.length} 位来宾 · ${records.length} 笔往来` }}</h3>
        <p>档案只在浏览器内解密并聚合。未解锁或密码不同的账簿不会被猜测或伪造数据。</p>
      </div>
      <div class="gb-insight-score"><b>{{ scannedEvents }}</b><span>已读取账簿</span></div>
    </div>

    <div v-if="loading" class="gb-progress-card" role="status" aria-live="polite">
      <div class="gb-progress-head"><b>{{ scanStatus }}</b><span>{{ progress }}%</span></div>
      <div class="gb-progress-track"><i :style="{ width: `${progress}%` }"></i></div>
    </div>

    <div v-if="errors.length" class="gb-profile-skipped">
      <b>未纳入 {{ errors.length }} 本账簿</b>
      <span v-for="item in errors" :key="item.name">{{ item.name }}：{{ item.reason }}</span>
    </div>

    <div class="gb-profile-toolbar">
      <input v-model="query" type="search" placeholder="按姓名、关系或账簿查找" autocomplete="off" />
      <span>金额按每笔记录累计</span>
    </div>

    <div class="gb-profile-layout">
      <div class="gb-profile-list" role="listbox" aria-label="来宾列表">
        <button
          v-for="profile in filteredProfiles"
          :key="profile.name"
          type="button"
          class="gb-profile-person"
          :class="{ active: profile.name === selectedName }"
          @click="selectedName = profile.name"
        >
          <span class="gb-profile-avatar" aria-hidden="true">{{ Array.from(profile.name)[0] }}</span>
          <span class="gb-profile-person-main">
            <b>{{ profile.name }}</b>
            <small>{{ profile.primaryRelation }} · {{ profile.recordCount }} 笔 · {{ profile.events.length }} 本账簿</small>
          </span>
          <strong>{{ formatCurrency(profile.totalAmount) }}</strong>
        </button>
        <div v-if="!loading && !filteredProfiles.length" class="gb-empty">没有找到匹配的来宾档案。</div>
      </div>

      <section v-if="selected" class="gb-profile-detail">
        <div class="gb-profile-title">
          <div><span>{{ selected.primaryRelation }}</span><h4>{{ selected.name }}</h4></div>
          <span class="gb-profile-status" :class="`is-${selected.status}`">{{ statusLabel(selected.status) }}</span>
        </div>
        <div class="gb-profile-metrics">
          <div><span>累计往来</span><b>{{ formatCurrency(selected.totalAmount) }}</b></div>
          <div><span>已回礼</span><b>{{ formatCurrency(selected.returnedAmount) }}</b></div>
          <div><span>净人情</span><b>{{ formatCurrency(selected.netAmount) }}</b></div>
          <div><span>往来次数</span><b>{{ selected.recordCount }} 笔</b></div>
        </div>
        <div class="gb-profile-section">
          <h5>涉及账簿</h5>
          <div class="gb-profile-events">
            <span v-for="event in selected.events" :key="event.id"><b>{{ event.name }}</b>{{ event.count }} 笔 · {{ formatCurrency(event.cents / 100) }}</span>
          </div>
        </div>
        <div class="gb-profile-section">
          <h5>最近往来</h5>
          <div class="gb-profile-entries">
            <div v-for="entry in selected.entries.slice(0, 8)" :key="`${entry.eventId}:${entry.giftId}:${entry.timestamp}`">
              <span><b>{{ formatCurrency(entry.amount) }}</b>{{ entry.eventName }} · {{ entry.relation }}</span>
              <small>{{ formatDateTime(entry.timestamp) }}{{ entry.operator ? ` · ${entry.operator}` : '' }}</small>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { state as st, NO_PASSWORD_KEY, ledgerKeyForEvent, ledgerPasswordForEvent } from '../store.js'
import { api } from '../lib/api.js'
import { decryptData } from '../bootstrap.js'
import { buildGuestProfiles, searchGuestProfiles } from '../lib/guest-profile.js'
import { formatCurrency, formatDateTime } from '../lib/format.js'

const loading = ref(true)
const progress = ref(4)
const scanStatus = ref('正在读取账簿列表…')
const records = ref([])
const errors = ref([])
const scannedEvents = ref(0)
const query = ref('')
const selectedName = ref('')
const profiles = computed(() => buildGuestProfiles(records.value))
const filteredProfiles = computed(() => searchGuestProfiles(profiles.value, query.value))
const selected = computed(() => profiles.value.find((profile) => profile.name === selectedName.value) || filteredProfiles.value[0] || null)

function statusLabel(status) {
  return status === 'returned' ? '已回礼' : status === 'partial' ? '部分回礼' : '未回礼'
}

function appendCurrent(rows) {
  if (!st.currentEvent) return
  st.gifts.forEach((gift) => {
    if (!gift?.data || gift.data.kind === 'blank') return
    rows.push({
      eventId: st.currentEvent.id,
      eventName: st.currentEvent.name,
      giftId: gift.id,
      data: gift.data,
    })
  })
}

async function loadProfiles() {
  const rows = []
  appendCurrent(rows)
  scannedEvents.value = st.currentEvent ? 1 : 0
  let events = []
  try {
    const result = await api.listEvents()
    const raw = result?.data ?? {}
    events = Array.isArray(raw) ? raw : Object.values(raw)
  } catch (error) {
    errors.value.push({ name: '账簿列表', reason: error.message || '读取失败' })
  }
  const candidates = events.filter((event) => event.id !== st.currentEvent?.id && Number(event.giftCount || 0) > 0)
  for (let index = 0; index < candidates.length; index += 1) {
    const event = candidates[index]
    progress.value = Math.min(92, 10 + Math.round(((index + 1) / Math.max(1, candidates.length + 1)) * 82))
    scanStatus.value = `正在整理「${event.name}」（${index + 1} / ${candidates.length}）`
    let password = ledgerPasswordForEvent(event.id)
    if (!password && !event.hasPassword) password = NO_PASSWORD_KEY
    if (event.hasPassword && !password) {
      errors.value.push({ name: event.name, reason: '本次会话尚未解锁' })
      continue
    }
    try {
      const key = event.hasPassword ? ledgerKeyForEvent(event.id) : ''
      const result = await api.listGifts(event.id, key)
      let readable = 0
      const gifts = Object.values(result.data || {})
      for (let giftIndex = 0; giftIndex < gifts.length; giftIndex += 1) {
        const gift = gifts[giftIndex]
        const data = gift?.encryptedContent ? decryptData(gift.encryptedContent, password) : null
        if (data && data.kind !== 'blank') {
          readable += 1
          rows.push({ eventId: event.id, eventName: event.name, giftId: gift.id, data })
        }
        // 大账簿逐条解密时定期让出主线程，保持面板和关闭按钮可响应。
        if ((giftIndex + 1) % 60 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (readable > 0) scannedEvents.value += 1
      else if (Number(event.giftCount) > 0) errors.value.push({ name: event.name, reason: '本次会话无法解密' })
    } catch (error) {
      errors.value.push({ name: event.name, reason: error.message || '读取失败' })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  records.value = rows
  progress.value = 100
  scanStatus.value = '整理完成'
  selectedName.value = buildGuestProfiles(rows)[0]?.name || ''
  loading.value = false
}

onMounted(loadProfiles)
</script>
