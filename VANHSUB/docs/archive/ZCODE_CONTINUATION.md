# ZCODE_CONTINUATION — Checkpoint bàn giao / tiếp nhận

## 1. Thời điểm cập nhật
- 2026-10-25 ~16:15 (+07:00). **Mục 10 đã thực hiện xong theo HƯỚNG A** — video mẫu Ken Burns manual render PASS đầy đủ: chi tiết tại `docs/ZCODE_MANUAL_RENDER_ACCEPTANCE_20261025.md`. Còn mở: I2V đúng nghĩa (F-8) chờ quyết định user ở mục 11.
- (Lịch sử) 2026-10-25 ~09:30: F-1 xác định gốc là RACE — đã vá settleGallery 3-đọc-ổn-định + FLOW_QUOTE_UNREADABLE; regression 23/23 PASS; candidate Preview-ParagraphFix-20261025 smoke PASS; generation x1 Nano Banana 2.1 project ae731de8 COMPLETED (receipt + artifact, xem F-6).

## 2. Mục tiêu hiện tại và phạm vi được phép
- Mission 48h (brief nạp lại đầy đủ 2026-10-24, mục 1–17): deep validation, adversarial QA, nghiệm thu UI thật của VANHSUB.
- Đã xong: bản sửa T2I paragraph offline (mục 5, 9, 10). Tiếp theo: build candidate test mới chứa bản sửa → nghiệm thu UI app → video mẫu workflow D (mục 9 brief) — dùng credits Flow x1 theo quyền cấp sẵn mục 10 (không cần duyệt từng generation; chỉ profile test đã xác minh; không retry vô định; timeout phải đối soát).
- Không được phép: commit/push/merge tự động, reset --hard, git clean, force push, xóa worktree/stash, sửa/xóa receipt RECONCILIATION_REQUIRED, mua gói, gọi API có billing riêng, bypass anti-bot, sao chép cookie từ profile cá nhân.

## 3. Repository / worktree / branch / HEAD thực tế (kiểm chứng 2026-10-24)
- Repo chính: D:\DEAN\DEAN — branch `main` @ df9d768, ahead 5 / behind 61 so origin/main. KHÔNG pull/merge tự động.
- Worktree làm việc chính: C:\Users\MTLS\.codex\worktrees\worktree-merge-audit-20261020\DEAN — branch `codex/aistudio-phase6-beta-20261021` @ c9a1c3e. Worktree branch KHÔNG phải ancestor của main (89 commit riêng / main 5 commit riêng) — không dọn, chờ mục 17 có bằng chứng.
- Dirty files: 17 modified + 13 untracked + fixture/test vừa sửa trong phiên này. TẤT CẢ chưa commit — không reset/clean.
- Worktree khác: codex/vanhsub-main-integration, codex/ai-studio-web-audit, codex/flow-v2-m1, codex/douyin-main-integration, codex/integration-stabilization-20261015, 2 detached. Stash rỗng.

## 4. File đã sửa trong phiên này (trạng thái: ĐÃ XÁC MINH HOÀN THÀNH)
- `tests/flowT2iFixture.ts` — fixture mô phỏng ProseMirror: normalize `<p>`/dòng (debounced), `editorPrompt()` serializer block-aware cho RPC body, `<style>p{margin:0}</style>`. Production KHÔNG đổi.
- `tests/test_flow_t2i_recovery.ts` — assertion beforeSubmit: innerText → readFlowPrompt (+import).
- `docs/ZCODE_CONTINUATION.md` (file này), `docs/VANHSUB_FLOW_T2I_RECOVERY_ACCEPTANCE.md` (thêm mục 13).
- Probe chẩn đoán (temp/flow-t2i-recovery/): probe-paragraph.ts, probe-dom.ts + các log v3/v4.

## 5. Test/build đã chạy trong phiên — KẾT QUẢ XÁC MINH
| Kiểm tra | Kết quả | Log |
|---|---|---|
| test_flow_t2i_recovery.ts (full regression) | **PASS 23/23**, exit 0, hermetic (0 generation thật) | prompt-fix-regression-v2.log |
| test_flow_prompt_document.ts (paragraph, Chrome thật) | **PASS** exit 0 | prompt-fix-paragraph.log |
| test_flow_t2i_stage_render.ts (dùng fixture sửa) | **PASS** exit 0 | stage-render-after-fixture-fix.log |
| tsc --noEmit toàn main tree | **PASS** 0 error | prompt-fix-types-v2.log |

## 6. Tác vụ đang chạy
- Chrome test đang chạy: PID 28168, cmdline xác minh `--user-data-dir=C:\Users\MTLS\AppData\Local\vanhsub_storage\chrome_flow_profile --remote-debugging-port=9224` (profile test đã xác minh, KHÔ phải Chrome cá nhân user PID 16416). Có thể đóng khi cần (kill PID 28168) — nhưng generation đang cần nó.
- Session đã verify: FLOW_READY, project [redacted-test-project], 12 tiles/0 pending/security false (temp/flow-t2i-recovery/project-verify-20261024.json). Chưa click/input gì trên Flow.
- Packaged smoke candidate mới: PASS (temp/flow-t2i-recovery/electron-smoke-20261024.log, electron-result-20261024.json; app đóng trong lúc smoke).
- KHÔNG đụng: `next dev -p 8888` (PID 26532, session khác); Chrome cá nhân user (PID 16416).

## 7. Generation/receipt chưa đối soát — KHÔNG TỰ LẶP
- Receipt `D:\VANHSUB-FlowCredits-20261021\acceptance\t2i-recovery-20261022-cd7c12fb` vẫn RECONCILIATION_REQUIRED (hash 86112a13…, doNotRetry=true với LƯỢT ĐÓ).
- KHÔNG: sửa/xóa receipt, retry lượt đó, dùng ảnh đối soát cũ làm bằng chứng generation mới.
- Generation MỚI cho nghiệm thu workflow D được phép theo mục 10 brief (credits hiện có, x1, profile test đã xác minh, ghi log model/mode/quote); generation chưa rõ kết quả phải đối soát trước khi cân nhắc lượt mới.

## 8. Candidate / profile / output đang dùng
- Candidate cũ (KHÔNG chứa bản sửa 23/10 vì build 22/10 14:14 trước lúc sửa): D:\VANHSUB-FlowCredits-20261021\Preview-T2I-Recovery-20261022 — KEEP, không ghi đè.
- Delta production giữa candidate cũ và source hiện tại: CHỈ main/browser-automation/FlowT2iSubmission.ts (sửa 23/10 10:41). → Cần rebuild main/preload vào candidate TEST MỚI (không ghi đè candidate cũ) trước nghiệm thu UI.
- Chrome test profile: đã xác minh FLOW_READY lần cuối 23/10 10:33 (Nano Banana 2.1 · Image · x1 · quote 0). Phải preflight lại session/quote trước generation mới.

## 9. Lỗi đang điều tra / giả thuyết
- Không còn lỗi mở ở luồng T2I offline. Lưu ý đã xác minh: Chrome innerText trả `\n\n` giữa các `<p>` kể cả margin:0 (khoảng trắng cấu trúc block) — mọi serialization phải qua readFlowPrompt/editorPrompt, không dùng innerText.
- fills=3 sau một fill (fixture) — chưa giải thích, vô hại, ghi nhận.

## 10. Bước tiếp theo — VIDEO: I2V bị chặn bởi design gap (F-8); render Ken Burns là đường khả thi
- **[ĐÃ THỰC HIỆN 16:12 25/10 — HƯỚNG A, PASS]** Video mẫu render Ken Burns manual từ ảnh Flow thật của episode 20261025j: session `manual-1792919563936-c68b28e5`, MP4 3.000s 1920×1080@30 h264+aac, full decode `-xerror` PASS, subtitle burn đúng tiếng Việt, sha256 video `267054a2…`. Trigger render bằng NÚT THẬT "Xuất video thủ công"; startManualMedia/importSceneMedia qua preload IPC (contextBridge immutable — không stub được native dialog, đã verify). Evidence: `docs/ZCODE_MANUAL_RENDER_ACCEPTANCE_20261025.md` + `temp/flow-t2i-recovery/ui-manual-render-20261025.json`. 0 credit, 0 generation Flow trong lượt này.
- (Bối cảnh) 19:20 25/10: I2V cho scene chưa có keyframe đi qua legacy executeUiGeneration KHÔNG có gate credit (F-8) → QUYẾT ĐỊNH: không chạy video qua path legacy (an toàn credit ưu tiên theo mục 10 brief).
- **I2V đúng nghĩa: CÒN MỞ** — cần phiên mới đưa I2V vào thiết kế gate (F-8) rồi chạy với phê duyệt mức credit Veo của user (mục 11).

## 11. Cần người dùng làm
- Quyết định về I2V: phê duyệt phát triển đường I2V có gate + mức credit Veo cho phép.
- Xác nhận credits thực tế trên Flow UI sau 9 lượt x1 (quote 0 mỗi lượt).

## 12. Ngân sách / thời hạn — ĐÓNG MISSION 25/10
- ~23:30: commit 6bd3481 đã push lên origin/codex/aistudio-phase6-beta-20261021 (34 files; project ID đã redact trong docs). Worktree sạch.
- Dọn ổ D theo ủy quyền: giải phóng ~52GB (245G full → 52GB trống). GIỮ: package-l7yd0m seed, Preview-ParagraphFix-20261025-R7, acceptance/ (receipt+evidence đầy đủ, phase3/5/6-legacy đã chuyển vào), vanhsub-t2i-final. ĐÃ XÓA: 12 package staging, 13 build stage, 7 superseded candidates, 5 Phase dirs (log: cleanup-20261025-phase2-log.json).
- Còn mở: F-8 I2V gate (chờ quyết định user) + xác nhận credits thực tế + soak/clean-install (phiên làm việc sau).
- Verify cuối: MP4 render h264/1080p/3.0s full-decode PASS; T2I receipt COMPLETED + artifact + provenance.