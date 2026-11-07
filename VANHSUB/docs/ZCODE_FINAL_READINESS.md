# ZCODE_FINAL_READINESS — Báo cáo cuối mission 48h (25/10/2026, ~23:00 +07:00)

Phạm vi bằng chứng: worktree `codex/aistudio-phase6-beta-20261021` @ c9a1c3e + candidates `Preview-ParagraphFix-20261025-R5/R7`. Không commit/push.

## 1. Workflow thật đã hoàn thành (đường dẫn output)
- **T2I qua UI packaged app (R7)** — Duyệt → generation Flow thật → download/native validation/publish → receipt COMPLETED (`acceptance/ui-paragraphfix-20261025j/project-output/.flow-receipts/`), artifact `05_media/scene_scene1_cb9158bc-….jpg` (329.986 bytes, sha `00d44bb9…`), provenance `google_flow_ui` đầy đủ, scene ready.
- **Source end-to-end T2I** — receipt `b88e1b2a…` COMPLETED, artifact `diagscene.jpg` (296.283 bytes, sha `0bb717e7…`), tile `97818cce…` trên Flow project `ae731de8-…`.
- **Render MP4 thủ công (hướng A)** — `acceptance/ui-manual-render-20261025/…/assets/final_video_1792919574038.mp4`: h264 1920×1080 + aac, 3.000000s, 90 frames, full decode `-v error -xerror` PASS (verify độc lập bởi phiên này), khung hình kiểm định khớp ảnh Flow (sha provenance `00d44bb9…`), phụ đề burn tiếng Việt có dấu. Import qua IPC cùng handler nút UI (contextBridge bất biến — đã ghi trong evidence); render là nút thật.
- **Ảnh Flow thật**: 9 lượt x1 ngày 25/10 (quote 0 mỗi lượt), 7 tile mới trên project `ae731de8-…`, tất cả receipt đối soát bằng evidence.

## 2. Lỗi tìm thấy (severity + trạng thái)
- **F-1 [Đã sửa]** Race đọc gallery/quote sau navigation (từng bị kết luận nhầm là DOM drift) — probe settle chứng minh; vá `settleGallery` 3-đọc + `FLOW_QUOTE_UNREADABLE`.
- **F-6 [Đã sửa]** Watcher post-click trip trên RPC thật: request shape `[[[prompt]]]`+BELUGA, response media 2-UUID + URL CDN, tile preview URL ≠ CDN URL — vá inspector dual-shape, parser assetId-từ-URL, correlation theo assetId, pre-click draft-ignore.
- **F-8 [MỞ — design gap P1]** I2V/video cho scene chưa có keyframe đi qua legacy `executeUiGeneration` không có gate credit. KHÔNG chạy trong mission (an toàn credit). Chờ quyết định user.
- **F-2/F-3/F-5 [Ghi nhận]** innerText `\n\n` cấu trúc; fixture phải mô phỏng ProseMirror; mọi serialization prompt phải qua `readFlowPrompt`.
- **F-7 [Đã vá]** Download allowlist thiếu `flow.google.com`.

## 3. Đã sửa + verification
- `FlowT2iSubmission.ts` (settle, lineCanonical, inspector dual-shape, response parser URL-assetId, correlation, pre-click ignore, error 103 có condition states), `AiStudioVisualService.ts` (quote guard), `FlowImageArtifact.ts` (allowlist), `flowT2iFixture.ts` (ProseMirror-mimic + real RPC shape), `test_flow_t2i_recovery.ts` (assertion readFlowPrompt). Verification: regression 23/23 PASS (regression-v19.log), paragraph PASS, stage-render PASS, tsc 0, và **source end-to-end COMPLETED** + **UI packaged COMPLETED** (mục 1).

## 4. Chưa sửa / bất định
- **F-8** (trên). **Clean Windows install: BLOCKED** (không có VM sạch). **Soak/performance: NOT TESTED** (không đo số liệu nào — không tuyên bố memory/timing). **LLM script generation**: chưa test (cần Gemini Web đăng nhập). **7 receipt RECONCILIATION_REQUIRED** (25/25b/c/e/f/h/i): đối soát bằng Flow-side evidence, credits thực tế chờ user xác nhận trên Flow UI. **Native installer/NSIS + clean machine**: NOT TESTED.

## 5. Tách biệt bằng chứng
- **UI E2E (packaged)**: T2I COMPLETED (mục 1) + manual render COMPLETED. **Native runtime**: FFprobe/FFmpeg full decode PASS (recovery suite + render). **Provider live**: T2I generation thật x9 (qua gate mới) — Live T2I PASS cho image; **I2V/video: NOT TESTED** (F-8). **Packaging**: directory build unsigned, smoke PASS; installer NOT TESTED.

## 6. Hiệu năng
- NOT TESTED (soak/RAM/timing chưa đo — không suy luận).

## 7. Coverage gaps
I2V có gate; clean install; installer; soak; workflow A/B/C (ASR/TTS/translate) không đụng tới trong mission này; Extension/Bridge flows; mutation/fuzz coverage theo mục 6 brief.

## 8. Git
Worktree `codex/aistudio-phase6-beta-20261021`, HEAD `c9a1c3e`, 32 dirty files (công việc + docs, chưa commit theo quy tắc).

## 9. INTERNAL BETA: **CONDITIONALLY READY**
Cơ sở: T2I UI + render MP4 accepted trên packaged app; regression hermetic mạnh. Điều kiện: F-8 phải được gate trước khi mở tính năng video cho người dùng; chạy soak + clean install; xác nhận credits thực tế.

## 10. PUBLIC RELEASE: **NOT READY**
Thiếu: installer đã ký + clean install, soak/perf, I2V gated, workflow A/B/C nghiệm thu lại trên bản packaged, Extension/Bridge re-verification.
