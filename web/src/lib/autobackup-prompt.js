// 首次建账后的自动备份提示：只提示一次，可一键开启（每天一次、保留 7 份）。
// 数据只在本机，硬盘故障/误删时自动备份是最后一道保险。
import { api } from './api.js'
import { openModal } from './modal.js'
import { notify } from './notify.js'

const PROMPT_KEY = 'giftbook-backup-prompted'
const DEFAULT_INTERVAL_HOURS = 24
const DEFAULT_KEEP = 7

export async function maybePromptAutoBackup() {
  try {
    if (localStorage.getItem(PROMPT_KEY)) return
    const res = await api.autobackupGet()
    const cfg = res?.data || {}
    // 已开启就不再打扰，同时记下标记。
    localStorage.setItem(PROMPT_KEY, '1')
    if (cfg.enabled) return

    const intervalHours = Number(cfg.intervalHours) || DEFAULT_INTERVAL_HOURS
    const keep = Number(cfg.keep) || DEFAULT_KEEP

    openModal(
      '要不要开启自动备份？',
      {
        type: 'html',
        html: `<div class="text-sm text-gray-700 space-y-2">
          <p>账簿只保存在这台机器上。硬盘损坏或误删时，<b>自动备份是最后一道保险</b>。</p>
          <p>建议每 ${intervalHours} 小时备份一次、保留最近 ${keep} 份；可随时在「设置 → 自动备份」调整或关闭。</p>
        </div>`,
      },
      [
        { text: '暂不开启', class: 'modal-btn-ghost' },
        {
          text: '开启自动备份',
          class: 'modal-btn-primary',
          handler: async () => {
            try {
              await api.autobackupSave({ enabled: true, intervalHours, keep })
              notify.success('自动备份已开启', `每 ${intervalHours} 小时备份一次，保留 ${keep} 份`)
            } catch (error) {
              notify.warn('开启失败', error?.message || '请稍后在「设置 → 自动备份」手动开启')
            }
          },
        },
      ],
      { dismissable: true },
    )
  } catch {
    /* 提示失败不影响建账流程 */
  }
}
