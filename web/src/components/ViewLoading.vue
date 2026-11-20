<template>
  <div class="gb-view-loading" role="status" aria-live="polite" :aria-busy="!error">
    <div class="gb-view-loading-sheet">
      <span class="gb-view-loading-mark" aria-hidden="true"><i></i></span>
      <div class="gb-view-loading-copy">
        <b>{{ error ? '页面暂时没有加载出来' : `正在打开${routeLabel}` }}</b>
        <p>{{ error ? '请检查网络后刷新页面，已保存的数据不会受影响。' : '正在准备界面与账簿数据…' }}</p>
      </div>
      <div v-if="!error" class="gb-view-loading-lines" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <button v-else type="button" class="modal-btn-primary" @click="reload">刷新页面</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { state as st } from '../store.js'

defineProps({
  error: { type: [Object, Error], default: null },
})

const routeLabel = computed(() => ({
  template: '账簿模板',
  setup: '创建页面',
  main: '账簿',
  guest: '来宾登记页',
}[st.route] || '页面'))

const reload = () => window.location.reload()
</script>
