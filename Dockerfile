# syntax=docker/dockerfile:1

# ---------- 1. 编译 Go 二进制 ----------
# 前端 ui/ 为自研原生 JS/CSS（零第三方依赖），通过 //go:embed all:ui 直接嵌入，
# 无需 Node / npm / Vite 构建阶段。
FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY embed.go ./
COPY ui/ ./ui/
RUN printf '{"build":"docker","version":"2.0.0"}\n' > ui/build.json \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/giftbook ./cmd/giftbook

# ---------- 2. 运行镜像 ----------
FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=Asia/Shanghai
COPY --from=builder /out/giftbook /usr/local/bin/giftbook
RUN mkdir -p /data /config
VOLUME ["/data", "/config"]
EXPOSE 8099
ENTRYPOINT ["/usr/local/bin/giftbook"]
CMD ["-addr", "0.0.0.0", "-port", "8099", "-data", "/data", "-config", "/config"]
