# Gift Book 发布规则

## 推送即完成发布

当用户要求“推送”或“发布”时，除提交并推送代码外，还必须完成可被网页更新检查发现的正式发布：

1. 运行相关测试、并发压力测试、前端测试和生产构建。
2. 更新项目版本号及其所有引用。
3. 推送 `main`。
4. 创建与项目版本一致的 `vX.Y.Z` 标签并推送，触发 Release image 工作流。
5. 等待 GitHub Actions 全部通过。
6. 验证 GHCR 的 `latest` 是多架构镜像，并包含对应版本的 `update-vX.Y.Z-amd64` / `update-vX.Y.Z-arm64` 自更新包。
7. 确认网页更新检查能够发现新版本后才向用户报告发布完成。

只推送 `main` 不算发布；发布工作流只在推送 `v*` 标签时运行。

## 部署约束

- 用户部署入口始终只有 `ghcr.io/1316195118/gift-book:latest`。
- `update-vX.Y.Z-<arch>` 仅供容器内自更新，不是用户部署标签。
- Docker Compose 的 `environment` 只保留 `TZ=Asia/Shanghai`；更新代理通过网页配置。
- 不在仓库、日志或提交中写入 NAS、PVE 或其他设备的密码。
