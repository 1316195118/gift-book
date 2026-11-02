# Gift Book deployment checklist

This project has two live deployments with **different roles**:

- **PVE = 测试环境**：只保留一个入口（`10.10.10.251:18099`），先在 PVE 上更新并自测。
- **NAS = 用户实际使用环境**：只有在 PVE 上确认没问题、并得到用户明确确认后，才更新 NAS。

发布顺序固定为：**先 PVE →（用户确认）→ 再 NAS**。不要跳过 PVE，也不要未经确认就动 NAS。

## Theme rule

- Red (`theme-festive`) and white (`theme-solemn`) share the same HTML, JavaScript, and API. Functional changes must apply to both themes.
- Only visual styling may differ. Keep theme-specific rules in CSS; do not fork business logic by theme.

## PVE

- Host: `10.10.10.252`
- LXC: `CT100 docker-LXC`, address `10.10.10.251`
- **唯一测试实例**：container `ugreen-test`，端口 `18099`（`http://10.10.10.251:18099/`）
- 网页目录：`/opt/gift-book/www`（bind mount 到容器 `/var/www/html`，解压发布包即生效）
- 数据 / 配置：`/opt/ugreen-test-data`、`/opt/ugreen-test-config`（独立于 NAS，可随意造测试数据）
- 容器使用镜像 `1316195118/gift-book:latest`，`--restart unless-stopped`
- 旧的 `gift-book`(8099) 与 `gift-book-review`(18100) 已删除，对应 compose 改名为 `*.disabled`，不要恢复
- 更新方式：把发布包解压到 `/opt/gift-book`（会覆盖 `www/`），等 1~2 秒后访问 `18099`
- 若改动涉及 PHP 扩展 / ini / Dockerfile，才需要重建镜像并 `docker rm -f ugreen-test` 后用同样参数重建容器
- 更新前如需保留测试数据，先备份 `/opt/ugreen-test-data`

## NAS

- Host: `10.10.10.253`, Gift Book port `8099`
- SSH admin user: `test` (sudo required); never store its password in the repository.
- Webroot bind mount: `/volume1/docker/gift-book/www`
- Data/config: `/volume1/docker/gift-book/data` and `/volume1/docker/gift-book/config`
- Compose file: `/volume1/Compose/gift-book/docker-compose.yaml`
- SMB path for static-only updates: `\\10.10.10.253\docker\gift-book\www` (back up the `www` directory first; SSH may not always be enabled).
- For functional/PHP changes, update both the bind-mounted `www/` files and the Docker image; rebuilding only the image is not enough, and updating only `www/` leaves the old PHP limits in place. For CSS/HTML-only releases, updating `www/` is sufficient once the image already has the current PHP hardening.
- **只有在 PVE 18099 上验证通过、且用户确认后**才同步 NAS。
- NAS 是用户的真实数据环境，更新前必须备份 `www`；不要在上面做写入型测试。

## Verification

- Confirm `/build.json` matches the new build.
- Confirm the container is healthy and the page shows the expected version.
- The events list endpoint intentionally omits `passwordHash`; fetch a single event with `events.php?id=...` when checking whether a ledger is password-protected.
- Exercise a temporary ledger in the preview/test deployment; delete it afterwards.
- On production, prefer read-only checks plus invalid-request checks that do not write data.

Never store deployment passwords or tokens in this repository.
