# syntax=docker/dockerfile:1

# ---------- 1. 构建前端 ----------
FROM node:20-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2. 编译 Go 二进制 ----------
FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY embed.go ./
RUN mkdir -p webapp/dist
COPY --from=web /src/dist/ ./webapp/dist/
RUN printf '{"build":"docker","version":"2.3.10"}\n' > webapp/dist/build.json \
 && touch webapp/dist/.gitkeep \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/giftbook ./cmd/giftbook

# ---------- 3. 运行镜像 ----------
FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=Asia/Shanghai
COPY --from=builder /out/giftbook /usr/local/bin/giftbook
RUN mkdir -p /data /config
VOLUME ["/data", "/config"]
EXPOSE 8099
ENTRYPOINT ["/usr/local/bin/giftbook"]
CMD ["-addr", "0.0.0.0", "-port", "8099", "-data", "/data", "-config", "/config"]
