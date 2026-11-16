<template>
  <div class="gb-about">
    <div class="gb-about-version">
      <b>电子礼簿 v{{ st.version || '—' }}</b>
      <span>构建 {{ st.build || '—' }}</span>
    </div>
    <div class="gb-about-list">
      <button type="button" class="gb-settings-item" @click="network">
        <b>网络与存储</b>
        <small>{{ net.health.text }} · 查看连接与写入状态</small>
      </button>
      <button type="button" class="gb-settings-item" id="about-large-text" @click="toggleLargeText">
        <b>文字大小</b>
        <small>{{ st.largeText ? '当前为大字，点击恢复标准字号' : '当前为标准字号，点击切换为大字' }}</small>
      </button>
      <button type="button" class="gb-settings-item" @click="toggleSound">
        <b>提示音</b>
        <small>{{ soundOn ? '已开启，录入成功会提示' : '已静音' }}</small>
      </button>
      <button type="button" class="gb-settings-item" @click="changelog">
        <b>更新说明</b>
        <small>查看每个版本新增与修复了什么</small>
      </button>
      <button type="button" class="gb-settings-item" @click="license">
        <b>开源许可</b>
        <small>MIT License 与第三方组件说明</small>
      </button>
    </div>
    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="closeModal">关闭</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { state as st } from '../store.js'
import { closeModal } from '../lib/modal.js'
import { showNetworkDetails, showChangelog, showLicense, toggleLargeText } from '../lib/actions.js'
import { netState as net } from '../lib/network.js'
import { soundEnabled, setSoundEnabled } from '../lib/prefs.js'
import { playTap } from '../lib/sound.js'

const soundOn = ref(soundEnabled())

function network() {
  closeModal()
  showNetworkDetails()
}

function changelog() {
  closeModal()
  showChangelog()
}

function license() {
  closeModal()
  showLicense()
}

function toggleSound() {
  const next = !soundOn.value
  setSoundEnabled(next)
  soundOn.value = soundEnabled()
  if (next) playTap()
}
</script>
