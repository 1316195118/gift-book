// 结簿归档：账簿级只读状态。服务端在礼金写接口还有一层兜底，这里负责界面与入口。
import { state as st } from '../store.js'
import { alert as showAlert } from './modal.js'

export function isArchived() {
  return st.currentEvent?.archived === true
}

// 所有写操作前先过这一关；返回 false 表示已给出提示、调用方应直接停止。
export function ensureWritable() {
  if (!isArchived()) return true
  showAlert('账簿已结簿', '这本账簿已结簿并设为只读。需要继续录入或修改，请先到「设置 → 结簿归档」解除结簿。')
  return false
}
