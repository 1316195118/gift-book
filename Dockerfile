# syntax=docker/dockerfile:1

# ---------- 1. 构建前端 ----------
FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2. 编译 Go 二进制 ----------
FROM golang:1.27-alpine AS builder
ARG BUILD_ID=docker
WORKDIR /src
COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY embed.go ./
RUN mkdir -p webapp/dist
COPY --from=web /src/dist/ ./webapp/dist/
RUN printf '{"build":"%s","version":"2.4.69"}\n' "$BUILD_ID" > webapp/dist/build.json \
 && touch webapp/dist/.gitkeep \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/giftbook ./cmd/giftbook

# ---------- 3. 运行镜像 ----------
FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=Asia/Shanghai \
    GIFTBOOK_AUTO_RESTART=true
COPY --from=builder /out/giftbook /usr/local/bin/giftbook
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data /config
VOLUME ["/data", "/config"]
EXPOSE 8099
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["-addr", "0.0.0.0", "-port", "8099", "-data", "/data", "-config", "/config"]
