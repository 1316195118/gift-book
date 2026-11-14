// 动态 import 的统一兜底。
// 部署新版本后，已打开的旧页面引用的 chunk 文件名 hash 已变、旧文件被删，
// 再 import 就会 404。若不 catch，表现就是「点了没反应」——必须显式提示刷新。
import { notify } from './notify.js'

export function safeImport(loader, label = '内容') {
  return Promise.resolve()
    .then(loader)
    .catch(() => {
      notify.warn(`${label}加载失败`, '页面可能已更新，请刷新后重试（Ctrl+F5）', { duration: 9000 })
      return null
    })
}
