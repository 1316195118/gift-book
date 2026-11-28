<template>
  <div class="gb-category-settings">
    <p class="gb-picker-intro">
      选择首页顶部的分类入口。这些开关只保存在当前设备，不会改动家庭设置、账簿或记录。
    </p>

    <div class="gb-category-list">
      <label
        v-for="option in options"
        :key="option.key"
        class="gb-category-option"
        :class="{ 'is-hidden': !enabled.includes(option.key) }"
        :for="`category-setting-${option.key}`"
      >
        <span class="gb-category-seal" :class="`is-${option.key}`" aria-hidden="true">{{ option.seal }}</span>
        <span class="gb-category-copy">
          <b>{{ option.label }}</b>
          <small>{{ option.description }}</small>
        </span>
        <span class="switch">
          <input
            :id="`category-setting-${option.key}`"
            v-model="enabled"
            type="checkbox"
            :value="option.key"
            :disabled="enabled.length === 1 && enabled.includes(option.key)"
          />
          <span class="switch-track" aria-hidden="true"></span>
        </span>
      </label>
    </div>

    <div class="gb-category-foot">
      <p class="gb-picker-hint">至少保留一个分类；关闭当前分类时，首页会自动切到仍显示的分类。</p>
      <button v-if="enabled.length < options.length" type="button" class="gb-link-btn" @click="showAll">
        全部显示
      </button>
    </div>

    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="closeModal">取消</button>
      <button type="button" class="modal-btn-primary" @click="save">保存</button>
    </div>
  </div>
</template>

<script setup>
import { flushFamilyPrefsSync } from '../lib/family-prefs.js'
import { ref } from 'vue'
import { state as st } from '../store.js'
import { CATEGORY_KEYS, setHomeCategory, saveEnabledCategories } from '../lib/prefs.js'
import { closeModal } from '../lib/modal.js'
import { notify } from '../lib/notify.js'

const options = [
  { key: 'red', label: '红事', seal: '喜', description: '婚礼、寿宴、满月等喜庆礼簿。' },
  { key: 'white', label: '白事', seal: '奠', description: '使用肃穆配色与白事专用措辞。' },
  { key: 'custom', label: '自定义', seal: '记', description: '用于其他事项、活动或通用收款记录。' },
]

const enabled = ref(st.enabledCategories.includes
  ? [...st.enabledCategories]
  : [...CATEGORY_KEYS])

function showAll() {
  enabled.value = [...CATEGORY_KEYS]
}

function save() {
  const next = saveEnabledCategories(enabled.value)
  st.enabledCategories = next
  let switchedTo = ''
  if (!next.includes(st.homeCategory)) {
    switchedTo = next[0]
    setHomeCategory(switchedTo)
    st.homeCategory = switchedTo
  }
  // 立即同步到服务端：用户可能保存后马上刷新，不能等防抖定时器。
  flushFamilyPrefsSync()
  closeModal()
  notify.success(
    '分类显示已保存',
    switchedTo ? `当前分类已切换到「${options.find((item) => item.key === switchedTo)?.label}」。` : `首页显示 ${next.length} 个分类入口。`,
  )
}
</script>
