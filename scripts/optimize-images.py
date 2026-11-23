#!/usr/bin/env python3
"""批量把静态目录中的大位图压缩为 WebP。

默认只生成本地字符图片；favicon、PWA 图标和社交分享图必须保留原始格式，
避免破坏浏览器安装、iOS 主屏和社交平台兼容性。
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps

SUPPORTED = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
PROTECTED = {
    "favicon.ico",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "og-cover.png",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="批量压缩静态图片并生成 WebP")
    parser.add_argument("roots", nargs="*", default=["web/public", "web/src"], help="要扫描的目录")
    parser.add_argument("--min-kb", type=int, default=200, help="只处理大于此体积的图片")
    parser.add_argument("--max-width", type=int, default=1920, help="最大输出宽度")
    parser.add_argument("--quality", type=int, default=82, help="WebP 质量，建议 76-86")
    parser.add_argument("--dry-run", action="store_true", help="只列出候选，不写文件")
    return parser.parse_args()


def targets(roots: list[str]) -> list[Path]:
    found: set[Path] = set()
    for raw in roots:
        root = Path(raw).resolve()
        if root.is_file() and root.suffix.lower() in SUPPORTED:
            found.add(root)
        elif root.is_dir():
            found.update(path.resolve() for path in root.rglob("*") if path.suffix.lower() in SUPPORTED)
    return sorted(found)


def main() -> int:
    args = parse_args()
    minimum = args.min_kb * 1024
    converted = 0
    skipped = 0
    saved = 0

    for source in targets(args.roots):
        size = source.stat().st_size
        if source.name in PROTECTED or size < minimum:
            skipped += 1
            continue
        output = source.with_suffix(".webp")
        print(f"{source}: {size / 1024:.1f} KB -> {output}")
        if args.dry_run:
            continue
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened)
            if image.width > args.max_width:
                height = round(image.height * args.max_width / image.width)
                image = image.resize((args.max_width, height), Image.Resampling.LANCZOS)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            image.save(output, "WEBP", quality=args.quality, method=6)
        new_size = output.stat().st_size
        converted += 1
        saved += max(0, size - new_size)
        print(f"  saved {max(0, size - new_size) / 1024:.1f} KB")

    print(
        f"完成：转换 {converted} 张，跳过 {skipped} 张，"
        f"累计减少 {saved / 1024:.1f} KB。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
