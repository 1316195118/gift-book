<template>
  <div class="network-panel">
    <p class="hint" style="margin-bottom: 10px">当前：{{ healthText }}（近 12 次采样）</p>
    <table class="net-detail-table">
      <thead><tr><th>链路</th><th class="num">中位延迟</th><th class="num">最小 / 最大</th><th class="num">可用率</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.label">
          <td><span class="net-dot" :style="{ display: 'inline-block', marginRight: '8px', background: row.color }"></span>{{ row.label }}</td>
          <td class="num">{{ row.value }}</td>
          <td class="num">{{ row.range }}</td>
          <td class="num">{{ row.rate }}</td>
        </tr>
      </tbody>
    </table>
    <p class="net-detail-note">账簿接口与登录状态走本地 Go 服务，静态资源走内嵌文件；每 15 秒自动刷新一次。延迟 &lt;120ms 为通畅，120–400ms 偏慢，超过 400ms 或不可用标红。</p>
    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" :disabled="busy" @click="retest">{{ busy ? '重测中…' : '立即重测' }}</button>
      <button type="button" class="modal-btn-primary" @click="closeModal">知道了</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { NET_TARGETS, statsFor, computeHealth, refreshNetwork } from '../lib/network.js'
import { closeModal } from '../lib/modal.js'

const busy = ref(false)
const tick = ref(0)

const rows = computed(() => {
  void tick.value
  return NET_TARGETS.map((target) => {
    const s = statsFor(target.key)
    const level = s.ok ? (s.avg <= 120 ? '#4f9d68' : s.avg <= 400 ? '#d39a34' : '#c0392b') : '#c0392b'
    return {
      label: target.label,
      value: s.ok ? `${s.avg} ms` : '不可用',
      range: s.ok ? `${s.min} / ${s.max}` : '-',
      rate: s.ok ? `${s.rate}%` : '0%',
      color: level,
    }
  })
})

const healthText = computed(() => {
  void tick.value
  const health = computeHealth()
  return health.level === 'good' ? '通畅' : health.level === 'warn' ? '偏慢' : '异常'
})

async function retest() {
  busy.value = true
  try {
    await refreshNetwork()
    tick.value += 1
  } finally {
    busy.value = false
  }
}
</script>
