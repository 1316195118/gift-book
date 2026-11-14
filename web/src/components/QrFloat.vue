<template>
  <div id="qr-float" :class="classes" :style="style">
    <div id="qr-float-head" @mousedown.prevent="startDrag" @touchstart.passive="startTouch">
      <span>电子收款码 · 按住拖动</span>
      <div class="qr-float-actions">
        <button type="button" @click="toggleZoom" title="放大">{{ zoomed ? '缩小' : '放大' }}</button>
        <button type="button" @click="toggleCollapse" title="收起">{{ collapsed ? '展开' : '收起' }}</button>
        <button type="button" @click="hide" title="关闭">×</button>
      </div>
    </div>
    <div id="qr-float-body">
      <div class="qr-poster">
        <div class="qr-poster-title">请扫码付款</div>
        <img :src="state.qrImage" alt="收款码" />
        <div class="qr-poster-foot">微信 · 支付宝 · 云闪付</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount } from 'vue'
import { qr } from '../lib/qr.js'

const state = qr

const classes = computed(() => ({
  hidden: !state.visible,
  zoomed: state.zoomed,
  collapsed: state.collapsed,
}))

const style = computed(() => (state.positioned ? { left: `${state.left}px`, top: `${state.top}px` } : {}))

function toggleZoom() {
  state.zoomed = !state.zoomed
}
function toggleCollapse() {
  state.collapsed = !state.collapsed
}
function hide() {
  state.visible = false
}

let dragging = false
let startX = 0
let startY = 0
let originX = 0
let originY = 0
let boxW = 290
let boxH = 320

function startTouch(event) {
  const touch = event.touches[0]
  begin(touch.clientX, touch.clientY)
}

function startDrag(event) {
  begin(event.clientX, event.clientY)
}

function begin(x, y) {
  dragging = true
  const el = document.getElementById('qr-float')
  if (el) {
    boxW = el.offsetWidth || boxW
    boxH = el.offsetHeight || boxH
  }
  startX = x
  startY = y
  originX = state.left
  originY = state.top
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', end)
  window.addEventListener('touchmove', moveTouch, { passive: true })
  window.addEventListener('touchend', end)
}

function moveTouch(event) {
  const touch = event.touches[0]
  move(touch)
}

function move(event) {
  if (!dragging) return
  const maxLeft = Math.max(0, window.innerWidth - boxW)
  const maxTop = Math.max(0, window.innerHeight - boxH)
  state.left = Math.max(0, Math.min(originX + (event.clientX - startX), maxLeft))
  state.top = Math.max(0, Math.min(originY + (event.clientY - startY), maxTop))
}

function end() {
  dragging = false
  window.removeEventListener('mousemove', move)
  window.removeEventListener('mouseup', end)
  window.removeEventListener('touchmove', moveTouch)
  window.removeEventListener('touchend', end)
}

onBeforeUnmount(end)
</script>
