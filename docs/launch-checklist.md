# 上线体验检查清单

本清单对应 2026-11 的站点体验审查，适用于 `v2.4.53` 及之后的版本。内部局域网 HTTP 与公网 HTTPS 的部署边界分开处理。

## 已实现

- 隐私政策与条款：`/privacy`、`/terms`，首页页脚可进入。
- 敏感信息：`.env*`、私钥已忽略；`npm run security:secrets` 只输出命中位置，不打印密钥。
- 页面图标：`favicon.ico`、SVG、Apple Touch Icon、PWA 192/512/maskable 图标。
- 社交分享：1200×630 PNG/SVG，Open Graph 与 Twitter Card；服务端会按当前主机补绝对 `og:image`。
- 搜索入口：动态 `robots.txt` 与 `sitemap.xml`，可用 `GIFTBOOK_PUBLIC_URL` 固定公网根地址。
- 页面体验：每个核心路由独立标题与描述，未知页面返回真正的 HTTP 404。
- 图片：静态位图扫描/WebP 脚本、`loading="lazy"`、显式宽高与完整 Alt。
- 性能：二维码按需加载、慢网/省流时暂停视图预取、静态资源内存缓存与 gzip。
- 安全：CSP、同源写请求、可选强制 HTTPS 与 HSTS、宾客表单蜜罐和滑动窗口限流。
- 无障碍：主要触控目标至少 44×44px、可见焦点、低动态偏好，以及 AA 级占位符/辅助文字色值。
- 礼簿洞察：异常核对、跨账簿来宾档案、加密操作人、备份健康中心、OCR 低置信度复核与年度人情报告均已接入；分析只使用浏览器已解密数据。

## 人工确认项

以下内容依赖实际运营商和域名，代码无法替代：

- 在条款和隐私页填写真实运营主体、联系邮箱、适用地区与争议管辖地。
- 如果公网访问，配置反向代理证书并设置 `GIFTBOOK_TRUST_PROXY=1`、`GIFTBOOK_FORCE_HTTPS=1`、`GIFTBOOK_PUBLIC_URL=https://你的域名`。
- 微信、社交平台缓存旧分享图时，使用平台调试工具重新抓取或更换查询参数。
- 首次上线后在目标设备上检查打印、导出、OCR 以及宾客扫码完整链路。

## 自动回归

在 `web/` 目录运行：

```powershell
npm test
npm run lint
npm run build
npm run links:check
npm run security:secrets
```

Go 侧运行：

```powershell
go test ./...
```

启动隔离实例后可执行 `node e2e/responsive.mjs`，检查 320/375/390/768/844/1024/1440 像素视口、横向溢出、触控目标和核心记账流程。
