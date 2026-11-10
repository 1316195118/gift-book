"""Single-container, CPU-only OCR. Models are fetched at image BUILD time only."""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
MANIFEST = MODEL_DIR / "manifest.json"


def parameters():
    from rapidocr import ModelType, OCRVersion
    return {
        "Global.model_root_dir": str(MODEL_DIR),
        "Global.log_level": "critical",
        "Global.text_score": 0.35,
        "Global.max_side_len": 2000,
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_type": ModelType.MOBILE,
        "Det.limit_side_len": 960,
        "Det.limit_type": "max",
        "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_type": ModelType.MOBILE,
        "Rec.rec_batch_num": 1,
        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    }


def make_engine(build=False):
    # Never let a missing model trigger RapidOCR's automatic network download.
    # Explicit paths + blocking download calls also protect an accidentally
    # modified model directory. Fail closed instead of contacting a model host.
    params = parameters()
    if not build:
        manifest = json.loads(MANIFEST.read_text())
        for task in ("Det", "Cls", "Rec"):
            filename = manifest[task]["filename"]
            path = MODEL_DIR / filename
            if path.parent != MODEL_DIR or not path.is_file():
                raise RuntimeError("OCR model missing")
            if hashlib.sha256(path.read_bytes()).hexdigest() != manifest[task]["sha256"]:
                raise RuntimeError("OCR model integrity check failed")
            params[f"{task}.model_path"] = str(path)
        import requests
        def offline(*args, **kwargs):
            raise RuntimeError("Network disabled for local OCR")
        requests.sessions.Session.request = offline
    from rapidocr import RapidOCR
    return RapidOCR(params=params)


def prepare():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    engine = make_engine(build=True)
    # Pinned RapidOCR uses lazy model loading; load all three explicitly now.
    engine._load_det_model()
    engine._load_cls_model()
    engine._load_rec_model()
    manifest = {}
    for task in ("Det", "Cls", "Rec"):
        path = Path(engine.cfg[task].model_path or "")
        if not path.is_file():
            # The resolver may not update cfg.model_path; task_type in the
            # downloaded ONNX filenames is unambiguous.
            candidates = list(MODEL_DIR.glob(f"*_{task.lower()}*.onnx"))
            if len(candidates) != 1:
                raise RuntimeError(f"Cannot identify bundled {task} model")
            path = candidates[0]
        manifest[task] = {
            "filename": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest))


if __name__ == "__main__":
    prepare()
