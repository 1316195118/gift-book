<template>
  <div id="app-shell">
    <PolicyScreen v-if="publicPolicy" :kind="publicPolicy" />
    <template v-else>
      <ActivityBar />
      <GuestScreen v-if="st.guestToken" />
      <template v-else>
        <FamilyGate v-if="st.familyGate" />
        <AuthGate v-if="st.authGate" :mode="st.authGateMode" @submitted="onAuthSuccess" @cancel="st.authGate = false" />
        <component :is="currentView" :key="st.route" />
        <AppModal />
        <OfflineToast />
        <QrFloat />
        <ToastStack />
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, watch } from 'vue'
import { state as st, setBodyTheme } from './store.js'
import { eventTheme, themeForCategory } from './lib/content.js'
import ActivityBar from './components/ActivityBar.vue'
import AuthGate from './components/AuthGate.vue'
import FamilyGate from './components/FamilyGate.vue'
import HomeScreen from './views/HomeScreen.vue'
import AppModal from './components/AppModal.vue'
import OfflineToast from './components/OfflineToast.vue'
import QrFloat from './components/QrFloat.vue'
import ToastStack from './components/ToastStack.vue'
import ViewLoading from './components/ViewLoading.vue'
import { bootstrap } from './bootstrap.js'
import { showTemplates, showHelpDialog } from './lib/actions.js'
import { showHomeSettings } from './lib/home-settings.js'
import { applyPageMeta } from './lib/page-meta.js'
import { loadMainView } from './lib/view-loader.js'

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
const publicPolicy = normalizedPath === '/privacy' || normalizedPath === '/terms'
  ? normalizedPath.slice(1)
  : ''

const viewLoaders = {
  guest: () => import('./views/GuestScreen.vue'),
  template: () => import('./views/TemplateScreen.vue'),
  setup: () => import('./views/SetupScreen.vue'),
  main: loadMainView,
}

function asyncView(loader) {
  return defineAsyncComponent({
    loader,
    delay: 160,
    timeout: 15000,
    loadingComponent: ViewLoading,
    errorComponent: ViewLoading,
  })
}

const GuestScreen = asyncView(viewLoaders.guest)
const TemplateScreen = asyncView(viewLoaders.template)
const SetupScreen = asyncView(viewLoaders.setup)
const MainScreen = asyncView(viewLoaders.main)
const PolicyScreen = asyncView(() => import('./views/PolicyScreen.vue'))

const currentView = computed(() => (
  st.guestToken ? GuestScreen : ({
    home: HomeScreen,
    template: TemplateScreen,
    setup: SetupScreen,
    main: MainScreen,
  }[st.route] || HomeScreen)
))

watch(
  () => publicPolicy || (st.guestToken ? 'guest' : st.route),
  (route) => applyPageMeta(route),
  { immediate: true },
)

// 主题跟着「当前这本账簿」走：进入白事账簿就是素色，回到首页回到所选分类。
watch(
  () => [st.route, st.currentEvent?.id, st.currentEvent?.theme, st.homeCategory],
  () => {
    if (st.route === 'main' && st.currentEvent) setBodyTheme(eventTheme(st.currentEvent, st.homeCategory))
    else setBodyTheme(themeForCategory(st.homeCategory))
  },
  { immediate: true },
)

onMounted(() => {
  if (publicPolicy) return
  // 宾客扫码链接是公开页：不带家庭会话、不加载账簿列表，只看这一本的名字。
  const giftToken = new URLSearchParams(window.location.search).get('gift')
  if (giftToken) {
    st.guestToken = giftToken
    return
  }
  bootstrap().then(runInitialAction)
  window.__giftbookOnAuthSuccess = () => bootstrap({ skipAuth: true })
  scheduleViewPrefetch()
})

function runInitialAction() {
  const action = new URLSearchParams(window.location.search).get('action')
  if (!['create', 'help', 'settings'].includes(action)) return
  if (action === 'create') showTemplates(st.homeCategory)
  if (action === 'help') showHelpDialog()
  if (action === 'settings') showHomeSettings()
  window.history.replaceState(null, '', '/')
}

let prefetchStarted = false
function scheduleViewPrefetch() {
  if (prefetchStarted) return
  prefetchStarted = true
  const connection = navigator.connection
  const slowNetwork = connection?.saveData ||
    /(^|-)[23]g$/.test(String(connection?.effectiveType || '')) ||
    (Number.isFinite(connection?.downlink) && connection.downlink < 2)
  if (slowNetwork) return
  const prefetch = (loaders) => {
    const run = () => loaders.forEach((loader) => loader().catch(() => {}))
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2600 })
    else window.setTimeout(run, 700)
  }
  // 先让首页数据和首屏绘制稳定，再分两批预取。主账簿代码较大，最后加载。
  window.setTimeout(() => {
    prefetch([viewLoaders.template, viewLoaders.setup, viewLoaders.guest])
    window.setTimeout(() => prefetch([viewLoaders.main]), 900)
  }, 900)
}

const onAuthSuccess = () => {
  st.authGate = false
  // 管理员登录后整页重载：家庭门要重新拉取「全部家庭」列表，普通家庭状态也一起刷新。
  location.reload()
}
</script>
