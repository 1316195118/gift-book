# Gift Book deployment checklist

This project has two live deployments. After any code upload or release, update and verify **both** of them; do not stop after PVE.

## PVE

- Host: `10.10.10.252`
- LXC: `CT100 docker-LXC`, address `10.10.10.251`
- Production: `/opt/gift-book`, container `gift-book`, port `8099`
- Preview: `/opt/gift-book-preview`, container `gift-book-review`, port `18100`
- Build from the checked-out source with:
  `docker compose -f docker-compose.build.yml up -d --build`
- Always back up `/opt/gift-book/data` and `/opt/gift-book/config` before updating production.

## NAS

- Host: `10.10.10.253`, Gift Book port `8099`
- SSH admin user: `test` (sudo required); never store its password in the repository.
- Webroot bind mount: `/volume1/docker/gift-book/www`
- Data/config: `/volume1/docker/gift-book/data` and `/volume1/docker/gift-book/config`
- Compose file: `/volume1/Compose/gift-book/docker-compose.yaml`
- Update both the bind-mounted `www/` files and the Docker image; rebuilding only the image is not enough, and updating only `www/` leaves the old PHP limits in place.
- This is a separate deployment from PVE and must also be updated after a release.

## Verification

- Confirm `/build.json` matches the new build.
- Confirm the container is healthy and the page shows the expected version.
- Exercise a temporary ledger in the preview/test deployment; delete it afterwards.
- On production, prefer read-only checks plus invalid-request checks that do not write data.

Never store deployment passwords or tokens in this repository.
