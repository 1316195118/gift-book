<template>
  <div class="gb-review-queue">
    <div class="gb-insight-hero">
      <div>
        <span class="gb-insight-kicker">异常核对</span>
        <h3>{{ visible.length ? `还有 ${visible.length} 笔值得再看一眼` : '本轮异常已核对完' }}</h3>
        <p>只在本机根据已解密礼金判断。标记已核对后，记录再次修改会重新出现。</p>
      </div>
      <div class="gb-insight-score" :class="{ 'is-clear': !visible.length }">
        <b>{{ visible.length }}</b><span>待核对</span>
      </div>
    </div>

    <div v-if="allItems.length" class="gb-filter-chips" role="group" aria-label="按异常类型筛选">
      <button type="button" :class="{ active: filter === '' }" @click="filter = ''">
        全部 {{ visible.length }}
      </button>
      <button
        v-for="type in activeTypes"
        :key="type.code"
        type="button"
        :class="{ active: filter === type.code }"
        @click="filter = type.code"
      >
        {{ type.label }} {{ type.count }}
      </button>
    </div>

    <div v-if="rows.length" class="gb-review-list">
      <article v-for="item in rows" :key="item.signature" class="gb-review-row" :class="`is-${topSeverity(item)}`">
        <div class="gb-review-main">
          <div class="gb-review-head">
            <b>{{ item.name }}</b>
            <strong>{{ formatCurrency(item.amount) }}</strong>
          </div>
          <div class="gb-review-meta">
            <span>{{ formatDateTime(item.timestamp) || '时间未记录' }}</span>
            <span v-for="issue in item.issues" :key="issue.code" class="gb-issue-tag" :class="`is-${issue.severity}`">{{ issue.label }}</span>
          </div>
        </div>
        <div class="gb-review-actions">
          <button type="button" class="gb-link-btn" @click="locate(item)">定位</button>
          <button type="button" class="modal-btn-primary" @click="complete(item)">已核对</button>
        </div>
      </article>
    </div>
    <div v-else-if="visible.length" class="gb-empty">这个筛选下没有记录。</div>
    <div v-else class="gb-review-empty">
      <span aria-hidden="true">✓</span>
      <b>当前账簿没有待核对异常</b>
      <p>大额、非整十金额、10 元及以下、同名同额、同名多笔、同名未备注和低置信度 OCR 都会自动进入核对队列。</p>
      <button v-if="Object.keys(reviewed).length" type="button" class="gb-link-btn" @click="resetReviewed">重新显示已核对记录</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { state as st } from '../store.js'
import { closeModal } from '../lib/modal.js'
import { formatCurrency, formatDateTime } from '../lib/format.js'
import { focusGiftRow, openGiftDetails } from '../lib/ledger-actions.js'
import { notify } from '../lib/notify.js'
import { REVIEW_TYPES, buildReviewQueue, clearReviewed, loadReviewed, saveReviewed } from '../lib/review-queue.js'

const filter = ref('')
const reviewed = ref(loadReviewed(st.currentEvent?.id))
const allItems = computed(() => buildReviewQueue(st.gifts))
const visible = computed(() => allItems.value.filter((item) => !reviewed.value[item.signature]))
const activeTypes = computed(() => Object.entries(REVIEW_TYPES).map(([code, meta]) => ({
  code,
  ...meta,
  count: visible.value.filter((item) => item.issues.some((issue) => issue.code === code)).length,
})).filter((type) => type.count))
const rows = computed(() => filter.value ? visible.value.filter((item) => item.issues.some((issue) => issue.code === filter.value)) : visible.value)

function topSeverity(item) {
  const order = { high: 3, medium: 2, low: 1 }
  return [...item.issues].sort((a, b) => order[b.severity] - order[a.severity])[0]?.severity || 'low'
}

async function locate(item) {
  closeModal()
  await new Promise((resolve) => setTimeout(resolve, 140))
  await focusGiftRow(item.giftIndex)
  setTimeout(() => openGiftDetails(item.giftIndex), 260)
}

function complete(item) {
  reviewed.value = { ...reviewed.value, [item.signature]: Date.now() }
  saveReviewed(st.currentEvent?.id, [item.signature])
  notify.success('已标为核对完成', '该版本记录不会再提示；再次修改后会重新进入队列。')
}

function resetReviewed() {
  reviewed.value = {}
  clearReviewed(st.currentEvent?.id)
}
</script>
