// 首页回收站：把 data/.trash 里删除账簿留下的快照列出来，支持一键恢复。
// 只恢复「单本账簿」快照；整站导入快照涉及覆盖现有数据，仍由首页「备份」流程处理。
import { api } from './api.js'
import { openModal, closeModal, afterModalRender, alert as showAlert, confirm } from './modal.js'
import { escapeHtml } from './crypto.js'
import { notify } from './notify.js'
import { loadEvents } from '../bootstrap.js'

function displayTime(raw) {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(raw || '')
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : raw || '—'
}

export async function showTrashModal() {
  let items = []
  try {
    const result = await api.listTrash()
    items = Array.isArray(result.data) ? result.data : []
  } catch (error) {
    return showAlert('回收站', `读取失败：${error.message || '请稍后重试'}`)
  }

  const list = items.length
    ? items
        .map((item) => `
          <div class="gb-trash-item">
            <div class="gb-trash-main">
              <b>${escapeHtml(item.eventName || '未命名账簿')}</b>
              <span>${escapeHtml(displayTime(item.deletedAt))} · ${item.kind === 'event' ? `${item.giftCount} 条记录` : `${item.giftCount} 本账簿`}${item.restored ? ' · 已恢复过' : ''}</span>
            </div>
            ${item.kind === 'event'
              ? `<button type="button" class="gb-link-btn" data-trash-restore="${escapeHtml(item.name)}">${item.restored ? '再次恢复' : '恢复'}</button>`
              : '<span class="gb-trash-note">整站快照 · 请到首页「备份」按需恢复</span>'}
          </div>`)
        .join('')
    : '<div class="gb-empty">回收站是空的。删除账簿后，这里会出现可恢复的快照。</div>'

  const html = `
    <div id="gb-trash-list" class="gb-trash-list">
      <p class="gb-picker-intro">删除账簿时，服务器会在数据目录保留一份快照。这里可以恢复单本账簿；恢复不会覆盖现有账簿，快照本身也会保留。</p>
      ${list}
      <p class="gb-picker-hint">恢复后请用原来的管理密码打开账簿。整站快照（导入备份前的旧数据）涉及覆盖现有账簿，不提供一键恢复。</p>
    </div>`

  openModal('回收站', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }], { size: 'large', dismissable: true })

  afterModalRender(() => {
    const root = document.getElementById('gb-trash-list')
    root?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-trash-restore]')
      if (!button) return
      const name = button.dataset.trashRestore
      const item = items.find((entry) => entry.name === name)
      if (!item) return
      confirm(
        '恢复账簿',
        `将把「${item.eventName || '这本账簿'}」及其 ${item.giftCount} 条记录恢复到首页账簿列表；现有账簿不会被覆盖。`,
        async () => {
          try {
            await api.restoreTrash(name)
            closeModal()
            await loadEvents()
            notify.success('账簿已恢复', `「${item.eventName || '这本账簿'}」已回到首页，可用原来的管理密码打开。`, { duration: 5000 })
          } catch (error) {
            notify.warn('恢复失败', error.message || '请稍后重试。', { duration: 5000 })
          }
        },
      )
    })
  })
}
