<template>
  <div id="modal-container" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" :class="{ hidden: !modal.open }">
    <div
      id="modal"
      class="modal-card"
      :class="{ 'modal-large': modal.size === 'large', 'modal-unlock': modal.size === 'unlock', 'theme-solemn': modal.theme === 'theme-solemn', 'theme-festive': modal.theme === 'theme-festive' }"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="modal.title ? 'modal-title' : undefined"
      tabindex="-1"
    >
      <div class="modal-head">
        <h3 id="modal-title" class="modal-title">{{ modal.title }}</h3>
        <button type="button" id="modal-close" class="modal-close" title="关闭" aria-label="关闭弹窗" @click="closeModal">×</button>
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
</template>

<script setup>
import { watch } from 'vue'
import { modal, closeModal } from '../lib/modal.js'
import ModalContent from './ModalContent.vue'

const view = ModalContent

async function runAction(action) {
  const keepOpen = action.keepOpen
  if (action.handler) await action.handler()
  if (!keepOpen) closeModal()
}

watch(
  () => modal.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
)
</script>
