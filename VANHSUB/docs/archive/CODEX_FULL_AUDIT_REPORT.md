# VANHSUB — Post-audit application review, 2026-10-15

## OCR follow-up — 2026-10-16

Đã tái hiện trên bản đóng gói việc OCR chạy lại thất bại làm mất6 tham chiếu đầu ra, xóa 1 file TTS và để lại thư mục khung nếu video hỏng. 884591d giữ artifact cũ đến khi thành công, dọn khung khi lỗi/hủy và cho phép dừng FFmpeg đang trích khung.5 ca packaged PASS: thiếu Python, video hỏng, hủy 275 ms/worker thoát, chạy lại và PaddleOCR thật từ model có sẵn nhận đúng chữ Latin. Không suy thành clean-host/dual-engine hoặc Live Provider PASS.

46 suite offline/loopback PASS; targeted OCR cũng PASS trên dependency snapshot riêng. Full NSIS rebuild, main/renderer types và 20 UI/runtime checks PASS. Source/config và 8 file Extension đóng gói khớp hash. Môi trường/Flow chưa thay đổi: Clean Installation BLOCKED, live NOT TESTED/0 generation. Có [bộ hướng dẫn VM](CODEX_CLEAN_WINDOWS_ACCEPTANCE.md); chưa chạy installer. [Evidence mới](rc-evidence/2026-10-16/README.md). Các số45suite và metric lần trước bên dưới là hồ sơ lịch sử; **NOT READY, chưa merge main**.

## RC update —2026-10-16

Tiếp tục cùng nhánh tích hợp; origin/main vẫn899088f và main chưa đổi. Đợt RC bổ sung extension 1.0.8 có pairing/revoke, HMAC xác thực hai chiều protocol 2 (nonce/cổng/Origin, khóa DPAPI) và response binding, IPC payload bounds/schemas, media grants, migration secret hiện hành bằng DPAPI, extension resources cho bộ cài, editor100dòng/trang và sửa TTS cancel/retry/giữ artifact tốt. Đường SRT junction/physical dùng chung owner/lease/invalidation.

Kết quả mới:45 suite offline/loopback, full clean-dependency production/NSIS build, main/renderer typechecks và20 packaged UI/runtime checks theo phạm vi ghi trong báo cáo RC. Actual packaged ASR, TTS/dịch qua HTTP local có kiểm soát, checkpoint resume, concurrency, Unicode export và hard-crash đúng main PID có evidence riêng. Không tính synthetic peer/provider là Live Provider PASS.

Production scan hiện0; full toolchain8 High/8 Moderate/0 Critical. Electron 43.5.0 và Next 16.3.8 được vá riêng; nodejs-whisper giữ version cũ nhưng chuyển build-only và không ship JS wrapper/chain. Không tuyên bố zero security risk. Clean Windows installation BLOCKED; Flow live NOT TESTED/0 generation; multi-hour/all-job acceptance còn mở. **Verdict: NOT READY, không đề xuất merge main.**

Nguồn hiện hành: [RC acceptance](CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md), [RC evidence](rc-evidence/2026-10-15/README.md). Phần integration bên dưới là hồ sơ2026-10-15; các con số/version/trạng thái cũ được thay bằng kết quả RC ở trên.

## Integration record —2026-10-15 (historical)

## Kết luận hiện tại: NOT READY

Đã hợp nhất có chọn lọc trên `codex/integration-stabilization-20261015`, xuất phát từ `origin/main` (`899088f`). Toàn bộ 27 commit remote được giữ trong ancestry; các bản vá local/audit được đối chiếu theo hành vi, không chọn ours/theirs hàng loạt. Không merge hoặc ghi đè main. Chi tiết từng commit: [integration report](CODEX_INTEGRATION_REPORT.md).

**38 suite offline PASS**, full production build/NSIS PASS với dependencies cài riêng, executable thật chạy được trên máy dev. Whisper nhận dạng mẫu âm thanh thật và hủy native worker PASS; FFmpeg export/cancel và giữ bản xuất cũ PASS. UI/IPC/settings/project/restart/CSP/DPAPI và editor 1.000 dòng đã kiểm tra trên executable đóng gói. Những kết quả này không xác nhận provider live hay cài đặt Windows sạch.

Còn thiếu: Google Flow live, dịch/TTS/provider pipeline thật, OCR/Python/stems đầy đủ, installer trên Windows sạch, shutdown giữa mọi loại job, soak nhiều giờ, pairing bridge và giới hạn truy cập media. Scan còn 5 High/0 Critical. Editor 1.000 dòng có working set tổng đỉnh lấy mẫu **1.483,13 MiB**; cần tối ưu và đo lại.

Bản này thay thế các kết luận hiện hành trong báo cáo audit trước. Bằng chứng cũ giữ nguyên ở [audit-evidence](audit-evidence/2026-10-15/) và branch `codex/full-audit-20261015` (`f164e0f`). Bằng chứng integration mới ở [integration-evidence](integration-evidence/2026-10-15/README.md). Đọc cùng [risks](CODEX_RISK_REGISTER.md), [tests](CODEX_TEST_MATRIX.md), [readiness](CODEX_PRODUCTION_READINESS.md).

## Baseline và kiến trúc được giữ

Local main `df9d768` và remote `899088f` có common ancestor `f03de1c`, phân kỳ 5/27 commit; audit thêm 5 commit lên local. Re-fetch cuối vẫn `899088f`. Không suy tác giả agent từ Git author. Không reset/force push, không đổi checkout D, không đụng các script/temp/HAR chưa commit của người dùng.

Windows 10.0.26200, Node 24.19.0, Electron 43.4.1, Next 16.3.2, TypeScript 5.9.3. Dependencies của worktree C là junction sang D. Để xác minh build, tạo folder test riêng cùng ổ D, copy source/config có SHA256 manifest và chạy `npm ci` riêng, không sửa node_modules dùng chung. Đây vẫn là máy dev.

Renderer Next/React gọi preload → IPC main → task runners/AI Studio/WorkflowExecutionEngine → FFmpeg/Whisper/providers/browser/bridge → task store và project filesystem. `AiStudioPipelineEngine.ts` là engine thật; `pipelineEngine.ts` là entry/re-export. Giữ kiến trúc đang hoạt động, không xóa barrel/sidecar/test tool vì thiếu inbound import.

Origin có implementation mạnh hơn bản local ở task leases, episode workspace, config snapshot, production revision, sentence-group TTS, subtitle invalidation và shared preferences. Các implementation này được giữ; `taskLease.ts` dùng chung registry của `taskOperations.ts`. Không tạo hai hệ khóa độc lập.

## F01–F16: xác minh source cuối sau integration

PASS dưới đây là phạm vi test được nêu, không phải chứng nhận mọi provider/UI path. Các suite có trong [regression-final.json](integration-evidence/2026-10-15/regression-final.json).

| ID / mức | Source cuối và quyết định | Bằng chứng / giới hạn |
|---|---|---|
| F01 P0 | `main/utils/projectFolder.ts` giữ remote `createUniqueDirectory`, chặn legacy projectDir bị nhiều task nhận; không thay bằng allocator hash thứ hai | `test_standard_project_directory_isolation`, `test_legacy_project_collision_guard`, data integrity PASS; không tự migrate dữ liệu cũ |
| F02 P0 | `main/workflow/WorkflowStorageManager.ts`, `executionEngine.ts` giữ workflow/node leases đến actual promise settle; cleanup bỏ qua workspace đang dùng | Deferred node/cancel/duplicate/cleanup thật trên FS trong data integrity PASS; full provider DAG chưa chạy |
| F03 P0 | `main/ai-studio/storage/sessionWorkspace.ts` + engine pin workspace/media/owner; kiểm tra catalog, wrong ID/path và ambiguous legacy; checkpoint lỗi được báo | `test_ai_studio_session_isolation`, project media isolation, data integrity PASS; hai episode/restart/project switch |
| F04 P0 | `AiStudioDiskStorageManager.writeAtomic` chỉ temp+rename; lỗi rename không unlink/copy đè bản tốt. Checkpoint writer remote giữ nguyên | Inject EPERM/disk error PASS, bản đích nguyên vẹn, temp được dọn; hai file checkpoint chưa phải transaction chung (R14) |
| F05 P1 | `main/security/ipc.ts`, `rendererTrust.ts` và các IPC entry kiểm tra trusted WebContents/mainFrame/origin; giữ guards cả handlers mới từ remote | Negative cases PASS; executable thật từ chối BrowserWindow không được trust dù dùng cùng preload. Payload schema chưa phủ mọi channel |
| F06 P1 | `main/main.ts` mở Chrome bằng argv, shell:false; allowlist Flow URL, validate model name, containment app protocol | URL/scheme/userinfo/traversal tests PASS; không chứng nhận mọi đường local media (R08) |
| F07 P1 | `main/security/bridgeTransport.ts` kiểm tra extension Origin, loopback/maxPayload | Security suite PASS; handshake extension thật chỉ là bằng chứng audit cũ. Origin có thể giả, pairing chưa có (R07) |
| F08 P1 | `main/lib/taskOperations.ts` là registry duy nhất; queue reserve từ enqueue; release trong finally kể cả persistence lỗi; `taskLease.ts` re-export cùng registry | Task exclusion, data integrity và cross-module lock regression PASS; không chỉ hai test riêng với hai Map khác nhau |
| F09 P1 | ASR/translation chỉ invalidation sau success; output mới riêng; TTS UUID run directory + copy cache tương thích, giữ sentence-group regeneration từ remote | Failure preservation, subtitle invalidation, group regen/export PASS; real ASR và export cancel PASS. Network translation/TTS live chưa chạy |
| F10 P1 | `sessionOperations.ts` giữ AbortController/process-aware lease đến settle; engine kiểm tra stage/gate; fill-mode IPC dùng cùng lease và invalidate render | `test_ai_studio_session_operations`, session config, visual jobs PASS; provider bỏ qua abort vẫn giữ lock; OS crash giữa job chưa nghiệm thu |
| F11 P1 | Giữ remote provider evaluation/refinement + strict parsers, không replay implementation yếu hơn; đúng configured review provider | Script evaluation/refinement/channel settings PASS bằng provider stub; chất lượng LLM live NOT TESTED |
| F12 P1 | Giữ remote `sessionArtifacts.ts`, `scriptStorage.ts`, `sceneArtifacts.ts`: history, clear downstream pointers, tăng productionRevision, không xóa file cũ | Script invalidation/artifacts/media import/visual jobs PASS; regression guard giữ audio/video đúng revision |
| F13 P2 | Engine load báo running không có lease thành failed/recoverable; không tự chạy paid job; legacy workspace mơ hồ bị chặn | Restart fixture PASS; packaged restart giữ task/sub/project/settings PASS; app kill giữa job NOT TESTED |
| F14 P1 | `AiStudioTtsService.ts` reject missing/0/negative/nonfinite duration; giữ remote word-boundary/alignment, không dùng 5s giả | TTS alignment/data integrity PASS với probes/fixtures; forced alignment/nghe thực chưa nghiệm thu |
| F15 P1 | `main/security/logRedaction.ts`, logger dùng formatter chung trước console/file/IPC, chỉ app renderer nhận logs | Synthetic secret/Bearer/query/structured-key cases PASS; chuỗi bí mật không nhãn chưa có bảo đảm tuyệt đối |
| F16 P1 | `extension/background.js` createNew tạo tab owned mới, không chọn tab người dùng nền; manifest1.0.7 | VM tab-ownership tests PASS; extension đang chạy1.0.6 chưa được xác nhận nạp patch; Flow live chưa chạy |

## Bản vá bổ sung trong integration

- Chặn start khi projectId từ UI không còn là active project; giữ config snapshot/resume từ origin, không đọc global config thay snapshot. Test project switch và snapshot PASS.
- Fill mode xác thực enum/scene IDs, dùng session lease và invalidates output. Timeline guard tôn trọng 30/60 FPS; freeze theo yêu cầu rõ ràng, giữ hành vi loop mặc định cho narration tail khi không freeze.
- Secret mới mặc định fail closed nếu DPAPI không sẵn sàng hoặc encryption lỗi. Insecure base64 chỉ opt-in headless fixtures, không bật trong Electron. Packaged runtime đã xác minh ciphertext trên disk và decrypt sau restart bằng key tổng hợp. Legacy plaintext/base64 vẫn đọc được; chưa migrate/rotate hàng loạt.
- CSP cho HTML production hash inline Next bootstrap, không cho script unsafe-inline/unsafe-eval. Chromium thật chặn injected inline script; hydration/navigation/IPC không lỗi trong sample. Style inline và HTTPS/media/loopback WS còn được phép; chưa giải quyết media capability.
- Cập nhật có giới hạn axios 1.20.0, fast-uri 3.1.8, js-yaml 4.3.2, source-map-js 1.2.2. Không nâng framework/Whisper hàng loạt. Clean lockfile install, local HTTP redirect/binary/cancel và full native/package build PASS.

## Workflow và bằng chứng nghiệm thu

| Luồng | Kết quả thực tế | Chưa nghiệm thu |
|---|---|---|
| Import video / subtitle / project | Packaged renderer IPC tạo task với video fixture, import SRT, lưu AI Studio project, restart mở lại; UI editor hiển thị1.000 dòng | Download nhiều host, mọi codec và toàn bộ form/error dialogs |
| ASR/OCR | TaskRunner + packaged Whisper tiny chạy public JFK WAV thật, có subtitle/timing; real native cancellation PASS. OCR/SRT parser offline PASS | ASR nhiều ngôn ngữ, model download, OCR/Paddle/hybrid full video, Python clean-host |
| Translation | Strict parser/order/timestamp/error preservation regression PASS | Provider live, ngữ nghĩa, rate limit/retry thực |
| TTS/dubbing/timing | Sentence groups/cache/regeneration, subtitle invalidation, timing adaptation và audio/export fixtures PASS. TTS phụ đề tự thích nghi slot, tempo mặc định có giới hạn1.35, shortening opt-in | Provider live, nhiều giọng/ngôn ngữ, nghe kiểm tra mất câu/độ tự nhiên; Studio timeline theo audio không đồng nghĩa forced alignment |
| Export video | FFmpeg thật: concat12.00s, freeze timeline19.000s, dimensions/FPS/BGM/narration, silent softsub và dubbed subtitles PASS; actual worker cancel giữ output cũ | Mọi font/codec/VFR, full UI options/stems/CapCut import |
| AI Studio project/storyboard | Settings/project persistence qua IPC thật; config/owner/gate/shot/visual direction/revision tests PASS | Full8 stage provider pipeline từ UI |
| Google Flow image/video | Source/VM ownership/provenance/routing regression PASS | Live generation BLOCKED/DEFERRED; chưa có dedicated CDP9224 và patch đang nạp chưa xác minh;0 generation do audit gửi |
| Workflow AI | Actual local storage/execution leases/cleanup tests PASS; UI route mở được | Full graph authoring/provider DAG/error UI |
| Save/resume/cancel/recovery | Settings/task/SRT/project restart thật PASS; ASR/FFmpeg cancel thật PASS; deferred lease/snapshot/restart fixtures PASS | Quit/kill app giữa mọi loại job, resume sau OS crash, provider reconnect |

Không xóa nút hoặc chức năng chỉ từ tên/stub. Các entry Chrome/Sảnh Electron trỏ cơ chế khác nhau. Badge HOT/MỚI, modal/state và đường browser trùng ý nghĩa vẫn cần UX review riêng; smoke route không chứng minh mọi nút hợp lý.

## Build, security và hiệu năng

Full `npm run build` chuẩn trong snapshot cài dependencies riêng: Whisper CMake → Next Turbopack static export → main/preload → electron-builder NSIS đều exit0. Main/renderer TypeScript PASS. Manifest so248 application source/config files không có khác biệt với bản build cuối. Giới hạn junction C/D của checkout cũ không được coi đã sửa hoàn toàn chỉ bằng snapshot.

Installer172.510.930 bytes, Authenticode **NotSigned**. Unpacked executable chạy thật trên cùng host; installer chưa cài trên Windows sạch/VM. FFmpeg/FFprobe/Whisper phiên bản/help đều exit0, archive có đủ7 module được kiểm tra; không chứng minh mọi optional Python/native module.

| Phép đo | Kết quả | Giới hạn |
|---|---|---|
| Final packaged startup |1.020 ms | Một mẫu warm trên máy dev |
| Editor1.000 dòng / video1.000s128×72 |3.412 ms đến dòng cuối trong DOM, screenshot đã kiểm tra | Không phải project4K/thousands of media; chưa đo input latency |
| Sau editor,30s/6 mẫu |4 process; total working set1.483,13→838,47 MiB; CPU tổng sample max0,834% | Peak chỉ trong sample, không phải max toàn phiên; RAM cao cần tối ưu |
| Idle180s/36 mẫu |740,64→595,26 MiB; CPU tổng max0,95% | Trước bản guard start-project cuối; không phải soak nhiều giờ |
| Ordinary close |4 PID quan sát không còn tồn tại sau đóng | Không chứng nhận shutdown khi active job |
| Real local ASR |5.037 ms cả inference/cancel;1 subtitle block;2 native children đã thoát | Tiny/public English sample, không accuracy benchmark |
| Real FFmpeg cancel |672 ms cả test; worker đã chạy và thoát, partial dọn, output trước giữ | Không phải đo throughput xuất phim dài |

`npm audit --omit=dev`:9→**5 High/0 Critical**, là5 package bị đánh dấu trong cùng chain braces→micromatch→fast-glob→shelljs→nodejs-whisper, không phải5exploit riêng đã tái hiện. [Advisory braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) tại ngày kiểm tra chưa có patched version. Source ASR spawn trực tiếp whisper-cli thay JS shelljs wrapper; chưa tìm thấy import wrapper trong main, nhưng package vẫn có trong dependency/build, chưa đóng supply-chain/reachability risk. Không audit-fix downgrade mù.

## Các gate còn mở

1. Dedicated Flow test profile + extension1.0.7/CDP, bounded generation/provenance/download/cancel; không thao tác tab cá nhân hay bypass challenge.
2. Windows sạch/VM: installer, ký/phân phối, model/native/Python/fonts và restart/error UX.
3. Shutdown giữa ASR/OCR/TTS/export/Flow/workflow, browser ownership/disconnect, concurrent jobs và soak nhiều giờ; đo RAM/CPU/disk/child processes.
4. Pairing bridge, media capability/owner grants, per-channel payload schemas, legacy secret migration và checkpoint reconciliation hai file.
5. Dịch/TTS/provider pipeline live có budget; nghe đối chiếu và kiểm tra semantic/timing. Tối ưu editor RAM trước nghiệm thu project lớn.

Không gọi provider trả phí, không thu cookie/key thật;0Flow generation do audit gửi. Không tuyên bố Production Ready hoặc không còn regression. Giữ artifacts test riêng để có thể review.
