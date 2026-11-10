# VANHSUB — Integration test matrix, 2026-10-15

## OCR follow-up — 2026-10-16

Đã tái hiện trên bản đóng gói việc OCR chạy lại thất bại làm mất6 tham chiếu đầu ra, xóa 1 file TTS và để lại thư mục khung nếu video hỏng. 884591d giữ artifact cũ đến khi thành công, dọn khung khi lỗi/hủy và cho phép dừng FFmpeg đang trích khung.5 ca packaged PASS: thiếu Python, video hỏng, hủy 275 ms/worker thoát, chạy lại và PaddleOCR thật từ model có sẵn nhận đúng chữ Latin. Không suy thành clean-host/dual-engine hoặc Live Provider PASS.

46 suite offline/loopback PASS; targeted OCR cũng PASS trên dependency snapshot riêng. Full NSIS rebuild, main/renderer types và 20 UI/runtime checks PASS. Source/config và 8 file Extension đóng gói khớp hash. Môi trường/Flow chưa thay đổi: Clean Installation BLOCKED, live NOT TESTED/0 generation. Có [bộ hướng dẫn VM](CODEX_CLEAN_WINDOWS_ACCEPTANCE.md); chưa chạy installer. [Evidence mới](rc-evidence/2026-10-16/README.md). Các số45suite và metric lần trước bên dưới là hồ sơ lịch sử; **NOT READY, chưa merge main**.

## RC update —2026-10-16

Tiếp tục cùng nhánh tích hợp; origin/main vẫn899088f và main chưa đổi. Đợt RC bổ sung extension 1.0.8 có pairing/revoke, HMAC xác thực hai chiều protocol 2 (nonce/cổng/Origin, khóa DPAPI) và response binding, IPC payload bounds/schemas, media grants, migration secret hiện hành bằng DPAPI, extension resources cho bộ cài, editor100dòng/trang và sửa TTS cancel/retry/giữ artifact tốt. Đường SRT junction/physical dùng chung owner/lease/invalidation.

Kết quả mới:45 suite offline/loopback, full clean-dependency production/NSIS build, main/renderer typechecks và20 packaged UI/runtime checks theo phạm vi ghi trong báo cáo RC. Actual packaged ASR, TTS/dịch qua HTTP local có kiểm soát, checkpoint resume, concurrency, Unicode export và hard-crash đúng main PID có evidence riêng. Không tính synthetic peer/provider là Live Provider PASS.

Production scan hiện0; full toolchain8 High/8 Moderate/0 Critical. Electron 43.5.0 và Next 16.3.8 được vá riêng; nodejs-whisper giữ version cũ nhưng chuyển build-only và không ship JS wrapper/chain. Không tuyên bố zero security risk. Clean Windows installation BLOCKED; Flow live NOT TESTED/0 generation; multi-hour/all-job acceptance còn mở. **Verdict: NOT READY, không đề xuất merge main.**

Nguồn hiện hành: [RC acceptance](CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md), [RC evidence](rc-evidence/2026-10-15/README.md). Phần integration bên dưới là hồ sơ2026-10-15; các con số/version/trạng thái cũ được thay bằng kết quả RC ở trên.

## Integration record —2026-10-15 (historical)

Source branch `codex/integration-stabilization-20261015`, based on `origin/main=899088f`. [Final offline results](integration-evidence/2026-10-15/regression-final.json), [evidence notes](integration-evidence/2026-10-15/README.md). PASS chỉ áp dụng phạm vi mô tả; không đếm suite/assertion thay thế coverage.

## Phân loại acceptance

- **Automated Test PASS**: offline unit/integration/FS/native-fixture tests; provider stub vẫn là offline.
- **Real Runtime PASS**: process/app/native chạy thật, có thể dùng input tổng hợp; không suy provider live từ đó.
- **UI E2E PASS (scoped)**: các tương tác hiển thị/điều hướng/restart được nêu; setup một số task/project qua preload IPC, chưa toàn bộ form bằng click.
- **Live Provider PASS**: chỉ khi request đến provider thật có output được xác minh. Đợt này **không có**.
- **NOT TESTED**: chưa chạy. **BLOCKED/DEFERRED**: cần điều kiện ngoài hiện tại hoặc user đã hoãn live test.

## Build, runtime và UI

| Hạng mục | Phân loại / kết quả | Bằng chứng và giới hạn |
|---|---|---|
| Main `tsc --noEmit --incremental false` | Static PASS | Clean build workspace, final source; full build cũng compile main |
| Renderer `tsc --noEmit --incremental false -p renderer/tsconfig.json` | Static PASS | Final source; Next production typecheck PASS |
| `npm ci --ignore-scripts` riêng + `npm run build` | Automated Build PASS | build-results.json, production-build.log; full Turbopack/CMake/main/NSIS, không workaround Webpack riêng |
| Final full rebuild sau stale-project guard | Automated Build PASS | build-final-result.json, production-build-final.log;248 application source/config hashes khớp source-integrity.json |
| Package archive/native inventory | Automated + Real Runtime PASS | package-module-presence-clean.json:7 modules,3 binaries exit0. FFmpeg2018/FFprobe2023; chưa thay binary hoặc chứng nhận mọi codec |
| Actual unpacked Electron EXE | Real Runtime PASS / scoped UI E2E PASS | runtime-packaged.json:14 reported checks, errors/pageErrors rỗng;6 routes, visible editor1.000 lines, task/SRT/project/settings restart |
| IPC trust boundary | Real Runtime PASS | BrowserWindow khác dùng cùng preload bị deny; app renderer đúng được get/create/save qua IPC |
| CSP enforcement | Real Runtime PASS | Injected inline script bị Chromium chặn; expected CSP violation được lưu riêng, không bỏ qua console errors chung |
| Windows DPAPI | Real Runtime PASS | Synthetic key không lưu plaintext/headless, decrypt đúng sau restart; không đọc key thật |
| Ordinary close | Real Runtime PASS | process-after-close.json:4sampled PIDs không còn tồn tại; không phải active-job quit test |
| Local ASR | Real Runtime PASS | real-asr.json: TaskRunner/extraction + packaged Whisper tiny/public JFK WAV có country keyword/ordered subtitles;1 block,5.037 ms toàn test. Không accuracy benchmark/live cloud |
| Native Whisper cancel | Real Runtime PASS | Real child đã spawn;2 observed native PIDs đều thoát sau inference/cancel; model đã có,0 network downloads |
| FFmpeg export cancel | Real Runtime PASS | real-export-cancel.json: actual FFmpeg worker observed/exited, partial dọn, output cũ giữ;672 ms toàn test |
| UI screenshot | UI E2E PASS (scoped) | runtime-large-editor.png đã xem:1.000 line editor/preview, không thấy overlap trong mẫu cửa sổ; settings screenshot riêng. Không full UX QA |
| Performance | MEASURED, not a readiness PASS | performance-summary.json: final startup1.020 ms; editor3.412 ms; RAM sample max1.483,13 MiB→838,47 MiB/30s.180s idle trước final guard740,64→595,26 MiB. CPU tổng các process/5s samples; không disk/multi-hour/active-job peak |
| Installer trên clean Windows/VM | NOT TESTED | NSIS tạo được172.510.930 bytes/NotSigned; không cài lên máy user để thay clean-host acceptance |
| Active-job app quit / OS crash recovery | NOT TESTED | Ordinary restart, offline lease/recovery và explicit native cancel không thay OS interruption |

## Offline regression:38 suite PASS

Allowlist `scripts/audit_regression.cjs` giới hạn mỗi child120s và không chạy các file có tên live một cách mù. Chạy trong snapshot có dependencies sạch; sau khi bổ sung extension fixture còn thiếu đã chạy lại2 suite bị ảnh hưởng và shared-registry assertion. Sau application edit cuối đã chạy lại project media/session isolation/session config. Kết quả cuối là tập evidence có ghi rõ các lần chạy lại, không nói một lần chạy đầu đã PASS hết.

Các suite sau dùng fixtures/provider stub trừ FFmpeg/FS/socket được nêu trong log. Tên suite không nâng classification thành live.

| Suite | Result |
|---|---|
| tests/test_media_validator_ffmpeg_decoding.ts | PASS |
| tests/test_video_processor_concat.ts | PASS |
| tests/test_timeline_export_duration_guard.ts | PASS |
| tests/test_project_media_isolation_regression.ts | PASS |
| tests/test_tts_timing_adaptation.ts | PASS |
| tests/test_flow_project_isolation.ts | PASS |
| tests/test_full_audit_flow_tabs.ts | PASS |
| tests/test_srt_ocr_normalizer_and_translation.ts | PASS |
| tests/test_full_audit_security.ts | PASS |
| tests/test_full_audit_data_integrity.ts | PASS |
| tests/test_ai_studio_script_evaluation.ts | PASS |
| tests/test_ai_studio_script_refinement.ts | PASS |
| tests/test_full_audit_script_artifacts.ts | PASS |
| tests/test_ai_studio_session_isolation.ts | PASS |
| tests/test_ai_studio_session_config.ts | PASS |
| tests/test_ai_studio_session_operations.ts | PASS |
| tests/test_ai_studio_script_invalidation.ts | PASS |
| tests/test_ai_studio_channel_settings.ts | PASS |
| tests/test_ai_studio_render_timeline.ts | PASS |
| tests/test_ai_studio_bgm_audio.ts | PASS |
| tests/test_ai_studio_tts_alignment.ts | PASS |
| tests/test_ai_studio_visual_directions.ts | PASS |
| tests/test_ai_studio_storyboard_modes.ts | PASS |
| tests/test_ai_studio_media_import.ts | PASS |
| tests/test_ai_studio_visual_jobs.ts | PASS |
| tests/test_standard_project_directory_isolation.ts | PASS |
| tests/test_legacy_project_collision_guard.ts | PASS |
| tests/test_subtitle_artifact_invalidation.ts | PASS |
| tests/test_task_configuration_defaults.ts | PASS |
| tests/test_task_operation_exclusion.ts | PASS |
| tests/test_shared_dubbing_preferences.ts | PASS |
| tests/test_tts_group_regeneration.ts | PASS |
| tests/test_dubbed_subtitle_export.ts | PASS |
| tests/test_export_resolution_and_silent_softsub.ts | PASS |
| tests/test_video_stretch_timeline_sync.ts | PASS |
| tests/test_chatgpt_script_collector.ts | PASS |
| tests/test_integration_security_storage.ts | PASS |
| tests/test_integration_http_dependency.ts | PASS |

Trong nhóm trên: media validator decode thật, concat3 clip→12,00s, timeline freeze19,000s; render30/60 FPS/4K/colors/narration/BGM; silent-softsub/dubbed-subtitles/video stretch chạy FFmpeg thật. TTS timing/alignment/rate/shortening/provider response vẫn dùng fixtures/stub; không tự nhận là synthesis live. Data integrity có real FS/atomic fault injection/deferred node/cancel/lease; Flow tab tests chạy VM, không điều khiển Chrome thật.

## Toàn bộ workflow acceptance còn lại

| Luồng | Automated Test | Real Runtime | Live Provider | UI E2E |
|---|---|---|---|---|
| Import video / SRT | PASS | PASS video/SRT fixture qua IPC | Không áp dụng local; live download NOT TESTED | PASS scoped preview/editor, full dialog NOT TESTED |
| ASR / OCR | PASS parser/failure preservation | PASS local Whisper; OCR/Python NOT TESTED | NOT TESTED cloud | Full ASR/OCR click flow NOT TESTED |
| Translation | PASS mocked contracts/order/failure safety | Network provider NOT TESTED | NOT TESTED | Full translation flow NOT TESTED |
| TTS / dubbing | PASS groups/cache/timing/export fixtures | PASS audio render fixture; provider synthesis NOT TESTED | NOT TESTED | Full voice selection/synthesis/cancel NOT TESTED |
| Timing / export | PASS actual FFmpeg render tests | PASS local render/cancel | Flow media NOT TESTED | Route smoke PASS, full options/export UI NOT TESTED |
| AI Studio project/storyboard | PASS owner/snapshot/stage/shot modes | PASS project save/reopen IPC | NOT TESTED full8 stage | Route smoke PASS, full wizard NOT TESTED |
| Flow image/video | PASS source/VM routing/ownership | Previous handshake only; current generation BLOCKED | BLOCKED/DEFERRED,0 generation | NOT TESTED |
| Workflow AI | PASS local node lease/cleanup | PASS local FS/execution fixtures | NOT TESTED provider DAG | Route smoke PASS, full authoring NOT TESTED |
| Save/resume/cancel/recovery | PASS fixtures | PASS task/SRT/project/settings restart and Whisper/FFmpeg cancel | Reconnect/cancel paid provider NOT TESTED | PASS scoped navigation/restart; all error dialogs NOT TESTED |
| Concurrent/large/long sessions | PASS exclusion/deferred fixtures | MEASURED1.000 lines,30/180s idle | NOT TESTED concurrency live |1.000 line editor PASS; multi-hour use NOT TESTED |

Flow đang có extension1.0.6 trước đó nhưng chưa dedicated CDP9224, source patch1.0.7 chưa được xác nhận đang nạp. User đã chọn tạm ghi live chưa hoàn tất. Không gửi generation, không tiêu credit từ audit. Runner cũ có page/gallery `.first()` không được dùng làm acceptance.

## Failures được giữ để review

- `regression-before-fixture-sync.json`/`regression.json`: initial2fail do snapshot chưa có extension/background.js; bổ sung fixtures + rerun, không xóa test.
- `runtime-harness-first-failure.json`: Electron43 app.evaluate không có require; harness dùng process.getBuiltinModule sau đó.
- `runtime-large-selector-harness-failure.json`: selector tính cả hidden route selects; sửa kiểm tra visible selector và chờ dòng cuối, không `.first()` để che ambiguity.
- Bằng chứng build junction và audit15 suite trước integration vẫn ở audit-evidence; không dùng làm final-source PASS.
