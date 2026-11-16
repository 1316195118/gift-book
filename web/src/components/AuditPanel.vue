<template>
  <div class="gb-audit">
    <p class="gb-picker-intro">记录创建 / 删除家庭、改访问码、强制下线、整站或家庭还原等操作，最多显示最近 400 条。</p>
    <div class="gb-audit-tools">
      <input v-model="keyword" type="search" placeholder="按动作 / 家庭 / 详情筛选" autocomplete="off" />
      <button type="button" class="gb-link-btn" :disabled="!filtered.length" @click="exportCsv">导出 CSV</button>
    </div>
    <div v-if="loading" class="gb-empty">正在读取…</div>
    <div v-else-if="!filtered.length" class="gb-empty">{{ items.length ? '没有匹配的记录。' : '还没有操作记录。' }}</div>
    <div v-else class="gb-audit-list">
      <div v-for="(item, index) in filtered" :key="index" class="gb-audit-row" :class="{ 'is-danger': isDanger(item.action) }">
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
import { computed, onMounted, ref } from 'vue'
import { api } from '../lib/api.js'
import { closeModal } from '../lib/modal.js'

const items = ref([])
const keyword = ref('')
const loading = ref(true)
const error = ref('')

const filtered = computed(() => {
  const key = keyword.value.trim()
  if (!key) return items.value
  return items.value.filter((item) => `${item.action || ''} ${item.family || ''} ${item.detail || ''} ${item.ip || ''}`.includes(key))
})

// 导出当前筛选结果：Excel 打开中文不乱码需要 BOM。
function exportCsv() {
  const rows = [['时间', '操作', '家庭', '详情', 'IP']]
  filtered.value.forEach((item) => rows.push([item.at || '', item.action || '', item.family || '', item.detail || '', item.ip || '']))
  const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `操作记录-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

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
