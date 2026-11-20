<template>
  <Transition name="gb-activity">
    <div v-if="visible" class="gb-request-activity" role="status" aria-live="polite" aria-atomic="true">
      <span class="gb-request-line" aria-hidden="true"><i :class="`is-${activityState.tone}`"></i></span>
      <span class="gb-request-copy">
        <i class="gb-request-dot" :class="`is-${activityState.tone}`" aria-hidden="true"></i>
        <span>{{ displayLabel }}</span>
      </span>
    </div>
  </Transition>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { activityState } from '../lib/activity.js'

const visible = ref(false)
let showTimer = 0
let hideTimer = 0

const displayLabel = computed(() => {
  if (activityState.tone === 'error') return '请求未完成，请稍后重试'
  if (!activityState.active && activityState.tone === 'done') return '加载完成'
  return activityState.label || '正在加载数据'
})

watch(
  () => activityState.active,
  (active, previous) => {
    clearTimeout(showTimer)
    if (active > 0) {
      clearTimeout(hideTimer)
      // 本机请求通常几十毫秒完成，延迟出现可以避免状态条闪烁。
      if (!visible.value) showTimer = window.setTimeout(() => { visible.value = true }, 140)
      return
    }
    if (previous > 0 && visible.value) {
      hideTimer = window.setTimeout(() => { visible.value = false }, activityState.tone === 'error' ? 650 : 260)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
})
</script>
