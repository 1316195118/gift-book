<template>
  <div v-if="content.type === 'unlock'" class="unlock-card">
    <button type="button" class="unlock-close" aria-label="关闭" @click="closeModal()">×</button>
    <div class="unlock-seal" aria-hidden="true">礼</div>
    <h3 class="unlock-title">进入账簿</h3>
    <p class="unlock-sub">请输入「{{ content.eventName }}」的管理密码</p>
    <form @submit.prevent="submit">
      <input v-model="password" type="password" placeholder="管理密码" autocomplete="current-password" required />
      <div v-if="error" class="unlock-error" role="alert">{{ error }}</div>
      <button type="submit" class="unlock-submit" :disabled="busy">{{ busy ? '正在验证…' : '进入账簿' }}</button>
    </form>
    <p class="unlock-note">管理密码用于解密本账簿数据，忘记将无法恢复</p>
  </div>

  <div v-else-if="content.type === 'export'" class="unlock-card export-card">
    <button type="button" class="unlock-close" aria-label="关闭" @click="closeModal()">×</button>
    <div class="unlock-seal" aria-hidden="true">导</div>
    <h3 class="unlock-title">导出 / 导入账簿</h3>
    <p class="unlock-sub">「{{ content.eventName }}」共 {{ content.count }} 条{{ content.recordsLabel }}</p>
    <div class="gb-scope-bar">
      <div><b>导出范围</b><span>{{ content.scopeLabel }}</span></div>
      <span>
        <button v-if="content.scopeActive" type="button" class="gb-inline-btn" @click="pick('scopeAll')">恢复整本</button>
        <button type="button" class="gb-inline-btn" @click="pick('scope')">选择记录</button>
      </span>
    </div>
    <div class="export-options">
      <button type="button" class="export-option" @click="pick('excel')">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5v10M15 9.5v10"/></svg></span>
        <span class="export-text"><b>Excel 表格</b><small>.xlsx 明细表</small></span>
      </button>
      <button type="button" class="export-option" @click="pick('pdf')">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 13h6M9 16.5h4"/></svg></span>
        <span class="export-text"><b>PDF {{ content.bookTitle }}</b><small>含封面与竖排版式</small></span>
      </button>
      <button type="button" class="export-option" @click="pick('word')">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4h14v16H5z"/><path d="M8 8l1.6 8 1.4-5 1.4 5L14 8"/></svg></span>
        <span class="export-text"><b>Word 文档</b><small>明细 + 备注 + 修改记录</small></span>
      </button>
      <button v-if="content.returnEnabled" type="button" class="export-option" @click="pick('returns')">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 9h11a4 4 0 0 1 0 8H9"/><path d="m8 6 3 3-3 3"/></svg></span>
        <span class="export-text"><b>回礼明细</b><small>已回礼的人与金额</small></span>
      </button>
      <button v-if="content.returnEnabled" type="button" class="export-option" @click="pick('pending')">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16M4 12h10M4 18h10"/><path d="m16 16 2 2 3-4"/></svg></span>
        <span class="export-text"><b>未回礼名单</b><small>勾选后批量登记回礼</small></span>
      </button>
      <button type="button" class="export-option" @click="pick('import')">
        <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v11"/><path d="m7 9 5 5 5-5"/><path d="M5 20h14"/></svg></span>
        <span class="export-text"><b>批量导入 CSV</b><small>从名单批量录入</small></span>
      </button>
    </div>
    <p class="unlock-note">Excel / PDF / Word 都直接下载。PDF 为 A4 横向、含封面与竖排版式；Word 为 A4 纵向，含明细、备注汇总与修改记录。点「选择记录」可先{{ content.returnEnabled ? '按姓名、关系或回礼状态' : '按姓名、关系' }}筛出要导出的记录，{{ content.returnEnabled ? '四种' : '三种' }}导出都按这个范围计算合计。<template v-if="content.returnEnabled">「回礼明细」只列已登记回礼的人；「未回礼名单」可一次给多人登记回礼。</template></p>
  </div>

  <div v-else-if="content.type === 'html'" v-html="content.html"></div>

  <component :is="content.component" v-else-if="content.type === 'component' && content.component" v-bind="content.props || {}" />
</template>

<script setup>
import { ref } from 'vue'
import { closeModal } from '../lib/modal.js'

const props = defineProps({
  content: { type: Object, required: true },
})

const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const check = props.content.verifier ? await props.content.verifier(password.value) : { ok: true }
    if (check.ok) {
      closeModal()
      props.content.onSuccess?.(password.value)
    } else {
      error.value = check.message || '密码不正确，请重试'
    }
  } catch {
    error.value = '无法连接服务器，请检查网络后重试'
  } finally {
    busy.value = false
  }
}

function pick(format) {
  closeModal()
  setTimeout(() => props.content.onPick?.(format), 80)
}
</script>
