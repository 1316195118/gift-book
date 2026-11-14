import { reactive } from 'vue'

export const qr = reactive({
  visible: false,
  zoomed: false,
  collapsed: false,
  positioned: false,
  left: 0,
  top: 96,
  image: '',
})

export function showQrImage(image) {
  qr.image = image
  if (!qr.positioned) {
    const width = Math.min(290, window.innerWidth - 24)
    qr.left = Math.max(12, window.innerWidth - width - 12)
    qr.top = 96
    qr.positioned = true
  }
  qr.visible = true
  qr.zoomed = false
  qr.collapsed = false
}
