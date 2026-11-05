// 全局样式：一套设计令牌 + 基础层 + 组件层 + 页面层 + 封面 + 打印。
// 顺序即层叠顺序，后面的文件只做加法，不再互相覆盖。
import './styles/tokens.css'
import './styles/base.css'
import './styles/atmosphere.css'
import './styles/utilities.css'
import './styles/components.css'
import './styles/screens.css'
import './styles/cover.css'
import './styles/ocr.css'
import './styles/print.css'

import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
