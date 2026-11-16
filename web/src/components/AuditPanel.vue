<template>
  <div class="gb-audit">
    <p class="gb-picker-intro">记录创建 / 删除家庭、改访问码、强制下线、整站或家庭还原等操作，最多显示最近 100 条。</p>
    <div v-if="loading" class="gb-empty">正在读取…</div>
    <div v-else-if="!items.length" class="gb-empty">还没有操作记录。</div>
    <div v-else class="gb-audit-list">
      <div v-for="(item, index) in items" :key="index" class="gb-audit-row" :class="{ 'is-danger': isDanger(item.action) }">
        <div class="gb-audit-head">
          <b>{{ item.action }}</b>
          <time>{{ item.at }}</time>
        </div>
        <p v-if="item.family">家庭：{{ item.family }}<template v-if="item.detail"> · {{ item.detail }}</template></p>
        <p v-else-if="item.detail">{{ item.detail }}</p>
        <span v-if="item.ip" class="gb-audit-ip">来源 {{ item.ip }}</span>
      </div>
    </div>
    <div v-if="error" class="gb-inline-error" role="alert">{{ error }}</div>
    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="closeModal">关闭</button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../lib/api.js'
import { closeModal } from '../lib/modal.js'

const items = ref([])
const loading = ref(true)
const error = ref('')

function isDanger(action) {
  return /删除|还原|下线|关闭/.test(action)
}

onMounted(async () => {
  try {
    const result = await api.auditLog()
    items.value = Array.isArray(result.data) ? result.data : []
  } catch (err) {
    error.value = err.message || '读取操作记录失败'
  } finally {
    loading.value = false
  }
})
</script>
