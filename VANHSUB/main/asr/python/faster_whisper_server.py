#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Faster-Whisper & Speaker Diarization Sidecar Server for Vanhsub.
Performs CTranslate2-accelerated speech-to-text with word-level timestamps
and optional speaker diarization (Pyannote or acoustic clustering fallback).
Communicates with Node.js via newline-delimited JSON messages on stdout.
"""

import argparse
import json
import math
import os
import re
import sys
import wave

# Compatibility fix: PyAV >= 14.0.0 / 19.0.0 removed the `metadata_errors` keyword argument
# from `av.open()`, but faster-whisper (v1.x) still passes `metadata_errors="ignore"` in `decode_audio()`.
try:
    import av
    _orig_av_open = av.open
    def _patched_av_open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _orig_av_open(*args, **kwargs)
    av.open = _patched_av_open
    try:
        import faster_whisper.audio
        faster_whisper.audio.av.open = _patched_av_open
    except Exception:
        pass
except Exception:
    pass

def emit(msg_type, **kwargs):
    payload = {"type": msg_type, **kwargs}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def format_timestamp(seconds: float) -> str:
    clamped = max(0.0, float(seconds))
    total_ms = int(round(clamped * 1000.0))
    h = total_ms // 3600000
    m = (total_ms % 3600000) // 60000
    s = (total_ms % 60000) // 1000
    ms = total_ms % 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

CJK_PATTERN = re.compile(r'[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]')
TERMINAL_PUNCT_PATTERN = re.compile(r'[.?!。？！…]+$')
CLAUSE_PUNCT_PATTERN = re.compile(r'[,;:，；：、]+$')
PUNCT_TOKEN_PATTERN = re.compile(r'^[,.!?:;，。？！；：、…)]+$')

def is_cjk_char(ch: str) -> bool:
    return bool(CJK_PATTERN.match(ch))

def is_cjk_text(text: str) -> bool:
    return bool(CJK_PATTERN.search(text))

def has_terminal_punct(word: str) -> bool:
    if not word:
        return False
    w = word.strip()
    return bool(TERMINAL_PUNCT_PATTERN.search(w)) or w.endswith("...")

def has_clause_punct(word: str) -> bool:
    if not word:
        return False
    w = word.strip()
    return bool(CLAUSE_PUNCT_PATTERN.search(w))

def count_units(words: list) -> int:
    count = 0
    for w_obj in words:
        w = (w_obj.get("word") or "").strip()
        cjk_count = sum(1 for ch in w if is_cjk_char(ch))
        count += cjk_count if cjk_count > 0 else 1
    return count

def format_words_text(words: list) -> str:
    if not words:
        return ""
    result = ""
    for w_obj in words:
        w = (w_obj.get("word") or "").strip()
        if not w:
            continue
        if not result:
            result = w
            continue
        prev_char = result[-1]
        next_char = w[0]
        if PUNCT_TOKEN_PATTERN.match(w):
            result += w
        elif is_cjk_char(prev_char) and is_cjk_char(next_char):
            result += w
        else:
            result += " " + w
    return result

def wrap_visual_lines(text: str, max_chars_per_line: int = 37) -> str:
    clean = (text or "").strip()
    if not clean or len(clean) <= max_chars_per_line:
        return clean
    if "\n" in clean:
        return "\n".join(wrap_visual_lines(l, max_chars_per_line) for l in clean.split("\n"))

    # Only apply spaceless character-level wrapping if text has NO whitespace (pure CJK)
    has_whitespace = bool(re.search(r'\s', clean))

    if has_whitespace:
        mid = len(clean) // 2
        best_space = -1
        min_dist = float("inf")
        for i, ch in enumerate(clean):
            if ch == ' ':
                l1 = clean[:i].strip()
                l2 = clean[i+1:].strip()
                if len(l1) <= max_chars_per_line and len(l2) <= max_chars_per_line:
                    dist = abs(i - mid)
                    if dist < min_dist:
                        min_dist = dist
                        best_space = i
        if best_space != -1:
            return f"{clean[:best_space].strip()}\n{clean[best_space+1:].strip()}"

        space_idx = clean.rfind(' ', 0, max_chars_per_line + 1)
        if space_idx > 0:
            return f"{clean[:space_idx].strip()}\n{clean[space_idx+1:].strip()}"

        next_space = clean.find(' ', max_chars_per_line)
        if next_space > 0:
            return f"{clean[:next_space].strip()}\n{clean[next_space+1:].strip()}"

    if is_cjk_text(clean):
        cjk_punct = ["，", "；", "：", "、", "。", "？", "！"]
        best_split = -1
        mid = len(clean) // 2
        for i, ch in enumerate(clean):
            if ch in cjk_punct:
                idx = i + 1
                if idx <= max_chars_per_line and (len(clean) - idx) <= max_chars_per_line:
                    if best_split == -1 or abs(idx - mid) < abs(best_split - mid):
                        best_split = idx
        if best_split != -1:
            return f"{clean[:best_split].strip()}\n{clean[best_split:].strip()}"
        split_point = mid if len(clean) <= max_chars_per_line * 2 else max_chars_per_line
        return f"{clean[:split_point].strip()}\n{clean[split_point:].strip()}"

    return clean

def segment_words_naturally(words: list, max_chars_per_line: int = 37) -> list:
    """
    Phân đoạn phụ đề tự nhiên theo mốc từng từ (Word-Level Natural Segmentation).
    Tạo các câu ngắn tự nhiên 2.0s - 5.0s (trần cứng 6.0s), tách khi khoảng lặng >= 350ms,
    dấu câu kết thúc / ngắt vế, và đổi người nói.
    """
    if not words:
        return []

    raw_words = []
    for w in words:
        if not w or not isinstance(w.get("word"), str):
            continue
        text = w["word"].strip()
        if not text:
            continue
        start_ms = max(0, int(round(w.get("startMs", 0))))
        raw_end = int(round(w["endMs"])) if "endMs" in w and w["endMs"] is not None else start_ms
        end_ms = max(start_ms, raw_end)
        raw_words.append({
            **w,
            "word": text,
            "startMs": start_ms,
            "endMs": end_ms
        })

    if not raw_words:
        return []

    raw_words.sort(key=lambda x: (x["startMs"], x["endMs"]))

    sanitized = []
    for i in range(len(raw_words)):
        cur = dict(raw_words[i])
        next_w = raw_words[i + 1] if i + 1 < len(raw_words) else None
        if cur["endMs"] < cur["startMs"] + 30:
            padded_end = cur["startMs"] + 30
            if next_w and next_w["startMs"] > cur["startMs"] and padded_end > next_w["startMs"]:
                padded_end = next_w["startMs"]
            cur["endMs"] = max(cur["endMs"], padded_end)
        sanitized.append(cur)

    segments = []
    current_chunk = []

    def flush_chunk():
        nonlocal current_chunk
        if not current_chunk:
            return
        start_ms = current_chunk[0]["startMs"]
        max_word_end_ms = max(w["endMs"] for w in current_chunk)
        end_ms = max(max_word_end_ms, current_chunk[-1]["endMs"])
        current_chunk[-1]["endMs"] = end_ms

        raw_text = format_words_text(current_chunk)
        display_text = wrap_visual_lines(raw_text, max_chars_per_line)
        speaker = current_chunk[0].get("speaker")

        segments.append({
            "start": start_ms / 1000.0,
            "end": end_ms / 1000.0,
            "startMs": start_ms,
            "endMs": end_ms,
            "text": display_text,
            "speaker": speaker,
            "words": list(current_chunk)
        })
        current_chunk = []

    for i in range(len(sanitized)):
        cur_word = sanitized[i]
        current_chunk.append(cur_word)

        if i == len(sanitized) - 1:
            flush_chunk()
            break

        next_word = sanitized[i + 1]
        chunk_start_ms = current_chunk[0]["startMs"]
        cur_dur = cur_word["endMs"] - chunk_start_ms
        proj_dur = next_word["endMs"] - chunk_start_ms
        pause = max(0, next_word["startMs"] - cur_word["endMs"])
        unit_count = count_units(current_chunk)
        is_cjk = is_cjk_text(format_words_text(current_chunk))

        # 1. Đổi người nói
        if cur_word.get("speaker") and next_word.get("speaker") and cur_word["speaker"] != next_word["speaker"]:
            flush_chunk()
            continue

        # 2. Khoảng lặng >= 350ms (vô điều kiện khi >= 700ms)
        if pause >= 350:
            flush_chunk()
            continue

        # 3. Trần cứng thời lượng 6.0s
        if proj_dur > 6000:
            flush_chunk()
            continue

        # 4. Dấu câu kết thúc (. ? ! 。 ？ ！ …)
        if has_terminal_punct(cur_word["word"]):
            abbreviation = re.match(r"^(?:mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|e\.g|i\.e|tp|ts|pgs)\.$", cur_word["word"], re.I)
            next_starts_sentence = bool(next_word["word"].strip() and
                (next_word["word"].strip()[0].isupper() or is_cjk_text(next_word["word"].strip()[0])))
            if (next_starts_sentence and not abbreviation) or cur_dur >= 1500 or unit_count >= 4 or proj_dur > 5000 or pause >= 200:
                flush_chunk()
                continue

        # 5. Dấu ngắt vế (, ; : ， ； ： 、)
        if has_clause_punct(cur_word["word"]):
            required_units = 12 if is_cjk else 6
            if cur_dur >= 2000 or unit_count >= required_units or proj_dur > 5000 or (pause >= 200 and cur_dur >= 1500):
                flush_chunk()
                continue

        # 6. Thời lượng lý tưởng tối đa 5.0s
        if cur_dur >= 5000:
            flush_chunk()
            continue

        # 7. Thời lượng >= 3.5s với số từ lớn và nghỉ nhẹ >= 150ms
        threshold_units = 16 if is_cjk else 8
        if cur_dur >= 3500 and unit_count >= threshold_units and pause >= 150:
            flush_chunk()
            continue

    # Đảm bảo bất biến segments[i].endMs <= segments[i+1].startMs luôn đúng
    for i in range(len(segments) - 1):
        if segments[i]["endMs"] > segments[i + 1]["startMs"] and (not segments[i].get("speaker") or not segments[i + 1].get("speaker") or segments[i]["speaker"] == segments[i + 1]["speaker"]):
            segments[i]["endMs"] = segments[i + 1]["startMs"]
            segments[i]["end"] = segments[i]["endMs"] / 1000.0
            if segments[i]["words"]:
                segments[i]["words"][-1]["endMs"] = segments[i]["endMs"]

    return segments

def get_audio_duration_sec(audio_path: str) -> float:
    try:
        with wave.open(audio_path, 'rb') as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate > 0:
                return float(frames) / float(rate)
    except Exception:
        pass
    return 0.0

def run_diarization_pyannote(audio_path: str, hf_token: str, num_speakers: int = None):
    try:
        from pyannote.audio import Pipeline
        auth_param = {"use_auth_token": hf_token} if hf_token else {}
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", **auth_param)
        if pipeline is None:
            return None
        
        params = {}
        if num_speakers and num_speakers > 0:
            params["num_speakers"] = int(num_speakers)
        
        diarization = pipeline(audio_path, **params)
        intervals = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            intervals.append({
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": str(speaker)
            })
        return intervals
    except Exception as e:
        emit("warning", msg=f"Pyannote diarization unavailable: {str(e)}")
        return None

def extract_simple_acoustic_features(audio_path: str, start_sec: float, end_sec: float):
    """
    Extracts lightweight acoustic features (RMS energy, zero-crossing rate)
    from WAV chunk to separate speakers by voice characteristics when Pyannote is absent.
    """
    try:
        with wave.open(audio_path, 'rb') as wf:
            rate = wf.getframerate()
            sampwidth = wf.getsampwidth()
            nchannels = wf.getnchannels()
            start_frame = int(start_sec * rate)
            end_frame = int(end_sec * rate)
            count = max(1, end_frame - start_frame)
            wf.setpos(min(start_frame, wf.getnframes() - 1))
            raw = wf.readframes(count)
            if not raw or sampwidth != 2:
                return [0.0, 0.0]
            
            import struct
            fmt = f"<{len(raw)//2}h"
            samples = struct.unpack(fmt, raw)
            if nchannels > 1:
                samples = samples[::nchannels]
            
            if not samples:
                return [0.0, 0.0]
            
            # RMS Energy
            sq_sum = sum(s * s for s in samples)
            rms = math.sqrt(sq_sum / len(samples))
            
            # Zero-Crossing Rate
            zcr = 0
            for i in range(1, len(samples)):
                if (samples[i] >= 0 and samples[i - 1] < 0) or (samples[i] < 0 and samples[i - 1] >= 0):
                    zcr += 1
            zcr_rate = float(zcr) / float(len(samples))
            return [rms, zcr_rate]
    except Exception:
        return [0.0, 0.0]

def run_standalone_clustering(audio_path: str, segments_data: list, num_speakers: int = 2):
    """
    Clusters segments into speakers using acoustic features.
    """
    if not segments_data:
        return []
    
    n_speakers = max(1, min(len(segments_data), num_speakers or 2))
    features = [extract_simple_acoustic_features(audio_path, seg["start"], seg["end"]) for seg in segments_data]
    
    try:
        from sklearn.cluster import KMeans
        import numpy as np
        X = np.array(features)
        # Normalize features
        std = np.std(X, axis=0)
        std[std == 0] = 1.0
        X_norm = (X - np.mean(X, axis=0)) / std
        kmeans = KMeans(n_clusters=n_speakers, random_state=42, n_init='auto')
        labels = kmeans.fit_predict(X_norm)
        return [f"SPEAKER_{label:02d}" for label in labels]
    except Exception:
        # Fallback without sklearn: sort by RMS energy and partition into 2 groups
        if n_speakers > 1 and len(features) > 1:
            energies = [f[0] for f in features]
            median_e = sorted(energies)[len(energies) // 2]
            return [f"SPEAKER_{0:02d}" if f[0] >= median_e else f"SPEAKER_{1:02d}" for f in features]
        return ["SPEAKER_00"] * len(segments_data)

def match_speaker_to_segment(seg_start: float, seg_end: float, intervals: list) -> str:
    """Finds speaker with greatest temporal overlap with segment [seg_start, seg_end]."""
    if not intervals:
        return "SPEAKER_00"
    
    best_speaker = "SPEAKER_00"
    max_overlap = 0.0
    for it in intervals:
        overlap = max(0.0, min(seg_end, it["end"]) - max(seg_start, it["start"]))
        if overlap > max_overlap:
            max_overlap = overlap
            best_speaker = it["speaker"]
    return best_speaker

def main():
    parser = argparse.ArgumentParser(description="Faster-Whisper & Diarization Sidecar")
    parser.add_argument("--audio", required=True, help="Input audio WAV file")
    parser.add_argument("--output", required=True, help="Output SRT file path")
    parser.add_argument("--model", default="large-v3-turbo", help="Model name: tiny, base, small, medium, large-v3-turbo")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"], help="Compute device")
    parser.add_argument("--compute_type", default="auto", help="Compute type: float16, int8, int8_float16, float32")
    parser.add_argument("--language", default="vi", help="Audio language code (e.g. vi, en, auto)")
    parser.add_argument("--word_timestamps", action="store_true", default=True, help="Generate word-level timestamps")
    parser.add_argument("--diarize", action="store_true", default=False, help="Enable speaker diarization")
    parser.add_argument("--num_speakers", type=int, default=None, help="Hint for number of speakers")
    parser.add_argument("--hf_token", default="", help="HuggingFace token for gated diarization models")
    parser.add_argument("--models_dir", default=None, help="Directory to store downloaded models")
    args = parser.parse_args()

    audio_path = os.path.abspath(args.audio)
    output_path = os.path.abspath(args.output)

    if not os.path.exists(audio_path):
        emit("error", message=f"Audio file not found: {audio_path}")
        sys.exit(1)

    # 1. Device and Compute Type Resolution
    device = args.device
    compute_type = args.compute_type

    if device == "auto":
        has_cuda = False
        try:
            import ctranslate2
            has_cuda = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            pass
        if not has_cuda:
            try:
                import torch
                has_cuda = torch.cuda.is_available()
            except Exception:
                pass

        if has_cuda:
            device = "cuda"
            if compute_type == "auto":
                compute_type = "float16"
        else:
            device = "cpu"
            if compute_type == "auto":
                compute_type = "int8"
    else:
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"

    # 2. Instantiate Faster-Whisper Model with fallback to CPU
    model = None
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        emit("error", message=f"Gói faster-whisper chưa được cài đặt trong môi trường Python: {str(e)}")
        sys.exit(2)

    download_root = args.models_dir or os.path.join(os.path.expanduser("~"), ".cache", "vanhsub-whisper")
    os.makedirs(download_root, exist_ok=True)

    try:
        emit("progress", percent=5, stage=f"Đang tải model {args.model} ({device} / {compute_type})...")
        model = WhisperModel(args.model, device=device, compute_type=compute_type, download_root=download_root)
    except Exception as e:
        if device == "cuda":
            emit("warning", msg=f"Lỗi khởi tạo CUDA ({str(e)}), tự động chuyển sang CPU int8...")
            device = "cpu"
            compute_type = "int8"
            try:
                model = WhisperModel(args.model, device="cpu", compute_type="int8", download_root=download_root)
            except Exception as e2:
                emit("error", message=f"Không thể khởi tạo WhisperModel trên CPU: {str(e2)}")
                sys.exit(3)
        else:
            emit("error", message=f"Không thể khởi tạo WhisperModel: {str(e)}")
            sys.exit(3)

    emit("ready", device=device, compute_type=compute_type, model=args.model)

    # 3. Transcribe Audio
    duration_sec = get_audio_duration_sec(audio_path)
    emit("progress", percent=10, stage="Đang nhận diện giọng nói...")

    lang_opt = None if args.language == "auto" else args.language

    try:
        segments_gen, info = model.transcribe(
            audio_path,
            language=lang_opt,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            word_timestamps=args.word_timestamps
        )
        total_duration = info.duration if info.duration and info.duration > 0 else duration_sec

        collected_segments = []
        all_words = []

        for seg in segments_gen:
            words_data = []
            if seg.words:
                for w in seg.words:
                    word_obj = {
                        "word": w.word.strip(),
                        "startMs": int(round(w.start * 1000.0)),
                        "endMs": int(round(w.end * 1000.0)),
                        "probability": float(getattr(w, 'probability', 1.0))
                    }
                    words_data.append(word_obj)
                    all_words.append(word_obj)

            collected_segments.append({
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip(),
                "words": words_data
            })

            if total_duration > 0:
                pct = min(85, 10 + int((seg.end / total_duration) * 75))
                emit("progress", percent=pct, stage=f"Đang phiên âm: {format_timestamp(seg.end)} / {format_timestamp(total_duration)}")

    except Exception as e:
        emit("error", message=f"Lỗi trong quá trình phiên âm Faster-Whisper: {str(e)}")
        sys.exit(4)

    # 4. Speaker Diarization if requested
    distinct_speakers = set()
    if args.diarize and collected_segments:
        emit("progress", percent=88, stage="Đang phân tích và gắn nhãn người nói (Diarization)...")
        intervals = None
        if args.hf_token:
            intervals = run_diarization_pyannote(audio_path, args.hf_token, args.num_speakers)

        if intervals:
            for seg in collected_segments:
                spk = match_speaker_to_segment(seg["start"], seg["end"], intervals)
                seg["speaker"] = spk
                distinct_speakers.add(spk)
                for w in seg["words"]:
                    w["speaker"] = spk
        else:
            # Standalone acoustic clustering fallback
            cluster_labels = run_standalone_clustering(audio_path, collected_segments, args.num_speakers or 2)
            for i, seg in enumerate(collected_segments):
                spk = cluster_labels[i] if i < len(cluster_labels) else "SPEAKER_00"
                seg["speaker"] = spk
                distinct_speakers.add(spk)
                for w in seg["words"]:
                    w["speaker"] = spk
    elif collected_segments:
        # Default single speaker if not diarizing
        distinct_speakers.add("SPEAKER_00")

    # 5. Natural Word-Level Segmentation & Write SRT File
    emit("progress", percent=95, stage="Đang xuất file phụ đề SRT tự nhiên...")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    if all_words:
        final_segments = segment_words_naturally(all_words, max_chars_per_line=37)
    else:
        final_segments = collected_segments

    with open(output_path, "w", encoding="utf-8") as srt_file:
        for idx, seg in enumerate(final_segments):
            start_str = format_timestamp(seg["start"])
            end_str = format_timestamp(seg["end"])
            text = seg["text"]
            
            if args.diarize and "speaker" in seg and seg["speaker"]:
                line_content = f"[{seg['speaker']}]: {text}"
            else:
                line_content = text

            srt_file.write(f"{idx + 1}\n{start_str} --> {end_str}\n{line_content}\n\n")

    emit(
        "done",
        srtPath=output_path,
        speakers=sorted(list(distinct_speakers)),
        segmentCount=len(final_segments),
        words=all_words
    )
    sys.exit(0)

if __name__ == "__main__":
    main()
