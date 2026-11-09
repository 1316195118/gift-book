<template>
  <div id="app-shell">
    <AuthGate v-if="st.authGate" @submitted="onAuthSuccess" />
    <HomeScreen v-if="st.route === 'home'" />
    <TemplateScreen v-else-if="st.route === 'template'" />
    <SetupScreen v-else-if="st.route === 'setup'" />
    <MainScreen v-else-if="st.route === 'main'" />
    <AppModal />
    <OfflineToast />
    <QrFloat />
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { state as st, setBodyTheme } from './store.js'
import { eventTheme } from './lib/content.js'
import AuthGate from './components/AuthGate.vue'
import HomeScreen from './views/HomeScreen.vue'
import TemplateScreen from './views/TemplateScreen.vue'
import SetupScreen from './views/SetupScreen.vue'
import MainScreen from './views/MainScreen.vue'
import AppModal from './components/AppModal.vue'
import OfflineToast from './components/OfflineToast.vue'
import QrFloat from './components/QrFloat.vue'
import { bootstrap } from './bootstrap.js'

// 主题跟着「当前这本账簿」走：进入白事账簿就是素色，回到首页回到所选分类。
watch(
  () => [st.route, st.currentEvent?.id, st.currentEvent?.theme, st.homeCategory],
  () => {
    if (st.route === 'main' && st.currentEvent) setBodyTheme(eventTheme(st.currentEvent, st.homeCategory))
    else setBodyTheme(st.homeCategory === 'white' ? 'theme-solemn' : 'theme-festive')
  },
  { immediate: true },
)

onMounted(() => {
  bootstrap()
  window.__giftbookOnAuthSuccess = () => bootstrap({ skipAuth: true })
})

const onAuthSuccess = () => {
  st.authGate = false
  bootstrap({ skipAuth: true })
}
</script>
