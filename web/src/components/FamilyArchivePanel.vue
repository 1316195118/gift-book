<template>
  <div class="gb-archive">
    <p class="gb-picker-intro">删除家庭后，账簿与礼金会归档到这里。恢复会新建一个「（已恢复）」家庭，默认免访问码，之后可在家庭管理里重新设码。</p>
    <div v-if="loading" class="gb-empty">正在读取归档…</div>
    <div v-else-if="!items.length" class="gb-empty">还没有已删除的家庭归档。</div>
    <div v-else class="gb-archive-list">
      <div v-for="item in items" :key="item.name" class="gb-archive-row">
        <div class="gb-archive-main">
          <b>{{ item.familyName }}</b>
          <span>{{ item.eventCount }} 本账簿 · {{ item.giftFiles }} 份礼金文件 · {{ item.archivedAt || '时间未知' }}</span>
        </div>
        <button type="button" class="gb-link-btn" @click="restore(item)">恢复</button>
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
import { closeModal, confirm } from '../lib/modal.js'
import { notify } from '../lib/notify.js'

const items = ref([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.listFamilyArchives()
    items.value = Array.isArray(result.data) ? result.data : []
  } catch (err) {
    error.value = err.message || '读取归档失败'
  } finally {
    loading.value = false
  }
}

function restore(item) {
  confirm(
    '恢复家庭归档',
    `将把「${item.familyName}」的 ${item.eventCount} 本账簿恢复成一个新的开放家庭（名称加「已恢复」）。原访问码不会恢复，需要重新设置。确定吗？`,
    async () => {
      try {
        const result = await api.restoreFamilyArchive(item.name)
        const data = result.data || {}
        notify.success('已恢复家庭', `新家庭「${data.familyName || '已恢复'}」，共 ${data.eventCount || 0} 本账簿。`)
        setTimeout(() => location.reload(), 900)
      } catch (err) {
        error.value = err.message || '恢复失败，请重试'
      }
    },
  )
}

onMounted(load)
</script>
