# -*- coding: utf-8 -*-
"""Sidecar OCR chạy PaddleOCR PP-OCRv5 qua gói rapidocr (ONNX Runtime).

Pipeline cho từng khung hình (được Node gọi qua file job JSON):
  1. Text Detection  — model det PP-OCRv5 mobile tìm hộp chữ trong khung
  2. Crop            — cắt từng hộp chữ bằng phép biến đổi phối cảnh 4 điểm
  3. Enhance         — upscale chữ nhỏ, khử nhiễu (bilateral), deblur (unsharp
                       mask), tăng tương phản (CLAHE) khi nền sáng
  4. Recognition     — model rec PP-OCRv5 theo ngôn ngữ đọc từng crop đã enhance

Kết quả ghi ra file JSONL (1 dòng / khung) kèm đường dẫn crop PNG để Node chạy
lượt OCR thứ hai bằng Tesseract trên CÙNG crop đó rồi so sánh.

Protocol stdout (mỗi dòng 1 JSON, flush ngay):
  {"type": "ready"}                          — model đã nạp xong
  {"type": "progress", "done": n, "total": m}
  {"type": "warning", "msg": "..."}          — cảnh báo không chết
  {"type": "error", "msg": "..."}            — lỗi rồi exit 3

Exit code: 0 = xong, 2 = thiếu gói python (rapidocr/cv2), 3 = lỗi runtime.

Chạy tay: python paddle_server.py --job job.json
"""

import argparse
import json
import logging
import re
import sys
import warnings
from difflib import SequenceMatcher
from pathlib import Path

warnings.simplefilter("ignore")
logging.getLogger("rapidocr").setLevel(logging.ERROR)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


try:
    import cv2
    import numpy as np
    from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR
except ImportError as exc:
    print(f"Thiếu gói python: {exc.name}", file=sys.stderr, flush=True)
    sys.exit(2)


# ---------------------------------------------------------------------------
# Crop + Enhance vùng chữ
# ---------------------------------------------------------------------------

def get_rotate_crop_image(img, points):
    """Cắt vùng chữ từ 4 điểm hộp (theo thứ tự của DB postprocess)."""
    points = np.asarray(points, dtype=np.float32)
    w = int(max(np.linalg.norm(points[0] - points[1]), np.linalg.norm(points[2] - points[3])))
    h = int(max(np.linalg.norm(points[0] - points[3]), np.linalg.norm(points[1] - points[2])))
    if w < 2 or h < 2:
        return None
    dst = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    m = cv2.getPerspectiveTransform(points, dst)
    return cv2.warpPerspective(img, m, (w, h))


def enhance_variant_a(crop):
    """Variant A (Normal): Upscale + bilateral filter khử nhiễu nhẹ giữ cạnh chữ."""
    h, w = crop.shape[:2]
    if h < 48:
        scale = min(3.0, 48.0 / max(h, 1))
        crop = cv2.resize(
            crop,
            (max(1, int(w * scale + 0.5)), max(1, int(h * scale + 0.5))),
            interpolation=cv2.INTER_CUBIC,
        )
    return cv2.bilateralFilter(crop, 5, 30, 30)


def enhance_variant_b(crop):
    """Variant B (Contrast): CLAHE cân bằng độ tương phản cục bộ mạnh trên kênh Luminance."""
    base = enhance_variant_a(crop)
    yuv = cv2.cvtColor(base, cv2.COLOR_BGR2YUV)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    yuv[:, :, 0] = clahe.apply(yuv[:, :, 0])
    return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR)


def enhance_variant_c(crop):
    """Variant C (Grayscale & Normalize): Tách chữ trắng trên nền phức tạp."""
    base = enhance_variant_a(crop)
    gray = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
    norm = cv2.normalize(gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
    return cv2.cvtColor(norm, cv2.COLOR_GRAY2BGR)


def enhance_variant_d(crop):
    """Variant D (Sharpen): Unsharp mask làm nét biên chữ bị mờ nhòe."""
    base = enhance_variant_a(crop)
    blur = cv2.GaussianBlur(base, (0, 0), 2.5)
    return cv2.addWeighted(base, 1.8, blur, -0.8, 0)


def enhance(crop):
    """Nâng chất ảnh crop tiêu chuẩn (upscale, bilateral, deblur, CLAHE)."""
    h, w = crop.shape[:2]

    # Chữ nhỏ hơn ngưỡng vào của model rec (48px) → phóng to, tối đa 3x
    if h < 48:
        scale = min(3.0, 48.0 / max(h, 1))
        crop = cv2.resize(
            crop,
            (max(1, int(w * scale + 0.5)), max(1, int(h * scale + 0.5))),
            interpolation=cv2.INTER_CUBIC,
        )

    # Khử nhiễu nhưng giữ cạnh chữ
    crop = cv2.bilateralFilter(crop, 5, 40, 40)

    # Deblur: unsharp mask làm nét biên chữ bị mờ do nén/motion
    blur = cv2.GaussianBlur(crop, (0, 0), 3)
    crop = cv2.addWeighted(crop, 1.6, blur, -0.6, 0)

    # Tăng tương phản khi nền sáng/tương phản kém
    y = cv2.cvtColor(crop, cv2.COLOR_BGR2YUV)[:, :, 0]
    if float(y.std()) < 45:
        yuv = cv2.cvtColor(crop, cv2.COLOR_BGR2YUV)
        yuv[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(y)
        crop = cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR)

    return crop


def get_crop_sharpness(crop):
    """Tính độ nét ảnh crop qua phương sai Laplacian (càng lớn càng nét)."""
    if crop is None or crop.size == 0:
        return 0.0
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


# ---------------------------------------------------------------------------
# Hình học & Tracking Bounding Box
# ---------------------------------------------------------------------------

def box_to_rect(box):
    """Từ 4 điểm polygon [[x0,y0], [x1,y1], ...] trả về [x0, y0, w, h]."""
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return [min_x, min_y, max(1.0, max_x - min_x), max(1.0, max_y - min_y)]


def box_iou(rect_a, rect_b):
    """Tính Intersection-over-Union của 2 hình chữ nhật [x0, y0, w, h]."""
    xa0, ya0, wa, ha = rect_a
    xb0, yb0, wb, hb = rect_b
    xa1, ya1 = xa0 + wa, ya0 + ha
    xb1, yb1 = xb0 + wb, yb0 + hb

    inter_x0 = max(xa0, xb0)
    inter_y0 = max(ya0, yb0)
    inter_x1 = min(xa1, xb1)
    inter_y1 = min(ya1, yb1)

    if inter_x1 <= inter_x0 or inter_y1 <= inter_y0:
        return 0.0

    inter_area = (inter_x1 - inter_x0) * (inter_y1 - inter_y0)
    area_a = wa * ha
    area_b = wb * hb
    union_area = area_a + area_b - inter_area
    if union_area <= 0:
        return 0.0
    return inter_area / union_area


def crop_diff(crop_a, crop_b):
    """Tính độ khác biệt pixel giữa 2 ảnh crop để phát hiện đổi câu phụ đề."""
    if crop_a is None or crop_b is None or crop_a.size == 0 or crop_b.size == 0:
        return 999.0
    try:
        ga = cv2.cvtColor(cv2.resize(crop_a, (100, 32)), cv2.COLOR_BGR2GRAY)
        gb = cv2.cvtColor(cv2.resize(crop_b, (100, 32)), cv2.COLOR_BGR2GRAY)
        return float(np.mean(cv2.absdiff(ga, gb)))
    except Exception:
        return 999.0


def box_match_score(rect_a, rect_b, crop_a=None, crop_b=None):
    """Tính điểm tương đồng vị trí và nội dung ảnh giữa 2 box để tracking."""
    # Nếu có ảnh crop, kiểm tra nội dung text có đổi sang câu mới không
    if crop_a is not None and crop_b is not None:
        diff = crop_diff(crop_a, crop_b)
        # Nếu pixel chữ khác biệt lớn (> 28.0) -> câu thoại mới tại cùng vị trí màn hình!
        if diff > 28.0:
            return 0.0

    iou = box_iou(rect_a, rect_b)
    if iou >= 0.35:
        return iou + 1.0  # ưu tiên cao nếu IoU tốt

    xa0, ya0, wa, ha = rect_a
    xb0, yb0, wb, hb = rect_b
    xa1, ya1 = xa0 + wa, ya0 + ha
    xb1, yb1 = xb0 + wb, yb0 + hb

    min_h = max(1.0, min(ha, hb))
    v_overlap = max(0.0, min(ya1, yb1) - max(ya0, yb0)) / min_h

    min_w = max(1.0, min(wa, wb))
    h_overlap = max(0.0, min(xa1, xb1) - max(xa0, xb0)) / min_w

    cy_a = ya0 + ha / 2.0
    cy_b = yb0 + hb / 2.0
    cy_dist = abs(cy_a - cy_b) / min_h

    # Nếu cùng hàng dọc (v_overlap cao, cy_dist nhỏ) và có chồng lấn ngang
    if v_overlap >= 0.55 and cy_dist <= 0.45 and h_overlap >= 0.20:
        return v_overlap * 0.7 + h_overlap * 0.3

    return 0.0


# ---------------------------------------------------------------------------
# Sắp xếp thứ tự đọc
# ---------------------------------------------------------------------------

def sort_reading_order(boxes):
    """Sắp xếp các box theo thứ tự đọc: trên → dưới, trái → phải."""
    if not boxes:
        return []
    items = []
    for b in boxes:
        xs = [p[0] for p in b]
        ys = [p[1] for p in b]
        items.append({"y0": min(ys), "y1": max(ys), "x0": min(xs), "box": b})

    items.sort(key=lambda it: (it["y0"], it["x0"]))
    rows = []
    for it in items:
        placed = False
        for row in rows:
            ref = row[-1]
            overlap = min(it["y1"], ref["y1"]) - max(it["y0"], ref["y0"])
            min_h = max(1.0, min(it["y1"] - it["y0"], ref["y1"] - ref["y0"]))
            if overlap >= 0.3 * min_h:
                row.append(it)
                placed = True
                break
        if not placed:
            rows.append([it])

    rows.sort(key=lambda r: min(it["y0"] for it in r))
    ordered = []
    for row in rows:
        row.sort(key=lambda it: it["x0"])
        ordered.extend(it["box"] for it in row)
    return ordered


def sort_lines_reading_order(lines):
    """Sắp xếp các dòng/từ trong cùng một khung theo thứ tự đọc: trên → dưới, trái → phải."""
    if not lines:
        return []
    items = list(lines)
    items.sort(key=lambda it: (it.get("y0", 0), it.get("x0", 0)))

    rows = []
    for it in items:
        y0 = it.get("y0", 0)
        h = max(1, it.get("h", 1))
        y1 = y0 + h

        placed = False
        for row in rows:
            ref = row[-1]
            ref_y0 = ref.get("y0", 0)
            ref_y1 = ref_y0 + max(1, ref.get("h", 1))
            overlap = min(y1, ref_y1) - max(y0, ref_y0)
            min_h = max(1.0, min(h, ref.get("h", 1)))
            if overlap >= 0.3 * min_h:
                row.append(it)
                placed = True
                break
        if not placed:
            rows.append([it])

    rows.sort(key=lambda r: min(it.get("y0", 0) for it in r))
    ordered = []
    for row in rows:
        row.sort(key=lambda it: it.get("x0", 0))
        ordered.extend(row)
    return ordered


def resolve_enum(enum_cls, names, fallback):
    for name in names:
        member = getattr(enum_cls, name, None)
        if member is not None:
            return member
    return fallback


def build_engine(rec_lang, det_version, rec_version, model_type, text_score):
    params = {
        "Det.ocr_version": getattr(OCRVersion, det_version, OCRVersion.PPOCRV5),
        "Det.model_type": ModelType.MOBILE,
        "Rec.ocr_version": getattr(OCRVersion, rec_version, OCRVersion.PPOCRV5),
        "Rec.lang_type": rec_lang,
        "Rec.model_type": resolve_enum(ModelType, [model_type], ModelType.MOBILE),
        "Global.text_score": text_score,
    }
    return RapidOCR(params=params)


# ---------------------------------------------------------------------------
# Pipeline Chính: Detection → Tracking → Classification → Recognition
# ---------------------------------------------------------------------------

class TextTrack:
    def __init__(self, track_id, first_frame, box, rect, sharpness, crop):
        self.track_id = track_id
        self.first_frame = first_frame
        self.last_frame = first_frame
        self.missed_count = 0
        self.frames = {first_frame: {"box": box, "rect": rect, "sharpness": sharpness}}
        self.rects = [rect]
        self.best_frame = first_frame
        self.best_sharpness = sharpness
        self.best_crop = crop
        self.last_crop = crop
        self.best_box = box
        self.candidate_crops = [(sharpness, first_frame, crop)]
        # Kết quả recognition
        self.text = ""
        self.conf = 0.0
        self.crop_path = ""
        self.classification = "OTHER_TEXT"
        self.zone = None


def is_rect_in_region(avg_rect, frame_w, frame_h, region):
    if not region or not isinstance(region, dict):
        return False
    rx0 = float(region.get("x", 0.0))
    ry0 = float(region.get("y", 0.0))
    rw = float(region.get("w", 1.0))
    rh = float(region.get("h", 1.0))
    rx1, ry1 = rx0 + rw, ry0 + rh

    x0, y0, w, h = avg_rect
    center_x_ratio = (x0 + w / 2.0) / max(1.0, frame_w)
    center_y_ratio = (y0 + h / 2.0) / max(1.0, frame_h)
    return (rx0 <= center_x_ratio <= rx1) and (ry0 <= center_y_ratio <= ry1)

    def add_detection(self, frame_idx, box, rect, sharpness, crop):
        self.frames[frame_idx] = {"box": box, "rect": rect, "sharpness": sharpness}
        self.rects.append(rect)
        self.last_frame = frame_idx
        self.last_crop = crop
        self.missed_count = 0
        self.candidate_crops.append((sharpness, frame_idx, crop))
        if sharpness > self.best_sharpness:
            self.best_sharpness = sharpness
            self.best_frame = frame_idx
            self.best_crop = crop
            self.best_box = box

    @property
    def avg_rect(self):
        xs = [r[0] for r in self.rects]
        ys = [r[1] for r in self.rects]
        ws = [r[2] for r in self.rects]
        hs = [r[3] for r in self.rects]
        return [float(np.mean(xs)), float(np.mean(ys)), float(np.mean(ws)), float(np.mean(hs))]


def normalize_fullwidth(text):
    """Chuyển ký tự ASCII fullwidth (Ａ-Ｚ, ０-９...) về ASCII chuẩn để lọc watermark/noise."""
    if not text:
        return ""
    out = []
    for ch in text:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            out.append(chr(code - 0xFEE0))
        elif code == 0x3000:
            out.append(" ")
        else:
            out.append(ch)
    return "".join(out).strip()


CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]")
ALNUM_RE = re.compile(r"[^a-z0-9\u00c0-\u024f\u1e00-\u1eff\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]+")


def has_cjk(text):
    return bool(CJK_RE.search(text or ""))


def get_alnum_key(text):
    return ALNUM_RE.sub("", normalize_fullwidth(text).lower())


def select_most_stable_text(candidates):
    """
    candidates: list of (text, conf, img)
    Quy tắc 6: Chọn kết quả ổn định nhất dựa trên số frame xuất hiện, confidence và độ nhất quán.
    """
    if not candidates:
        return "", 0.0, None
    if len(candidates) == 1:
        return normalize_fullwidth(candidates[0][0]), candidates[0][1], candidates[0][2]

    # Nhóm theo chuỗi chuẩn hoá
    groups = {}
    for text, conf, img in candidates:
        norm_text = normalize_fullwidth(text)
        if not norm_text:
            continue
        key = norm_text.strip().lower()
        if key not in groups:
            groups[key] = {"original": norm_text, "count": 0, "total_conf": 0.0, "best_conf": 0.0, "img": img}
        groups[key]["count"] += 1
        groups[key]["total_conf"] += conf
        if conf > groups[key]["best_conf"]:
            groups[key]["best_conf"] = conf
            groups[key]["img"] = img
            groups[key]["original"] = norm_text

    if not groups:
        return "", 0.0, None

    # Điểm ổn định = (số lần xuất hiện * 2.0) + tổng confidence
    best_key = max(groups.keys(), key=lambda k: (groups[k]["count"] * 2.0 + groups[k]["total_conf"], groups[k]["best_conf"]))
    best = groups[best_key]
    avg_conf = best["total_conf"] / max(1, best["count"])
    return best["original"], max(avg_conf, best["best_conf"]), best["img"]


def filter_recognized_watermarks(recognized_tracks, total_frames, frame_h, ocr_mode):
    """
    Phát hiện và loại bỏ watermark lặp lại xuyên suốt video (bao gồm cả watermark ở đáy khung hình
    như 'ANGELANJ', 'ANGELANI' bị chia nhỏ thành nhiều track do nền video thay đổi độ sáng).
    Khi ocr_mode == 'dual', bỏ qua lọc thời lượng cho các track thuộc vùng trên (zone == 'top')
    vì bảng/thông tin ở vùng trên thường hiển thị kéo dài theo chủ đích người dùng.
    """
    if not recognized_tracks or ocr_mode == "full" or total_frames < 12:
        return recognized_tracks

    preserved_top_tracks = [
        tr for tr in recognized_tracks
        if getattr(tr, "zone", None) == "top"
        and not (len(tr.frames) <= 2 and not has_cjk(tr.text) and len(get_alnum_key(tr.text)) <= 1)
    ]
    check_tracks = [tr for tr in recognized_tracks if getattr(tr, "zone", None) != "top"]
    if not check_tracks:
        return preserved_top_tracks

    # 1. Gom cụm các track có chuỗi chữ cái/số giống nhau (hoặc là chuỗi con của nhau tại cùng vùng y)
    clusters = []
    bucket_px = max(24.0, frame_h * 0.045)

    for tr in check_tracks:
        key = get_alnum_key(tr.text)
        if not key:
            continue
        y0 = tr.avg_rect[1]
        placed = False
        for cl in clusters:
            if abs(y0 - cl["avg_y"]) <= bucket_px * 1.5:
                ref_key = cl["key"]
                is_sub = (len(key) >= 3 and len(ref_key) >= 4 and (key in ref_key or ref_key in key))
                sim = SequenceMatcher(None, key, ref_key).ratio() if (len(key) >= 4 and len(ref_key) >= 4) else 0.0
                if key == ref_key or is_sub or sim >= 0.72:
                    cl["tracks"].append(tr)
                    cl["frames"].update(tr.frames.keys())
                    cl["first_frame"] = min(cl["first_frame"], tr.first_frame)
                    cl["last_frame"] = max(cl["last_frame"], tr.last_frame)
                    cl["avg_y"] = float(np.mean([t.avg_rect[1] for t in cl["tracks"]]))
                    if len(key) > len(ref_key) and not has_cjk(key):
                        cl["key"] = key
                    placed = True
                    break
        if not placed:
            clusters.append({
                "key": key,
                "tracks": [tr],
                "frames": set(tr.frames.keys()),
                "first_frame": tr.first_frame,
                "last_frame": tr.last_frame,
                "avg_y": y0,
            })

    watermark_track_ids = set()
    watermark_keys = set()
    watermark_y_bands = []

    for cl in clusters:
        span_ratio = (cl["last_frame"] - cl["first_frame"] + 1) / max(1.0, float(total_frames))
        frame_ratio = len(cl["frames"]) / max(1.0, float(total_frames))
        track_count = len(cl["tracks"])

        # Một cụm được xác định là watermark tĩnh/lặp lại nếu:
        # - Trải dài >= 25% thời lượng video VÀ (xuất hiện ở >= 3 track rời rạc HOẶC chiếm >= 14% tổng số frame)
        # - Hoặc chiếm >= 25% tổng số frame của toàn video
        if (span_ratio >= 0.25 and (track_count >= 3 or frame_ratio >= 0.14)) or frame_ratio >= 0.25:
            for tr in cl["tracks"]:
                watermark_track_ids.add(tr.track_id)
            if len(cl["key"]) >= 4:
                watermark_keys.add(cl["key"])
            watermark_y_bands.append(cl["avg_y"])

    # Nếu phát hiện dải y chứa watermark ở sát đáy hoặc đỉnh, kiểm tra thêm các mảnh nhiễu cùng dải y
    filtered = []
    for tr in check_tracks:
        if tr.track_id in watermark_track_ids:
            continue
        key = get_alnum_key(tr.text)
        if not key:
            continue

        # Nếu text của track nằm cùng dải y của watermark và chứa/trùng với watermark key -> bỏ
        y0 = tr.avg_rect[1]
        in_wm_band = any(abs(y0 - wy) <= bucket_px * 1.2 for wy in watermark_y_bands)
        if in_wm_band and not has_cjk(tr.text):
            if any(wk in key or (len(key) >= 2 and key in wk) or SequenceMatcher(None, key, wk).ratio() >= 0.65 for wk in watermark_keys):
                continue

        # Nếu dòng phụ đề thật bị dính kèm watermark token (ví dụ: "老妈去接放学的妹妹了 ANGELANJ"), cắt bỏ watermark token
        cleaned_text = tr.text
        for wk in watermark_keys:
            if len(wk) >= 5 and wk in key and len(key) > len(wk) + 1:
                pattern = re.compile(r"\s*[A-Za-z0-9]*" + re.escape(wk[:4]) + r"[A-Za-z0-9\s]*$", re.IGNORECASE)
                stripped = pattern.sub("", cleaned_text).strip()
                if stripped:
                    cleaned_text = stripped
        tr.text = cleaned_text

        # Lọc nhiễu 1 ký tự Latin/số xuất hiện ngắn (<= 2 frame) không phải chữ CJK
        if len(tr.frames) <= 2 and not has_cjk(tr.text) and len(get_alnum_key(tr.text)) <= 1:
            continue

        filtered.append(tr)

    return preserved_top_tracks + filtered


def run_pipeline(job):
    frames = job["frames"]
    out_path = Path(job["outPath"])
    crops_dir = Path(job["cropsDir"])
    crops_dir.mkdir(parents=True, exist_ok=True)

    lang_names = job.get("recLangNames", ["CH"])
    rec_lang = resolve_enum(LangRec, lang_names, LangRec.CH)

    try:
        engine = build_engine(
            rec_lang,
            job.get("detVersion", "PPOCRV5"),
            job.get("recVersion", "PPOCRV5"),
            job.get("modelType", "MOBILE"),
            float(job.get("textScore", 0.25)),
        )
    except Exception as exc:
        emit({"type": "error", "msg": f"Không khởi tạo được RapidOCR: {exc}"})
        sys.exit(3)

    emit({"type": "ready"})

    video_w = int(job.get("videoWidth") or 0)
    video_h = int(job.get("videoHeight") or 0)
    offset_ratio = float(job.get("regionOffsetRatio") or 0.0)
    ocr_mode = str(job.get("ocrMode") or "").lower()
    if not ocr_mode:
        ocr_mode = "bottom" if offset_ratio > 0.3 else "auto"
    custom_region = job.get("customRegion")  # {"x": float, "y": float, "w": float, "h": float}
    dual_regions = job.get("dualRegions")  # {"top": {...}, "bottom": {...}}

    total_frames = len(frames)
    active_tracks = []
    closed_tracks = []
    next_track_id = 1

    frame_w = video_w if video_w > 0 else 1280
    frame_h = video_h if video_h > 0 else 720

    # =========================================================================
    # Giai đoạn 1 & 2: Full-screen Text Detection & Tracking qua từng khung
    # =========================================================================
    emit({"type": "stage", "name": "detect", "msg": "Đang phát hiện và theo dõi vị trí chữ..."})

    for i, frame_path in enumerate(frames):
        img = cv2.imread(str(frame_path))
        if img is None:
            emit({"type": "warning", "msg": f"Khung {i}: không đọc được ảnh {frame_path}"})
            continue

        fh, fw = img.shape[:2]
        frame_w, frame_h = fw, fh

        # Detect hộp chữ trên khung hình
        try:
            det_result = engine(img, use_det=True, use_cls=False, use_rec=False)
            raw_boxes = getattr(det_result, "boxes", None) if det_result is not None else None
            detected_boxes = np.asarray(raw_boxes).tolist() if raw_boxes is not None and len(raw_boxes) > 0 else []
            detected_boxes = sort_reading_order(detected_boxes)
        except Exception as exc:
            emit({"type": "warning", "msg": f"Lỗi detection khung {i}: {exc}"})
            detected_boxes = []

        # Chuẩn bị detections của khung này
        frame_detections = []
        for box in detected_boxes:
            rect = box_to_rect(box)
            # Lọc nhiễu quá bé (chiều cao < 6px hoặc diện tích < 50px)
            if rect[3] < 6 or (rect[2] * rect[3]) < 50:
                continue
            crop = get_rotate_crop_image(img, box)
            sharpness = get_crop_sharpness(crop)
            frame_detections.append({
                "box": box,
                "rect": rect,
                "sharpness": sharpness,
                "crop": crop,
            })

        # Ghép nối (Tracking) với active_tracks (so sánh vị trí + độ đổi nội dung crop)
        matched_track_ids = set()
        matched_det_indices = set()

        matches = []
        for det_idx, det in enumerate(frame_detections):
            for t_idx, track in enumerate(active_tracks):
                score = box_match_score(det["rect"], track.rects[-1], det["crop"], track.last_crop)
                if score > 0:
                    matches.append((score, det_idx, t_idx))

        # Khớp tham lam theo điểm cao nhất
        matches.sort(key=lambda m: m[0], reverse=True)
        for score, det_idx, t_idx in matches:
            if det_idx in matched_det_indices or t_idx in matched_track_ids:
                continue
            matched_det_indices.add(det_idx)
            matched_track_ids.add(t_idx)
            det = frame_detections[det_idx]
            active_tracks[t_idx].add_detection(i, det["box"], det["rect"], det["sharpness"], det["crop"])

        # Các active_tracks không khớp ở khung này
        still_active = []
        for t_idx, track in enumerate(active_tracks):
            if t_idx not in matched_track_ids:
                track.missed_count += 1
                # Nếu mất dấu quá 2 khung liên tiếp (~1s ở 2fps) -> đóng track
                if track.missed_count > 2:
                    closed_tracks.append(track)
                else:
                    still_active.append(track)
            else:
                still_active.append(track)
        active_tracks = still_active

        # Các detections chưa khớp -> tạo track mới
        for det_idx, det in enumerate(frame_detections):
            if det_idx not in matched_det_indices:
                new_track = TextTrack(
                    track_id=next_track_id,
                    first_frame=i,
                    box=det["box"],
                    rect=det["rect"],
                    sharpness=det["sharpness"],
                    crop=det["crop"],
                )
                next_track_id += 1
                active_tracks.append(new_track)

        emit({"type": "progress", "stage": "detect", "done": i + 1, "total": total_frames})

    # Đóng tất cả track còn lại
    closed_tracks.extend(active_tracks)

    # =========================================================================
    # Giai đoạn 3: Classification & Lọc theo OCR Mode
    # =========================================================================
    emit({"type": "stage", "name": "classify", "msg": "Đang phân loại phụ đề và lọc logo/watermark..."})

    valid_tracks = []
    for track in closed_tracks:
        frame_count = len(track.frames)
        total_duration_frames = track.last_frame - track.first_frame + 1
        presence_ratio = frame_count / max(1, total_frames)

        avg_rect = track.avg_rect
        x0, y0, w, h = avg_rect
        y0_ratio = y0 / max(1.0, frame_h)
        y1_ratio = (y0 + h) / max(1.0, frame_h)
        x0_ratio = x0 / max(1.0, frame_w)
        x1_ratio = (x0 + w) / max(1.0, frame_w)

        # Phân loại:
        # Watermark / Logo / Channel Name tĩnh:
        # 1. Chỉ xét khi video có ít nhất 20 frames (~10s)
        # 2. Xuất hiện cả ở 15% đầu VÀ 15% cuối video (spans_video) VÀ ở top/corner hoặc chiếm >= 50% thời lượng
        # 3. HOẶC xuất hiện liên tục >= 40 frames (>= 20s) ở vùng top/corner
        spans_video = (track.first_frame <= max(2, int(total_frames * 0.15))) and (track.last_frame >= min(total_frames - 3, int(total_frames * 0.85)))
        is_corner = (x1_ratio <= 0.25 or x0_ratio >= 0.75) and (y1_ratio <= 0.25 or y0_ratio >= 0.85)

        in_dual_top = False
        in_dual_bottom = False
        if ocr_mode == "dual" and isinstance(dual_regions, dict):
            in_dual_top = is_rect_in_region(avg_rect, frame_w, frame_h, dual_regions.get("top"))
            in_dual_bottom = (not in_dual_top) and is_rect_in_region(avg_rect, frame_w, frame_h, dual_regions.get("bottom"))

        is_watermark = False
        if total_frames >= 20:
            if in_dual_top:
                # Vùng trên do người dùng chỉ định để lấy bảng/tiêu đề: chỉ bỏ logo góc thật sự tĩnh
                if is_corner and spans_video and presence_ratio >= 0.70:
                    is_watermark = True
            else:
                if spans_video and (y1_ratio <= 0.30 or is_corner or presence_ratio >= 0.50):
                    is_watermark = True
                elif total_duration_frames >= 40 and (y1_ratio <= 0.30 or is_corner):
                    is_watermark = True

        # Quy tắc 3: Phân loại chuẩn SUBTITLE, OVERLAY, OTHER_TEXT
        if is_watermark:
            track.classification = "OTHER_TEXT"
        elif frame_count == 1 and (w * h < 180 or h < 8):
            track.classification = "OTHER_TEXT"
        elif y1_ratio <= 0.35:
            # Vùng trên: Hook / Title / Caption / Banner
            track.classification = "OVERLAY"
        elif y1_ratio >= 0.45 and h <= 120:
            # Vùng dưới: Phụ đề chính
            track.classification = "SUBTITLE"
        else:
            track.classification = "OVERLAY" if y1_ratio < 0.50 else "SUBTITLE"

        # Lọc theo chế độ người dùng chọn:
        keep = False
        if ocr_mode == "auto":
            keep = (track.classification == "SUBTITLE")
        elif ocr_mode == "bottom":
            in_bottom = (offset_ratio > 0.3) or (y1_ratio >= 0.55)
            keep = in_bottom and (track.classification != "OTHER_TEXT")
        elif ocr_mode == "full":
            keep = (track.classification in ("SUBTITLE", "OVERLAY"))
        elif ocr_mode == "custom":
            if custom_region and isinstance(custom_region, dict):
                keep = is_rect_in_region(avg_rect, frame_w, frame_h, custom_region) and (track.classification != "OTHER_TEXT")
            else:
                keep = (track.classification == "SUBTITLE")
        elif ocr_mode == "dual":
            if in_dual_top:
                track.zone = "top"
                keep = (track.classification != "OTHER_TEXT")
            elif in_dual_bottom:
                track.zone = "bottom"
                keep = (track.classification != "OTHER_TEXT")
            else:
                keep = False
        else:
            keep = (track.classification == "SUBTITLE")

        if keep:
            valid_tracks.append(track)

    # =========================================================================
    # Giai đoạn 4: Recognition (OCR) cho các Subtitle Tracklet được giữ lại
    # =========================================================================
    emit({"type": "stage", "name": "recognize", "msg": f"Đang nhận diện chữ trên {len(valid_tracks)} đoạn phụ đề..."})

    # Tự động dò và chuyển sang model CJK (LangRec.CH) nếu cấu hình đang để LATIN (vie/eng)
    # nhưng video thực tế là phụ đề chữ Hán/Nhật (khiến model LATIN chỉ đọc ra dấu câu '+', '?', '.' hoặc ký tự rời rạc)
    if rec_lang == getattr(LangRec, "LATIN", None) and len(valid_tracks) >= 2:
        try:
            probe_candidates = [
                tr for tr in valid_tracks
                if tr.avg_rect[2] >= max(45.0, frame_w * 0.08)
                and (tr.avg_rect[1] + tr.avg_rect[3]) / max(1.0, frame_h) <= 0.88
            ]
            if not probe_candidates:
                probe_candidates = [tr for tr in valid_tracks if tr.avg_rect[2] >= 40.0]
            probe_candidates.sort(key=lambda tr: len(tr.frames) * tr.avg_rect[2], reverse=True)
            probe_sample = probe_candidates[:6]

            if probe_sample:
                ch_engine = build_engine(
                    LangRec.CH,
                    job.get("detVersion", "PPOCRV5"),
                    job.get("recVersion", "PPOCRV5"),
                    job.get("modelType", "MOBILE"),
                    float(job.get("textScore", 0.25)),
                )
                cjk_wins = 0
                valid_probes = 0
                for ptr in probe_sample:
                    if not ptr.candidate_crops:
                        continue
                    best_raw = max(ptr.candidate_crops, key=lambda c: c[0])[2]
                    if best_raw is None or best_raw.size == 0:
                        continue
                    valid_probes += 1
                    probe_img = enhance(best_raw)

                    lat_txt, lat_conf = "", 0.0
                    ch_txt, ch_conf = "", 0.0
                    try:
                        r_lat = engine(probe_img, use_det=False, use_cls=True, use_rec=True)
                        if getattr(r_lat, "txts", None) and getattr(r_lat, "scores", None):
                            lat_txt = str(r_lat.txts[0]).strip()
                            lat_conf = float(r_lat.scores[0])
                    except Exception:
                        pass

                    try:
                        r_ch = ch_engine(probe_img, use_det=False, use_cls=True, use_rec=True)
                        if getattr(r_ch, "txts", None) and getattr(r_ch, "scores", None):
                            ch_txt = str(r_ch.txts[0]).strip()
                            ch_conf = float(r_ch.scores[0])
                    except Exception:
                        pass

                    cjk_chars = len(CJK_RE.findall(ch_txt))
                    lat_alnum = len(get_alnum_key(lat_txt))
                    if cjk_chars >= 2 and ch_conf >= 0.72 and (ch_conf > lat_conf + 0.05 or lat_alnum <= 2):
                        cjk_wins += 1

                if valid_probes > 0 and (cjk_wins >= 2 or (valid_probes <= 2 and cjk_wins >= 1)):
                    engine = ch_engine
                    rec_lang = LangRec.CH
                    emit({
                        "type": "warning",
                        "msg": "Phát hiện phụ đề chữ Hán/Nhật (CJK) trong video — tự động chuyển bộ nhận diện sang CJK để đọc chính xác.",
                    })
        except Exception:
            pass

    scale = (frame_w / video_w) if video_w > 0 else 1.0
    offset_px = offset_ratio * video_h if video_h > 0 else 0.0

    recognized_tracks = []
    total_valid = max(1, len(valid_tracks))

    for t_idx, track in enumerate(valid_tracks):
        sorted_candidates = sorted(track.candidate_crops, key=lambda c: c[0], reverse=True)
        top_candidates = sorted_candidates[:3]

        crop_recognitions = []
        for sh, f_num, raw_crop in top_candidates:
            if raw_crop is None or raw_crop.size == 0:
                continue

            std_crop = enhance(raw_crop)
            cand_text = ""
            cand_conf = 0.0
            cand_img = std_crop

            try:
                rec_result = engine(std_crop, use_det=False, use_cls=True, use_rec=True)
                txts = getattr(rec_result, "txts", None) if rec_result is not None else None
                scores = getattr(rec_result, "scores", None) if rec_result is not None else None
                if txts and scores and len(txts) > 0:
                    cand_text = str(txts[0]).strip()
                    cand_conf = float(scores[0])
            except Exception:
                pass

            # Quy tắc 8: Nếu confidence thấp (< 0.70) hoặc không đọc được, thử 4 biến thể
            if cand_conf < 0.70:
                variants = [
                    ("normal", enhance_variant_a(raw_crop)),
                    ("contrast", enhance_variant_b(raw_crop)),
                    ("grayscale", enhance_variant_c(raw_crop)),
                    ("sharpen", enhance_variant_d(raw_crop)),
                ]
                for var_name, var_img in variants:
                    try:
                        var_res = engine(var_img, use_det=False, use_cls=True, use_rec=True)
                        v_txts = getattr(var_res, "txts", None) if var_res is not None else None
                        v_scores = getattr(var_res, "scores", None) if var_res is not None else None
                        if v_txts and v_scores and len(v_txts) > 0:
                            v_text = str(v_txts[0]).strip()
                            v_conf = float(v_scores[0])
                            if v_text and v_conf > cand_conf:
                                cand_text = v_text
                                cand_conf = v_conf
                                cand_img = var_img
                    except Exception:
                        continue

            if cand_text:
                crop_recognitions.append((cand_text, cand_conf, cand_img))

            # Nếu crop đầu tiên đã đạt confidence rất cao (>= 0.96) thì không cần OCR thêm crop khác
            if cand_conf >= 0.96:
                break

        if not crop_recognitions:
            continue

        # Quy tắc 6: Bỏ phiếu chọn text ổn định nhất giữa các frame
        best_text, best_conf, best_crop_img = select_most_stable_text(crop_recognitions)
        if not best_text or best_crop_img is None:
            continue

        crop_filename = f"t{track.track_id:04d}_f{track.best_frame:06d}.png"
        crop_path = crops_dir / crop_filename
        cv2.imwrite(str(crop_path), best_crop_img)
        track.crop_path = str(crop_path)
        track.text = best_text
        track.conf = round(best_conf, 4)
        recognized_tracks.append(track)

        emit({"type": "progress", "stage": "recognize", "done": t_idx + 1, "total": total_valid})

    # Hậu kiểm lọc watermark lặp lại (kể cả watermark nằm ở đáy khung hình bị đứt quãng)
    recognized_tracks = filter_recognized_watermarks(recognized_tracks, total_frames, frame_h, ocr_mode)

    # =========================================================================
    # Giai đoạn 5: Format Output JSONL theo khung hình
    # =========================================================================
    frame_lines = [[] for _ in range(total_frames)]

    for track in recognized_tracks:
        avg_x, avg_y, avg_w, avg_h = track.avg_rect
        line_data = {
            "text": track.text,
            "conf": track.conf,
            "y0": int(round(avg_y / scale + offset_px)),
            "x0": int(round(avg_x / scale)),
            "w": int(round(avg_w / scale)),
            "h": int(round(avg_h / scale)),
            "crop": track.crop_path,
            "trackId": track.track_id,
            "firstFrame": track.first_frame,
            "lastFrame": track.last_frame,
            "classification": track.classification,
            **({"zone": track.zone} if getattr(track, "zone", None) else {}),
        }
        for f_idx in track.frames:
            if 0 <= f_idx < total_frames:
                frame_lines[f_idx].append(line_data)

    with out_path.open("w", encoding="utf-8") as out:
        for i in range(total_frames):
            lines = sort_lines_reading_order(frame_lines[i])
            out.write(json.dumps({"i": i, "lines": lines}, ensure_ascii=False) + "\n")
            out.flush()

    emit({"type": "done", "totalTracks": len(recognized_tracks), "totalFrames": total_frames})
    sys.exit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True, help="Đường dẫn file job JSON")
    args = ap.parse_args()

    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    run_pipeline(job)


if __name__ == "__main__":
    main()

