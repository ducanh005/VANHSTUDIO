# ZCODE_MANUAL_RENDER_ACCEPTANCE_20261025 — Nghiệm thu "video mẫu" đường Ken Burns (mục 10 continuation)

> Ngày: 2026-10-25 ~16:15 (+07:00). Thực hiện bởi phiên ZCode mới theo `docs/ZCODE_CONTINUATION.md` mục 10, **hướng A** (render Ken Burns manual). Không audit lại, không chạy lại test đã PASS của các phiên trước.

## 1. Quyết định chọn đường

- Mục 10 đưa ra 2 đường: (A) render Ken Burns manual từ ảnh Flow thật — khả thi ngay, không tốn credit; (B) I2V đúng nghĩa — bị chặn bởi F-8 (legacy `executeUiGeneration` không có gate credit) và cần phê duyệt mức credit Veo của user (mục 11).
- **Đã chọn A** vì: doc đã tự ra quyết định "không chạy video qua path legacy" (an toàn credit); B không thể tự chạy khi thiếu phê duyệt; A cho sản phẩm kiểm chứng được tức thì.

## 2. Điều kiện đầu vào (episode 20261025j)

- Ảnh Flow thật từ acceptance `ui-paragraphfix-20261025j` (receipt COMPLETED, provenance `google_flow_ui`, assetId `85fe5ead-1a47-4004-a6ef-bd4905d96793`, project Flow `ae731de8`).
- `sha256` ảnh: `00d44bb9125657c80ff054f1440efd59399fa5e3ef2d2a084fc176c82bd4f248` — xác minh khớp trước/sau copy và sau import (không đổi).
- SRT tác giả từ `lineText`/timing của scene 20261025j: `00:00:00,000 --> 00:00:03,000` — "Ba chú robot hình học thân thiện đang thi đấu cờ vua."
- Audio fixture ffmpeg: sine 440Hz 3.000s pcm_s16le 44.1kHz mono, full decode PASS.

## 3. Luồng đã chạy (packaged candidate Preview-ParagraphFix-20261025-R7, profile cách ly mới)

| Bước | Cách trigger | Kết quả |
|---|---|---|
| Nhập SRT + audio (startManualMedia) | IPC preload (cùng handler với nút UI)¹ | Session `manual-1792919563936-c68b28e5`, scene pending/ken_burns, audio copy vào `02_voice/narration.wav`, SRT vào `03_timing/manual.srt` |
| Nhập ảnh Flow (importSceneMedia) | IPC preload (cùng handler với nút UI)¹ | Scene `ready`, provenance `manual_import`, sha256 giữ nguyên |
| Xuất video thủ công | **NÚT THẬT** trong view sau reload | Status `completed`, progress 100, stage 6+7 success, MP4 xuất |

¹ contextBridge verified **immutable** (thử ghi đè dialog stub 16:10 thất bại im lặng) → 2 bước cần native dialog gọi thẳng IPC; toàn bộ validation của engine vẫn chạy thật (parseSrtStrict, full decode audio, đối chiếu duration ±750ms, grant `outputDir`).

## 4. Kết quả kiểm định MP4

- File: `D:\VANHSUB-FlowCredits-20261021\acceptance\ui-manual-render-20261025\project-output\sessions\manual-1792919563936-c68b28e5\assets\final_video_1792919574038.mp4`
- Duration **3.000000s** (khớp SRT/audio; 90 frames @ 30fps), **1920×1080 h264 + aac**, 1.36 MB.
- **Full decode PASS** với `ffmpeg -v error -xerror -i <mp4> -f null -` (exit 0, không một warning).
- `sha256` video: `267054a27ce741a054aa822cce132fc60567a84cb9ab419921721369008f0586`.
- Frame 1.5s (`temp/flow-t2i-recovery/ui-mr-mid-frame.png`): đúng nội dung ảnh Flow (3 robot chơi cờ vua, xanh/cam editorial illustration, không text/watermark), ken_burns zoom, **phụ đề burn đúng tiếng Việt có dấu**.
- Checkpoint: `Beta-Profile/studio/sessions/manual-1792919563936-c68b28e5.json` — status completed.

## 5. Giới hạn phải ghi rõ (không được đọc là I2V PASS)

- Đây là **render Ken Burns từ ảnh tĩnh Flow** — KHÔNG phải video Flow I2V, KHÔNG gọi provider generation nào trong lượt này (manualMode chặn provider), 0 credit tiêu.
- F-8 (design gap gate credit cho I2V/video) **vẫn mở** — quyết định thuộc mục 11 của continuation doc (user phê duyệt phát triển gate + mức credit Veo).
- Audio là fixture (sine), không phải TTS — luồng voice/piper không nằm trong phạm vi lượt này.

## 6. Evidence index

- Script drive: `temp/flow-t2i-recovery/ui-manual-render-20261025.cjs` (worktree)
- Evidence JSON: `temp/flow-t2i-recovery/ui-manual-render-20261025.json`
- Screenshots: `temp/flow-t2i-recovery/ui-mr-01-workspace.png` → `ui-mr-04-after-render.png`; frame kiểm định `ui-mr-mid-frame.png`
- App main log: `temp/flow-t2i-recovery/ui-manual-render-main.log`
- Thư mục acceptance: `D:\VANHSUB-FlowCredits-20261021\acceptance\ui-manual-render-20261025\` (Beta-Profile + project-output inputs/session)
