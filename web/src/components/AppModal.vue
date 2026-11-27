<template>
  <Transition name="gb-modal">
  <div v-if="modal.open" ref="rootEl" id="modal-container" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click="onBackdropClick">
    <div
      id="modal"
      class="modal-card"
      :class="{ 'modal-large': modal.size === 'large', 'modal-unlock': modal.size === 'unlock', 'theme-solemn': modal.theme === 'theme-solemn', 'theme-festive': modal.theme === 'theme-festive', 'theme-custom': modal.theme === 'theme-custom' }"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="modal.title ? 'modal-title' : undefined"
      tabindex="-1"
    >
      <div class="modal-head" :class="{ 'is-titleless': !modal.title }">
        <h3 id="modal-title" class="modal-title">{{ modal.title }}</h3>
        <button type="button" id="modal-close" class="modal-close" title="关闭" aria-label="关闭弹窗" @click="closeModal()">×</button>
      </div>
      <div id="modal-content" class="modal-content">
        <component :is="view" v-if="modal.body" :content="modal.body" />
      </div>
      <div id="modal-actions" class="modal-actions">
        <button v-for="(action, index) in modal.actions" :key="index" type="button" :class="action.class || 'modal-btn-ghost'" @click="runAction(action)">
          {{ action.text }}
        </button>
      </div>
    </div>
  </div>
  </Transition>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { modal, closeModal, runModalAction } from '../lib/modal.js'
import ModalContent from './ModalContent.vue'

const view = ModalContent
const rootEl = ref(null)
let lastFocused = null
let overflowTimer = 0

// 锁定背景滚动时补上滚动条宽度，避免页面内容在「有/无滚动条」之间左右跳。
// html 已声明 scrollbar-gutter: stable，锁定滚动不会再改变页面宽度；
// 这里若再补一次 padding，反而会把整页左移 15px（按钮边框闪一下就是这个原因）。
// 只有不支持 scrollbar-gutter 的浏览器才做宽度补偿。
const supportsGutter = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('scrollbar-gutter', 'stable')

function lockBodyScroll() {
  document.body.style.overflow = 'hidden'
  if (supportsGutter) return
  const pad = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
  if (pad > 0) document.body.style.paddingRight = `${pad}px`
}

function unlockBodyScroll() {
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
}

function onBackdropClick(event) {
  // 只有允许关闭的弹窗（提示/确认）点遮罩才关闭；密码、表单类防误触。
  if (modal.dismissable && event.target === rootEl.value) closeModal()
}

async function runAction(action) {
  try {
    await runModalAction(action)
  } catch (error) {
    console.error('弹窗动作执行失败', error)
  }
}

function focusables() {
  const root = rootEl.value
  if (!root) return []
  return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.getClientRects().length)
}

function onKeydown(event) {
  if (!modal.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModal()
    return
  }
  if (event.key !== 'Tab') return
  const list = focusables()
  if (!list.length) return
  const first = list[0]
  const last = list[list.length - 1]
  // 打开时未自动聚焦（避免 a11y 树计算卡顿）：第一次 Tab 直接送进弹窗。
  if (!rootEl.value?.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === rootEl.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => modal.open,
  async (open) => {
    clearTimeout(overflowTimer)
    if (open) {
      lockBodyScroll()
      lastFocused = document.activeElement
      await nextTick()
      // 打开瞬间不聚焦：focus 会触发整棵弹窗的无障碍树计算，实测让
      // 「点击 → 弹窗出现」多花约 250ms。改到空闲时执行；若用户已经点进弹窗则不抢焦点。
      const target = rootEl.value?.querySelector('#modal-close') || rootEl.value?.querySelector('#modal')
      if (target) {
        const idle = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 280))
        idle(() => {
          if (!modal.open || !target.isConnected) return
          const active = document.activeElement
          if (active && active !== document.body && rootEl.value?.contains(active)) return
          target.focus({ preventScroll: true })
        }, { timeout: 900 })
      }
    } else {
      // 等退场动画结束再恢复滚动，避免关闭瞬间页面回弹跳动。
      overflowTimer = window.setTimeout(unlockBodyScroll, 220)
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus({ preventScroll: true })
      lastFocused = null
    }
  },
)

// 监听常驻（onKeydown 内部第一句就判断 modal.open），避免绑定时机晚于
// 用户按键、以及 async watch 交错时监听器残留。
onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
})
</script>
