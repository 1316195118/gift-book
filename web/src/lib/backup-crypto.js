// 加密备份的前端小工具：口令只在弹窗里出现一次，提交后立即丢弃，不写 localStorage。
import { openModal, closeModal } from './modal.js'
import { safeFileName } from './crypto.js'

export const isEncryptedName = (name) => /\.gbenc$/i.test(String(name || ''))

export function askBackupPassword() {
  return new Promise((resolve) => {
    const html = `
      <div class="gb-backup-pwd">
        <p class="gb-picker-intro">备份文件会用这个口令加密。忘记口令就无法恢复，请记在安全的地方。</p>
        <div class="field"><label class="field-label" for="gb-enc-pwd">口令（至少 8 位）</label><input id="gb-enc-pwd" type="password" autocomplete="new-password" /></div>
        <div class="field"><label class="field-label" for="gb-enc-pwd2">再输入一次</label><input id="gb-enc-pwd2" type="password" autocomplete="new-password" /></div>
        <div id="gb-enc-error" class="gb-inline-error" role="alert"></div>
      </div>`
    openModal('加密备份', { type: 'html', html }, [
      { text: '取消', class: 'modal-btn-ghost', handler: () => resolve('') },
      {
        text: '生成备份',
        class: 'modal-btn-primary',
        keepOpen: true,
        handler: () => {
          const first = document.getElementById('gb-enc-pwd')?.value || ''
          const second = document.getElementById('gb-enc-pwd2')?.value || ''
          const box = document.getElementById('gb-enc-error')
          if (first.length < 8) {
            if (box) box.textContent = '口令至少 8 位'
            return
          }
          if (first !== second) {
            if (box) box.textContent = '两次输入的口令不一致'
            return
          }
          closeModal()
          resolve(first)
        },
      },
    ], { dismissable: true })
  })
}

// 还原加密包时只问一次口令，不要求二次输入。
export function askBackupUnlock() {
  return new Promise((resolve) => {
    const html = `
      <div class="gb-backup-pwd">
        <p class="gb-picker-intro">这个备份包已加密，请输入导出时设置的口令。</p>
        <div class="field"><label class="field-label" for="gb-unlock-pwd">备份口令</label><input id="gb-unlock-pwd" type="password" autocomplete="current-password" /></div>
        <div id="gb-unlock-error" class="gb-inline-error" role="alert"></div>
      </div>`
    openModal('解锁备份', { type: 'html', html }, [
      { text: '取消', class: 'modal-btn-ghost', handler: () => resolve('') },
      {
        text: '继续',
        class: 'modal-btn-primary',
        keepOpen: true,
        handler: () => {
          const pwd = document.getElementById('gb-unlock-pwd')?.value || ''
          if (!pwd) {
            const box = document.getElementById('gb-unlock-error')
            if (box) box.textContent = '请输入口令'
            return
          }
          closeModal()
          resolve(pwd)
        },
      },
    ], { dismissable: true })
  })
}

export async function downloadEncryptedBackup(url, password, baseName) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload.message || '生成加密备份失败')
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = safeFileName(baseName) + '.gbenc'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
}
