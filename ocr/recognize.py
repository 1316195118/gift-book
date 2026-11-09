"""One request per process; no HTTP listener, persistent image files or cloud API."""
import json
import os
import sys
import time
import warnings

os.environ.update(OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1")


def main():
    import numpy as np
    from PIL import Image, ImageOps
    from engine import make_engine
    warnings.simplefilter("error", category=Image.DecompressionBombWarning)
    Image.MAX_IMAGE_PIXELS = 16_000_000
    started = time.monotonic()
    with Image.open(sys.argv[1]) as source:
        if source.format not in ("JPEG", "PNG", "WEBP"):
            raise ValueError("Unsupported image")
        if source.width * source.height > 16_000_000:
            raise ValueError("Image too large")
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((2000, 2000))
        width, height = image.size
        # RapidOCR treats numpy input as OpenCV BGR.
        pixels = np.asarray(image)[:, :, ::-1].copy()
    engine = make_engine()
    output = engine(pixels)
    lines = []
    if output.boxes is not None and output.txts is not None:
        for box, text, score in zip(output.boxes, output.txts, output.scores):
            if len(lines) >= 1200:
                break
            lines.append({
                "text": str(text)[:500],
                "score": round(float(score), 4),
                "box": [[round(float(x), 2), round(float(y), 2)] for x, y in box],
            })
    print(json.dumps({
        "success": True, "data": {
            "lines": lines, "width": width, "height": height,
            "elapsed": round(time.monotonic() - started, 2),
            "engine": "RapidOCR / PP-OCRv5 mobile · CPU · 本地",
        }
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not log names, image bytes, temporary paths or recognition text.
        print(json.dumps({"success": False, "message": "本地识别失败，请缩小图片或重新拍摄后重试。"}))
        sys.exit(1)
