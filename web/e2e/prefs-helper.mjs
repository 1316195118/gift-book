// E2E 辅助：把家庭偏好里的「当前分类」设为指定值。
// 偏好已改为家庭级服务端存储，单靠 localStorage 预设会被同步覆盖，
// 因此测试需要走真实的服务端偏好接口，再刷新让同步拉取生效。
export async function setFamilyCategory(page, category) {
  await page.evaluate(async (cat) => {
    await fetch('/api/family/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          enabledCategories: ['red', 'white', 'custom'],
          homeCategory: cat,
          largeText: false,
          motion: 'system',
          sound: false,
          voiceRate: 1,
          voiceVolume: 1,
          print: { fontSize: 'normal', margin: 'normal', appendix: true },
        },
      }),
    })
  }, category)
  await page.reload({ waitUntil: 'networkidle' })
}
