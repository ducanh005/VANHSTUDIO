# AI Studio Phase 2 — Adapter Kokoro và nghiệm thu media/render

Ngày: 21/10/2026, múi giờ Asia/Saigon. Tiếp nối `VANHSUB_AISTUDIO_POST_UAT_20261020.md`; không thay thế bằng chứng hoặc kết luận lịch sử trong báo cáo đó.

## 1. Kết quả chính

1. **Đã triển khai adapter Kokoro vào TTS service và stage 3 hiện hữu**, dùng tiếp cơ chế tổng hợp từng câu, ghép audio và timing. Không còn dừng ở lỗi “chưa có bộ tổng hợp”.
2. **Đã thêm readiness LLM trước khi tạo job/checkpoint**, kiểm tra lại cấu hình đóng băng trước approve/resume tới stage cần LLM; Settings hiển thị lý do thiếu cấu hình và cho nhập custom endpoint/model.
3. **Đã xuất video thực qua UI Electron** từ SRT + audio lời nói + ảnh kiểm thử: 2.000 giây, H.264 1280×720, audio AAC 24 kHz; FFmpeg giải mã toàn bộ thành công. Restart giữ nguyên hash audio/video.
4. Đã sửa lỗi UI giữ thông báo lỗi của phiên trước khi tạo episode thủ công, trạng thái busy khi thiếu output directory, và bảo vệ output TTS cũ khi request/cancel thất bại.

**Phân loại:** adapter/contract/native/runtime đã có bằng chứng PASS bên dưới. **Kokoro synthesis Live vẫn BLOCKED** vì catalog mặc định tại loopback không kết nối được. Không cài/chạy service, tải model, đọc key thật hoặc gọi provider trả phí. Video xuất được là nghiệm thu với fixture/media có sẵn, không phải tập được AI sinh từ Facts đến SEO.

## 2. Git, worktree và dữ liệu

- Worktree: `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`.
- Nhánh: `codex/worktree-merge-audit-20261020`.
- HEAD trước/sau: `58f4e7bc840a5774c6d09e87913f6ab869c985da`; toàn bộ bản sửa Phase 1 và Phase 2 **chưa commit**. Không stage/push/merge/rebase.
- Lưu hash danh sách file đang thay đổi trước Phase 2 trong `temp/aistudio-phase2/source-before.json`; giữ nguyên báo cáo Phase 1, các guard U01–U04 và dữ liệu UAT.
- 9 file UAT gốc trong bộ đối chiếu Phase 1 không đổi hash; không mở/migrate/chỉnh checkpoint FAILED gốc.
- Beta `app.asar` không bị thay: SHA-256 vẫn `fd7c63abc4b94068d80d892f2f27c2254bc045cb81b648f962304fa55d4a9e0a`.
- Đối chiếu 466 file gốc ở 8 worktree theo baseline 20/10: **0 file đổi nội dung**. Tuy nhiên checker bảo toàn toàn bộ ref trả exit 1: HEAD checkout D và hai ref Douyin đã thay đổi so với baseline cũ. Reflog ghi `8af33a6`, `fix(subtitles): sync editor preview to video playback clock`, lúc 09:48:46 +07 ngày 21/10. Không gọi đây là toàn bộ Git refs PASS; không tích hợp hoặc hoàn tác công việc bên ngoài đó. HEAD nhánh review hiện tại vẫn giữ nguyên.
- Các build Phase 2 nằm ngoài worktree khác ở `D:/VANHSUB-Phase2-20261021/`; dependency bundle ổ D chỉ được đọc. Không thay package/lockfile hoặc cài dependency.

## 3. Kokoro TTS đã hoàn thiện

### Contract và cấu hình

- Client mới: `main/tts-providers/kokoro/KokoroClient.ts`.
- POST `/v1/audio/speech` theo [Kokoro-FastAPI schema](https://github.com/remsky/Kokoro-FastAPI/blob/master/api/src/structures/schemas.py): model `kokoro`, script, voice ID, speed, `response_format: wav`, `stream: false`.
- Dùng provider `local_onnx` hiện có để biểu diễn Kokoro trong voice config; channel `kokoro_tts` được map vào đúng provider tại stage 3. Không tạo pipeline tổng hợp thứ hai.
- URL mặc định `http://127.0.0.1:8880/v1`; hỗ trợ đổi cổng qua Settings. Chỉ HTTP loopback, đường dẫn `/v1`, không user/password/query/hash; không proxy/redirect. Catalog dùng URL đã lưu, renderer không được truyền endpoint qua IPC.
- Voice ID giữ nguyên, không đi qua normalizer Edge. Có lựa chọn engine/voice/URL Kokoro trong Settings; Cấu hình kênh tiếp tục dùng catalog. URL cần lưu trước khi tải catalog.
- Rate phần trăm chuyển sang hệ số 0.25–4.0. Volume áp dụng khi chuẩn hóa audio. Pitch khác 0 bị từ chối rõ ràng, không lờ cấu hình hoặc chuyển engine.
- Timeout mặc định 90 giây/request, cấu hình nội bộ có giới hạn 100–180000 ms. Payload tối đa 10000 ký tự/đoạn; response tối đa 32 MiB. Không retry POST tự động.
- Default mới của channel Kokoro dùng `af_heart`, thay vì ID Edge không thuộc engine; khi người dùng đổi engine trong modal, preset giọng cũng đổi phù hợp. Không migrate profile/snapshot đã lưu.

### Audio, artifacts và timing

- Kiểm tra header WAV; FFmpeg giải mã và chuẩn hóa MP3 mono 24 kHz/96 kbps. Probe duration phải hợp lệ trước khi trả kết quả.
- Tái sử dụng luồng từng câu và concat của `AiStudioTtsService`. Tên file theo vị trí câu, tránh đè nhau khi legacy script có `line.index` trùng.
- Từng invocation có thư mục staging riêng trên cùng volume. Chỉ rename voiceover vào đích sau khi tất cả bước thành công; chỉ cập nhật timing/path của script đầu vào sau khi commit audio thành công. Khi lỗi chỉ dọn staging do invocation đó tạo, giữ nguyên file hoàn thành trước đó.
- File audio từng câu của lần thành công được giữ để checkpoint/resume sử dụng. Stage 3 tiếp tục đồng bộ vào storage `02_voice`; stage 4 đọc thời lượng và alignment đã lưu.
- Standard speech endpoint không cung cấp word boundaries trong response được dùng ở đây. Timing từng câu dựa trên audio đo thật; timing từng từ được đánh dấu `estimated_per_line`, không được gắn nhãn forced alignment chính xác.
- AbortSignal hủy HTTP và FFmpeg; concat/normalize có giới hạn thời gian, listener được dọn. Không fallback từ Kokoro sang Edge/TikTok.

### Điều chưa được chứng minh

- Catalog mặc định không kết nối được trong lần probe cuối: chưa chạy synthesis với model Kokoro thật.
- Chưa nghe/đánh giá chất lượng giọng hoặc độ chính xác từng từ của model thật.
- [Danh sách ngôn ngữ công bố của Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI#readme) không liệt kê tiếng Việt. Không coi voice tiếng Anh là nghiệm thu cho lời đọc tiếng Việt. Adapter này không tự thêm ngôn ngữ/model.
- Không cài/chạy Docker, service, model hoặc sửa cấu hình hệ thống; CPU/VRAM thực khi chạy model chưa được đo.

## 4. LLM/provider readiness

Các provider đang có trong source: `deepseek`, `openai`, `custom`, `chatgpt_web`, `gemini_web`. Không thêm provider trả phí hoặc gọi API để kiểm tra key trong đợt này.

- `shared/studioLlmReadiness.js` dùng cho Settings/main; kết quả chỉ có ready/provider/model/reasons/warnings/liveVerified, **không trả key hoặc URL có credential**.
- API provider thiếu key dùng được bị chặn trước khi start tạo episode. Custom cần model và Base URL cụ thể. DeepSeek/OpenAI giữ default model hiện có trong source; chưa xác minh model khả dụng bằng request thật.
- Endpoint phải HTTPS hoặc HTTP loopback, không user/password/query/hash. HTTP non-loopback cũ sẽ bị báo không hợp lệ; không tự sửa dữ liệu cũ.
- `main/ai-studio/llmReadiness.ts` kiểm tra provider hiệu lực theo channel, giữ bản sửa credential ownership Phase 1. Provider khác không được dùng key của provider cũ.
- IPC `aiStudio:readiness` không nhận tham số và đi qua renderer/payload guard. Không cho renderer gửi key để log hoặc kiểm tra ở route này.
- Backend áp dụng trước start, approve từ stage 1/4/7 và resume tới stage 1/2/5/8; adapter API cũng kiểm tra cấu hình trước khi tạo client.
- Frontend lấy readiness trước start; thông báo thiếu cấu hình rõ ràng. Busy chỉ bật sau preflight/output-dir check; ref chặn hai lần start khi preflight chưa xong.
- Cảnh báo chưa xác minh key/quota/auth được hiển thị riêng, không biến thành lỗi pipeline màu đỏ. Web provider chỉ được cảnh báo về trạng thái chưa xác minh; readiness cấu hình **không xác nhận đăng nhập hoặc generation Web**. Không gọi các luồng login/masking để biến trạng thái này thành PASS.
- Snapshot cũ tiếp tục đóng băng. Thêm key vào cấu hình chung không thay snapshot FAILED cũ; resume bị từ chối trước khi làm đổi checkpoint nếu snapshot thiếu key.

**Trạng thái:** Configuration validation/persistence/IPC — PASS. Key/quota/provider Live — NOT TESTED. Muốn chạy provider thật cần người dùng cấu hình key/quyền hợp lệ qua UI trên profile nghiệm thu mới; không gửi credential vào chat/log.

## 5. Các lỗi sửa thêm trong pipeline/UI

| Lỗi | Sửa |
| --- | --- |
| Kokoro chọn trong channel nhưng stage 3 chưa có adapter hoặc có thể dùng voice/provider khác | Map rõ `kokoro_tts → local_onnx`, giữ voice ID, gọi client Kokoro và không fallback |
| Voiceover/câu cũ có thể bị ghi trực tiếp trước khi biết lần tổng hợp mới thành công | Staging + rename sau thành công, clone timing trước xử lý |
| Trùng `line.index` có thể đè clip của câu trước | Tên clip theo vị trí tuần tự |
| Resume/approve biết trước snapshot không có key vẫn bắt đầu stage cần LLM | Chặn trước mutation/job launch; không sửa snapshot |
| Thiếu output directory có thể để UI ở trạng thái busy | Đặt busy sau kiểm tra output/preflight |
| Click start lặp trong thời gian chờ readiness | Ref giữ một start đang chờ |
| Phiên thủ công mới đã hoàn tất nhưng còn banner lỗi Kokoro của phiên cũ | Clear error/code khi nhập/render thủ công; đã tái hiện qua screenshot và kiểm tra lại |
| Cảnh báo key/quota chưa xác minh có thể hiển thị như lỗi tiến trình | State cảnh báo riêng |
| Stage 7 dùng tên video cố định khi chạy lại | Mỗi lần render pipeline dùng UUID; không ghi đè video hoàn thành cũ |

## 6. Bằng chứng kiểm thử

Tất cả log/runtime metadata bên dưới ở `temp/aistudio-phase2/`, giữ local. Không đưa raw logs, test profile, checkpoint hoặc file output riêng tư vào Git.

| Bài kiểm tra | Kết quả và giới hạn |
| --- | --- |
| `test_ai_studio_phase2_kokoro.ts` | **PASS — HTTP contract + Native Runtime.** Server fixture trả WAV lời nói mẫu có sẵn trong repository; FFmpeg/FFprobe thật tạo MP3 mono 24 kHz, output 2496 ms cho hai đoạn fixture. Kiểm tra voice/speed/body, lỗi WAV/503/timeout, hủy, lỗi ở đoạn thứ hai sau đoạn đầu thành công, không retry/fallback, giữ bytes output và timing cũ. Không phải model synthesis Live. |
| Native FFmpeg cancellation trong bài Kokoro | **PASS.** Hủy process FFmpeg do test tạo; PID đã thoát, listener abort được dọn. Không suy ra long-running soak hoặc hard-crash cleanup đã PASS. |
| Stage 3 → restart engine → stage 4 trong bài Kokoro | **PASS — engine/native với checkpoint fixture.** Audio tồn tại, timing từ audio thật; bước 4 không POST tổng hợp lại, bytes audio giữ nguyên. Script/checkpoint đầu vào do test cung cấp, không phải LLM sinh thật. |
| `test_ai_studio_phase2_readiness.ts` | **PASS — automated.** Thiếu key, custom model/URL, không lộ key trong lý do, provider mismatch, không tạo output dir/job, giữ snapshot/checkpoint khi resume bị từ chối. |
| `test_ai_studio_post_uat_runtime.ts` sau cập nhật contract | **PASS.** Giữ script guards, credential isolation, checkpoint/resume/lease và catalog. Lỗi provider là transport fixture; start thiếu key đã được tách sang readiness suite. |
| `test_ai_studio_post_uat_ui.cjs` | **PASS — mounted React.** Các guard/status Phase 1 còn đúng; Custom Base URL, readiness thiếu key, xóa key cũ khi đổi provider, lựa chọn/URL/voice Kokoro lưu đúng. IPC trong bài này là fixture. |
| `test_ai_studio_post_uat_electron.cjs` trên build cuối | **PASS — production Electron/IPC/UI có giới hạn**, chi tiết bên dưới. Provider HTTP 503 là fixture; kết quả hộp chọn file OS được định sẵn. Các IPC, path capabilities, import, storage, render và restart là thật. |
| Regression liên quan | **PASS:** TTS alignment, session config, channel provider isolation, channel settings, session operations, manual SRT/audio episode, script evaluation/refinement/invalidation, IPC payload. Không chạy lại Bridge/Flow suite không bị thay đổi. |

Các kết quả tổng hợp: `regressions-final.json`, `service-regressions.json`; log riêng `kokoro-final.log`, `readiness.log`, `post-uat-runtime-updated.log`, `ui-final.log`, `ipc-final.log`, `electron-final.log`.

Test lease cũ dùng snapshot không có key nên bị readiness mới chặn trước stage 8. Đã cập nhật fixture với key test không có quyền gọi dịch vụ; các assertion lease/cancel/recovery giữ nguyên. Một lỗi locator harness do hai nút “Đóng” được sửa bằng chọn nút text thực tế. Không sửa assertion để bỏ qua lỗi ứng dụng: lỗi banner stale đã được sửa trong source và có assertion không còn lỗi cũ khi bắt đầu episode mới. Các log thất bại ban đầu được giữ lại.

### Nghiệm thu Electron và file output

Profile Electron hoàn toàn riêng, Flow Bridge tắt, không dùng settings/project/Beta hiện hành. Runtime Electron 43.5.0. Các bước đã chạy:

1. IPC thật lưu/chuyển provider xóa credential DPAPI/model/endpoint cũ; thiếu key được báo qua readiness/start/LLM IPC.
2. LLM fixture local trả 503 để kiểm tra checkpoint FAILED, canonical script guards và restart. Không gọi provider Internet.
3. Script nhập thủ công được duyệt tới stage 3; Kokoro fixture 503 báo lỗi đúng, không gọi Edge.
4. UI tạo episode thủ công mới từ SRT và WAV public-speech sample; lỗi của phiên trước được xóa.
5. Nút xuất bị khóa khi scene thiếu media. UI nhập PNG fixture qua dialog IPC/path capability bình thường; scene nhận đúng file.
6. UI xuất video bằng FFmpeg thật; FFprobe có H.264 1280×720 và AAC 24 kHz, duration 2.000 giây. Full decode thành công.
7. Đóng/mở Electron lần nữa, UI vẫn completed, hash audio/video không đổi.
8. Đọc checkpoint test đã lưu: provenance `manual_import`, `automaticGeneration:false`, scene/session/project ownership đúng và SHA-256 khớp file. SEO là `skipped`, không gắn nhãn AI generation thành công.

File output giữ trên máy, đường dẫn cụ thể tại `temp/aistudio-phase2/manual-output.json`; metadata FFprobe tại `manual-output-probe.json`, provenance check tại `manual-provenance-check.json`. SHA-256 video: `e1761b7d0c1701c8326afd70e4dcba90819b0319bebb403de8f7f815acb335db`. Screenshot sau sửa: `ui-manual-completed.png`.

Đầu vào video này gồm lời nói sample public có sẵn, SRT tự viết cho test và PNG do FFmpeg tạo. Không phải ASR/translation/TTS model output và không nghiệm thu độ khớp nội dung lời nói với SRT. OS file picker được thay kết quả trong **process Electron test riêng**; không tuyên bố đã điều khiển hộp thoại Windows thật. Đường đi capability từ dialog IPC tới media import không bị bypass.

## 7. Ma trận pipeline cuối đợt

| Bước | Tình trạng thực tế |
| --- | --- |
| Facts | Nghiệm thu manual facts trong harness; không có research provider Live |
| Script | Readiness/guard/error/recovery PASS; generation LLM Live NOT TESTED |
| TTS | Kokoro adapter/HTTP contract/native audio/stage 3 PASS; model synthesis Live BLOCKED tại service mặc định |
| Timing | Audio duration/line timing/restart PASS với speech transport fixture; word timing vẫn ước lượng |
| Storyboard | Có storyboard từ SRT trong manual mode; automatic LLM storyboard mới NOT TESTED |
| Media | Import scene qua UI + hash/ownership/provenance PASS; Flow generation không thử lại |
| Render | UI → FFmpeg → MP4 có audio/video → restart PASS với fixture/media có sẵn |
| SEO | Manual mode bỏ qua có chủ đích; generation SEO Live NOT TESTED |

Vì vậy đã có đường tạo video từ nội dung/media sẵn có độc lập LLM/Flow. **Chưa xác nhận một pipeline AI tự động đầy đủ từ Facts đến SEO.**

## 8. Build và định danh

- TypeScript main/renderer `tsc --noEmit --incremental false --pretty false`: **PASS**, exit 0; log `typecheck-reviewed.log`.
- Build production renderer **PASS**, 15.508 s; main/preload webpack **PASS**, 10.544 s.
- Source build đối chiếu worktree cuối: **274 file, 0 mismatch**. Sau bản sửa banner stale đã tạo stage mới và chạy Electron lại trên chính stage đó.
- Version `1.0.0`, build ID `aistudio-phase2-20261021-6a2af8ace149`, dirty source trên base commit `58f4e7bc840a5774c6d09e87913f6ab869c985da`.
- Stage cuối: `D:/VANHSUB-Phase2-20261021/vanhsub-build-check-ZlNUni`.
- Manifest: `phase2-manifest.json` và `build-check-result.json` trong stage; bản local ở `temp/aistudio-phase2/final-manifest.json`.
- SHA-256 tập source build: `6a2af8ace1497b7f09346b1c526bb9784c989023ef8fa180387aa5c433f2f81a`.

| Artifact | SHA-256 |
| --- | --- |
| `app/main.js` | `e7494eb2df970ef89905bdadc57fa617175ddaf9a93e9b6d00489c1a7cdad539` |
| `app/preload.js` | `472f535ed3228ebaafebcae93d028b31a30f6656724426bf28b174aaedb8ad55` |
| `app/home/index.html` | `1828b996c5693c4e8d0cc3f1d903ccfc75efc0be1e4116b907ce55545e193db1` |

Không tạo installer NSIS/app.asar mới, không thay Beta. Packaging/clean Windows VM: **NOT TESTED**. Ba PID main Electron của lần test cuối đã thoát; kiểm tra process theo stage/profile test không còn Electron. Không tuyên bố đã chứng minh không memory leak hoặc không orphan sau mọi kiểu crash.

## 9. File thay đổi trong Phase 2

Các file Phase 1 ngoài danh sách này được giữ lại; báo cáo Phase 1 vẫn nguyên nội dung.

| Nhóm | File |
| --- | --- |
| Adapter mới | `main/tts-providers/kokoro/KokoroClient.ts` |
| TTS/pipeline/storage mapping | `main/ai-studio/services/AiStudioTtsService.ts`, `main/ai-studio/AiStudioPipelineEngine.ts`, `main/ai-studio/sessionConfig.ts` |
| Kokoro catalog | `main/ai-studio/kokoroVoices.ts` |
| Readiness mới | `main/ai-studio/llmReadiness.ts`, `shared/studioLlmReadiness.js` |
| LLM adapter guard | `main/ai-studio/services/AiStudioLlmService.ts` |
| IPC/preload/validation | `main/ai-studio/ipc.ts`, `main/preload.ts`, `main/security/ipcPayload.ts` |
| Types/defaults | `main/ai-studio/types.ts`, `renderer/types/aiStudio.ts`, `renderer/types/electron.d.ts` |
| UI | `renderer/components/ai-studio/AiStudioSettingsTab.tsx`, `renderer/components/ai-studio/ChannelConfigModal.tsx`, `renderer/components/ai-studio/AutoPilotView.tsx` |
| Tests mới | `tests/test_ai_studio_phase2_kokoro.ts`, `tests/test_ai_studio_phase2_readiness.ts` |
| Tests cập nhật theo contract mới | `tests/test_ai_studio_post_uat_runtime.ts`, `tests/test_ai_studio_post_uat_ui.cjs`, `tests/test_ai_studio_post_uat_electron.cjs`, `tests/test_ai_studio_session_operations.ts`, `tests/test_rc_ipc_payload.ts` |
| Báo cáo | `docs/VANHSUB_AISTUDIO_PHASE2_20261021.md` |

## 10. Điều kiện để nghiệm thu Live và các giới hạn còn lại

1. **Kokoro thật:** cần service local tương thích đã có model/voice sẵn sàng ở URL đã lưu. Người dùng cần cho phép thiết lập/chạy service ngoài ứng dụng hoặc tự cung cấp service đang hoạt động. Chưa thực hiện việc này. Sau đó có thể chạy một đoạn ngắn đúng ngôn ngữ của voice, nghe audio và kiểm tra output/timing trước khi chạy tập dài.
2. **LLM thật:** người dùng cấu hình provider, key/quota/quyền hợp lệ qua UI của profile nghiệm thu. Cấu hình phải khớp provider trong Cấu hình kênh; tạo session mới để lấy snapshot mới. Không sửa FAILED session gốc.
3. **Media:** không cần Flow để dùng đường manual đã nghiệm thu. Có thể nhập media hợp lệ cho scene. Route Flow Web RPC từng unusual activity vẫn không được retry; browser masking/UA logic ghi nhận Phase 1 không được gọi hoặc bổ sung trong đợt này. Official image/video API Live vẫn cần quyền/key riêng.
4. **Tiếng Việt:** cần engine/model công bố hỗ trợ tiếng Việt và nghiệm thu giọng thật; không dùng fixture hoặc voice tiếng Anh để khẳng định yêu cầu này đã đạt.
5. Hard-crash giữa synthesis/render, long-running soak, forced alignment từng từ chính xác, automatic storyboard/SEO Live và installer sạch vẫn chưa được nghiệm thu trong Phase 2.
6. Còn chi tiết UI: tracker hiện hiển thị stage SEO `skipped` của manual mode thành “Chờ”; checkpoint đã ghi `skipped` đúng và header completed đúng. Không dùng tracker đó để suy ra SEO đã chạy. Các nút tiếp tục tự động trong manual mode vẫn được backend chặn. Chưa mở rộng sửa các control này trong đợt adapter/readiness.

**Internal Beta:** CONDITIONALLY READY cho import SRT/audio/media và render trên máy hiện tại trong phạm vi thử nghiệm; chưa READY cho toàn pipeline AI tự động. **Public Release:** NOT READY. Tất cả thay đổi nằm ở nhánh review, chưa commit/push/merge và chưa cài vào Beta.
