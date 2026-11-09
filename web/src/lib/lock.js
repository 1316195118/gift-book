// 锁定 / 解锁：锁定时禁用录入与修改，解锁需要该账簿的管理密码。
import { state as st } from '../store.js'
import { readLocked, writeLocked } from './prefs.js'
import { verifyLedgerPassword } from './actions.js'
import { openModal, closeModal, alert as showAlert, afterModalRender } from './modal.js'

export function restoreLocked() {
  if (st.currentEvent) st.locked = readLocked(st.currentEvent.id)
}

export async function toggleLedgerLock() {
  if (!st.locked) {
    st.locked = true
    writeLocked(st.currentEvent.id, true)
    return
  }
  if (!st.currentEvent.hasPassword) {
    st.locked = false
    writeLocked(st.currentEvent.id, false)
    return
  }
  openModal(
    '解锁账簿',
    {
      type: 'html',
      html: '<p class="text-sm text-gray-600 mb-3">请输入管理密码以解锁。</p><input type="password" id="override-password" class="w-full p-2 border rounded themed-ring" placeholder="请输入管理密码" /><div class="access-error hidden mt-2" id="override-error" role="alert"></div>',
    },
    [
      { text: '取消', class: 'themed-button-secondary border px-4 py-2 rounded' },
      {
        text: '确认',
        class: 'themed-button-primary px-4 py-2 rounded',
        keepOpen: true,
        handler: async () => {
          const value = document.getElementById('override-password')?.value || ''
          const error = document.getElementById('override-error')
          const result = await verifyLedgerPassword(st.currentEvent.id, value)
          if (result.ok) {
            st.locked = false
            writeLocked(st.currentEvent.id, false)
            closeModal()
            return
          }
          if (error) {
            error.textContent = result.message || '管理密码不正确'
            error.classList.remove('hidden')
          }
        },
      },
    ],
  )
  afterModalRender(() => document.getElementById('override-password')?.focus())
}

export { showAlert }
