<template>
  <div class="gb-overview">
    <p class="gb-picker-intro">只显示家庭数量、账簿数量与备份状态，不显示礼金金额和姓名。</p>
    <div v-if="loading" class="gb-empty">正在统计…</div>
    <template v-else>
      <div class="gb-overview-summary">
        <div><b>{{ items.length }}</b><span>个家庭</span></div>
        <div><b>{{ totalEvents }}</b><span>本账簿</span></div>
        <div><b>{{ backedUp }}</b><span>个家庭已备份</span></div>
      </div>
      <div class="gb-overview-list">
        <div v-for="item in items" :key="item.id" class="gb-overview-row">
          <div class="gb-overview-main">
            <b>{{ item.name }} <small v-if="item.isDefault">默认</small></b>
            <span>{{ item.eventCount || 0 }} 本账簿 · {{ item.hasCode ? '需访问码' : '免访问码' }}</span>
          </div>
          <div class="gb-overview-meta">
            <span>最近活动：{{ item.lastActiveAt || '暂无' }}</span>
            <span :class="{ 'is-warn': !lastBackupOf(item) }">最近备份：{{ lastBackupOf(item) || '从未备份' }}</span>
          </div>
        </div>
      </div>
    </template>
    <div v-if="error" class="gb-inline-error" role="alert">{{ error }}</div>
    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="closeModal">关闭</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../lib/api.js'
import { closeModal } from '../lib/modal.js'

const items = ref([])
const loading = ref(true)
const error = ref('')

const totalEvents = computed(() => items.value.reduce((sum, item) => sum + (item.eventCount || 0), 0))
const lastBackupOf = (item) => [item.lastBackupAt, item.lastAutoBackupAt].filter(Boolean).sort().pop() || ''
const backedUp = computed(() => items.value.filter((item) => lastBackupOf(item)).length)

onMounted(async () => {
  try {
    const result = await api.familyOverview()
    items.value = Array.isArray(result.data) ? result.data : []
  } catch (err) {
    error.value = err.message || '读取家庭总览失败'
  } finally {
    loading.value = false
  }
})
</script>
