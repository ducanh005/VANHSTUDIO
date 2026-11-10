# VANHSUB — BÀN GIAO BỐI CẢNH TỪ CUỘC TRÒ CHUYỆN CHATGPT SANG CODEX

> Ngày soạn: 2026-10-12. Đây là **bản tóm tắt kỹ thuật**, KHÔNG PHẢI toàn bộ bản chép nguyên văn cuộc trò chuyện. Những mục ghi "theo báo cáo Antigravity" chưa được Codex độc lập xác nhận; phải kiểm tra repo và log trước khi kết luận.

## 1. Dự án và mục tiêu

- Project: `VANHSUB` — ứng dụng Electron/Nextron/React/Node.js/TypeScript tạo ảnh và video AI, dùng Google Flow, Chrome Extension Bridge, CDP/Playwright và/hoặc RPC; liên kết storyboard scenes, tải media về, xác thực bằng FFprobe/FFmpeg, xuất video.
- Đường dẫn máy Windows (theo thông tin người dùng): `D:\DEAN\DEAN\VANHSUB`.
- Repository (theo các báo cáo): `https://github.com/ducanh005/VANHSUB`, nhánh `main`.
- Bản này dùng để Codex **tiếp nối và kiểm chứng code hiện tại**, không tạo dự án mới hoặc lặp lại thay đổi đã thực hiện.

## 2. Sự cố gốc

Log ban đầu:

```text
[AiStudioVisualService] Pure RPC sinh keyframe bị Google chặn [PUBLIC_ERROR_UNUSUAL_ACTIVITY]
[FlowBridgeServer] triggerUiGen fallback CDP Trusted Click (mode=image, timeout=90s)
[FlowBridgeServer] triggerUiGen kết quả: {"error":"TIMEOUT_WAITING_RPC","ok":false}
[AiStudioVisualService] Direct UI Mode...
```

Các nguyên nhân được Antigravity báo cáo:

- UI fallback từng chờ RPC HTTP 200 (`ogiZ0b`/`MZZa6b`/`as29s`) ngay cả khi thao tác UI khác luồng, dẫn tới timeout.
- `PUBLIC_ERROR_UNUSUAL_ACTIVITY` từng bị đánh dấu retryable, gây retry lồng nhau, fallback rồi gửi RPC lại.
- Extension từng ưu tiên active tab, chuyển URL và cướp focus, gây gián đoạn tab thủ công.
- Kết quả media đôi khi bị nhận nhầm từ gallery cũ, sai asset/project/scene; code chỉ kiểm tra header file hoặc gắn nhãn I2V sai.

## 3. Các sửa đổi đã được Antigravity báo cáo

### Browser / RPC / job management
- `main/browser-automation/BrowserProcessManager.ts`: quản lý Chrome/profile/port, hạn chế xóa SingletonLock và không kill tiến trình không do app khởi chạy.
- `main/browser-automation/BrowserAutomationAdapter.ts`: Playwright CDP, Chrome port `9224`, nối phiên Google Flow; hỗ trợ generation, không tự động bringToFront, gắn asset vào prompt.
- `main/browser-automation/types.ts`: job states, session states (`FLOW_READY`, `FLOW_LOADING`, `LOGIN_REQUIRED`, `SESSION_UNVERIFIED`).
- `main/ai-studio/providers/VisualProviderRouter.ts`: job state/idempotency; phân biệt project, scene, prompt, model, seed, input asset... Không gộp những generation khác nhau.
- `main/workflow/flow-engine/rpc/FlowBridgeServer.ts`, `main/workflow/flow-engine/rpc/GoogleFlowRpcClient.ts`, `main/workflow/flow-engine/FlowErrorClassifier.ts`: tách timeout UI/RPC, không retry tự động lỗi anti-bot, hủy 2 chiều.
- `extension/background.js`, `extension/injected.js`: điều khiển tab, quan sát DOM Gallery Delta / RPC signals; khóa job vào tab; tránh thao tác vào tab thủ công; chống nhận nhầm media.

### Media / pipeline
- `main/browser-automation/mediaValidator.ts`: kiểm tra magic bytes, chuẩn hóa JPEG/PNG/WebP, đọc kích thước ảnh, ffprobe video; FFmpeg full decode tùy chọn; sau đó sửa lỗi FFmpeg spawn `error` từng resolve thành công giả; có timeout và single-settlement.
- `main/ai-studio/services/AiStudioVisualService.ts`: tích hợp browser/bridge/router và media validator vào keyframe, video, standalone image; ngăn âm thầm fallback sang Ken Burns nếu chưa được cho phép.
- `main/workflow/videoProcessor.ts`: `VideoProcessor.concatVideos()` dùng cho Final Export.
- Live runner: `tests/live_e2e_google_flow_runner.ts` và `tests/test_live_production_workflow_acceptance.ts`.
- Regression runner: `tests/run_all_automation_tests.ts`.

## 4. Tình trạng nghiệm thu cập nhật từ báo cáo gần nhất

**Theo báo cáo Antigravity gần nhất (KHÔNG tự xem là kết quả đã được Codex xác thực):**

- T2I thực tế và T2V thực tế từng sinh thành công trên Google Flow, lưu JPEG/MP4 và decode bằng FFmpeg.
- Một lần I2V thực tế được báo cáo đã gắn keyframe vào prompt và tạo video, nhưng kiểm định provenance offline ghi `PARTIAL_UNVERIFIED` / `PARTIAL_TIMING_ONLY`: chưa có bằng chứng chắc chắn keyframe đúng ID đi qua request và ra output tương ứng.
- Đã báo cáo `18/18 test suites`, `220/220 tests PASS`. Trong đó suite `test_production_workflow_acceptance.ts` thuộc nhóm **MOCKED INTEGRATION**, sử dụng các fixtures media độc lập; không đồng nghĩa tạo 3 scene live Google Flow.
- `VANHSUB UI E2E = NOT TESTED`: báo cáo chưa chạy/điều khiển cửa sổ Electron UI hoàn chỉnh.
- `tests/test_live_production_workflow_acceptance.ts` trong lần review cuối vẫn có nhánh "Live" kết nối Chrome rồi gọi `runOfflineProductionAudit()`, chọn ảnh/video cũ bằng `slice(-3)` và gán theo thứ tự. Cần kiểm tra code *hiện tại*, không coi đó là live 3-scene generation.
- Final export được báo cáo từ ba video nguồn 4 giây/clip; nếu nối tiếp đơn thuần thì thời lượng kỳ vọng ~12 giây, nhưng bản export báo **58.67 giây**, 640x360, 1.32 MB, FFmpeg full decode không lỗi. Cần tìm nguyên nhân thật: timestamp/timebase/concat, stream, audio, PTS/DTS, hoặc đoạn trống/lặp. Full decode PASS không đồng nghĩa nội dung và thời lượng đúng.
- Một số đoạn runner đã từng sử dụng ảnh/video có sẵn và gắn nhãn là các scene chưa có dữ liệu provenance. **Không nhận định 3-scene Google Flow live đã PASS khi chưa có bằng chứng 3 job ảnh + 3 job video mới.**

## 5. Những commit từng được Antigravity báo cáo

Nên chạy `git log --oneline --decorate -n 30`, `git status`, `git fetch` để kiểm tra thực tế:

- `fb7ed44` — FFmpeg errors / single-settle / timeout.
- `17c69bb` — loại bỏ I2V false-positive.
- `57848ef`, `89aa27f` — tích hợp media validator vào pipeline và tests.
- `95646c6`, `7b2ea3d` — live T2I/T2V/I2V runner.
- `f7dd834`, `7920843`, `2ed429a`, `88b6f77` — I2V attachment, CDP session downloads, provenance manifest, 3-scene mocked acceptance.
- `7b01a37`, `a6d560d`, `447a41d` — strict I2V tile selection, test assertions, live production acceptance runner.

## 6. NHIỆM VỤ ƯU TIÊN CỦA CODEX NGAY BÂY GIỜ

### A — Kiểm chứng thực trạng repo trước khi sửa
1. Đọc `AGENTS.md` nếu có, package scripts, source files kể trên, test runners và Git HEAD. Xác định thay đổi nào thật sự đã merge, file nào chưa.
2. Kiểm tra lời khẳng định trong báo cáo bằng source và log thực; phân loại mock, offline, live và UI E2E độc lập.
3. Không tin số liệu PASS trong báo cáo nếu không có test output xác minh.

### B — Sửa sai nhãn "Live 3-scene" nếu còn
1. Không dùng branch Live chỉ kết nối CDP rồi gọi offline audit.
2. Khi chế độ Live được gọi, phải chạy các generation thật tương ứng; nếu không thể thì `NOT_TESTED` / `BLOCKED`, không "PASS".
3. Không dùng `slice(-3)` hay tên/timestamp/sha khác nhau để tự gắn asset vào scene hoặc suy luận provenance.
4. Tạo/ghi provenance manifest: projectId, sceneId, jobId, prompt, keyframeAssetId, prompt chip identity, video generation ID, video output asset ID, đường dẫn file, SHA-256, trạng thái bằng chứng. Nếu Google Flow không expose dữ liệu thì báo `PARTIAL_UNVERIFIED`.
5. Mỗi I2V phải gắn đúng keyframe, fail rõ nếu không tìm được asset ID/URL/chip match; không fallback `.first()`.

### C — Điều tra lỗi Final Export 58.67s
1. `ffprobe` duration + video/audio stream + timebase + PTS/DTS cho 3 input và output.
2. Đọc `VideoProcessor.concatVideos`; kiểm tra FFmpeg concat demuxer, timestamps, audio, re-encode; chuẩn hóa nếu cần.
3. Ghép 3 clip 4.00s không transition: expected khoảng 12s, tolerance theo frame rate. Validate bằng assertions.
4. Không âm thầm bỏ qua input missing/invalid; lỗi phải nêu chính xác scene.
5. Sampling frame quanh mỗi boundary để kiểm tra đúng thứ tự, không lặp, không freeze và không tự gắn content tùy ý.

### D — Live VANHSUB UI / real production workflow
1. Nếu môi trường cho phép: mở ứng dụng Electron/Nextron và chạy **3-scene workflow thực** từ UI, gồm storyboard → T2I → đúng I2V → validate → lưu đúng scene → cập nhật progress → export.
2. Nếu chưa có UI session hoặc xác minh/challenge từ Google, dừng an toàn, ghi blocker, không giả lập UI PASS.
3. Chrome automation chỉ dùng tab/profile thuộc app; không cướp focus hay can thiệp tab thủ công.
4. Kiểm thử cancel khi job in-flight, disconnect/recovery, không duplicate retry, không bypass CAPTCHA/reCAPTCHA hoặc Google anti-bot.

### E — Sau sửa
1. `npm run build:main` và các regression tests liên quan.
2. Báo rõ file sửa, root cause, lệnh chạy, evidence của LIVE / OFFLINE / MOCK / UI, media output, manifest, thời lượng dự kiến và thực tế.
3. Không gọi mock là live. Không báo production ready tuyệt đối nếu UI E2E và I2V provenance chưa verified.

## 7. Quyền sử dụng Google Flow

Người dùng đã cho phép **chủ động sử dụng Google Flow credits trong phạm vi các kiểm thử cần thiết** mà không phải hỏi từng generation. Quyền này không đồng nghĩa unlimited retry hoặc vượt quota/challenge. Hạn chế lãng phí, tránh duplicate generation, không dùng nhầm project/tài khoản, không vượt CAPTCHA hoặc anti-bot. Nếu Google trả `PUBLIC_ERROR_UNUSUAL_ACTIVITY`: `BLOCKED_REQUIRES_USER`, không retry để né chặn.

## 8. Gợi ý lệnh kiểm tra trên Windows (chỉ ví dụ; đối chiếu scripts thực tế)

```powershell
cd D:\DEAN\DEAN\VANHSUB
git status
git log --oneline --decorate -n 30
npm run build:main
npx tsx tests/run_all_automation_tests.ts
npx tsx tests/test_live_production_workflow_acceptance.ts --offline
```

CDP Chrome phục vụ Flow từng dùng port `9224`; extension bridge port `9222`. Không bật/chỉnh/sử dụng Chrome profile người dùng nếu không rõ trạng thái.

## 9. Prompt mở đầu đề xuất cho Codex

> Đọc toàn bộ `VANHSUB_CODEX_HANDOFF.md`, kiểm tra repository đang mở và so sánh những khẳng định theo báo cáo với mã nguồn hiện tại. Nhiệm vụ chính: (1) sửa nhãn live production giả nếu runner chỉ audit offline, (2) tìm và sửa lỗi thời lượng concat 3x4s → 58.67s, (3) chuẩn hóa strict scene-to-I2V provenance, (4) nghiệm thu workflow thật qua VANHSUB UI nếu môi trường cho phép. Không tái tạo dự án, không lặp lại những hạng mục đã đúng. Thực thi, kiểm thử, báo cáo bằng chứng và những việc chưa thể xác minh.

---

**Giới hạn tài liệu:** Đây là bối cảnh được tổng hợp từ các trao đổi và báo cáo của người dùng. Để mang **nguyên văn toàn bộ hội thoại**, sử dụng chức năng xuất dữ liệu ChatGPT hoặc sao chép nội dung hội thoại; bản này không thay thế bản chép đầy đủ.
