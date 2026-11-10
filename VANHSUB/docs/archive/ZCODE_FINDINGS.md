# ZCODE_FINDINGS — Các phát hiện của mission 48h (cập nhật 2026-10-24 ~24:00 +07:00)

## F-1 [ĐÃ GIẢI QUYẾT 25/10] Trạng thái trang chưa ổn định (race) — KHÔNG phải DOM drift

**Sửa lỗi lần 1 (bản kết luận sai):** ban đầu kết luận là Google đổi DOM dựa trên probe đọc ngay sau navigation (0 tiles/quote null). Probe có settle xác nhận: wait+0 → 0 tiles, wait+3000 → 12 tiles, quote đọc hoàn hảo. Nguyên nhân thật: đọc gallery/quote quá sớm.
**Đã vá:** runApprovedT2i thêm settleGallery (3 lần đọc liên tiếp cách 2.5s phải giống nhau, budget 16s) + FLOW_QUOTE_UNREADABLE có tên trong service. Sau vá: quote đọc đúng (receipt #1 ghi model Nano Banana 2.1, x1, 0 credit), generation gửi thành công 5/5 lần.

- **Hiện tượng**: Ngày 23/10 10:33 preflight đọc được quote (`Nano Banana 2.1 · Image · x1 · 0 credit`) bằng cùng source code. Ngày 24/10 ~23:30, cùng code trên cùng project/profile đọc được: `readT2iGallery` → **0 tiles** dù DOM có 12 ảnh và `flow-grid-tile-container` vẫn tồn tại; `inspectFlowCreditState` → model/outputs/mode/credits **toàn null** dù Flow UI hiển thị "Nano Banana 2.1 · x1".
- **Phân loại bằng chứng**: CHROME/PROVIDER FIXTURE + LIVE UI đọc-only. Evidence: `temp/flow-t2i-recovery/probe-quote-20261024.log`, `probe-selectors.log`, `flow-tab-now.png`.
- **Nguyên nhân suy đoán (CHƯA chứng minh)**: Google triển khai UI mới — tiles bị **nest** vào nhau nên filter "top-level card" của `readT2iGallery` lọc hết (12→0); panel settings (`flow-prompt-box-settings`) hoặc cấu trúc control bên trong đổi, khiến việc khớp model/radio/count trả rỗng.
- **Ảnh hưởng**: Stage 6 (media) qua UI VANHSUB dừng TRƯỚC khi gửi generation — credit an toàn (không tốn), nhưng người dùng không tạo được media tự động trên Flow UI hiện tại cho đến khi remap selector.
- **Chưa bị ảnh hưởng (đã xác minh)**: login/session (`FLOW_READY`), prompt box + `.ProseMirror` vẫn tồn tại, `readFlowPrompt` (bản sửa paragraph) là hàm đọc DOM-structure thuần và đã được test offline; nút "Bắt đầu tạo" vẫn nhận diện được bằng aria-label.
- **Việc cần làm (đề xuất thứ tự)**: (1) map DOM mới của gallery tile + settings panel bằng probe只-đọc; (2) cập nhật `readT2iGallery`/`inspectFlowCreditState` giữ invariant "chỉ nhận output mới, đúng project, đúng prompt, x1"; (3) cập nhật fixture cho khớp cấu trúc mới; (4) chạy lại regression 23-check + nghiệm thu UI; (5) KHÔNG nới lỏng gate để lấy PASS.

## F-2 [Đã xác minh] innerText của Chrome trả `\n\n` giữa các `<p>` kể cả khi `p{margin:0}`

- Khoảng trắng giữa paragraph là **cấu trúc block**, không phải margin. Mọi serialization prompt phải qua `readFlowPrompt` (đọc ranh giới dòng theo DOM) hoặc serializer block-aware; tuyệt đối không dùng `innerText` so khớp prompt.
- Evidence: `temp/flow-t2i-recovery/probe-v3-after-fix.log` (inner=`\n\n`, readFlowPrompt=`\n`), probe-dom.log.

## F-3 [Đã xác minh] Fixture contenteditable thường tạo DOM hỗn hợp TEXT+<div> sau fill

- Playwright `fill()` trên div thường (không ProseMirror) → `[TEXT, <div>]` → `readFlowPrompt` chặn đúng theo thiết kế (`FLOW_PROMPT_UNSUPPORTED_NODE`, guard chống node lạ/chip). Fixture phải mô phỏng ProseMirror (chuẩn hóa `<p>`/dòng) — đã sửa trong `tests/flowT2iFixture.ts`.
- Đây là lý do regression 23/10 fail ở `remoteMediaReady=undefined`, KHÔNG phải lỗi production.

## F-4 [Đã xác minh] Thiết kế credit-gate hoạt động đúng qua UI thật

- Chuỗi gate đã quan sát lần lượt khi drive UI packaged candidate: session không có trong engine → `Không tìm thấy phiên`; chế độ playwright chặn regenerate rời rạc → `FLOW_REGENERATION_REQUIRES_NEW_APPROVAL`; thiếu CDP app → `FLOW_CDP_REQUIRED`; thiếu model label → `FLOW_CREDITS_BLOCKED`; tới được preflight Flow → dừng an toàn `FLOW_RECONCILIATION_REQUIRED` (do F-1) — mọi trường hợp đều KHÔNG sinh receipt mới, KHÔNG tốn credit, KHÔNG retry tự động.
- Evidence: `temp/flow-t2i-recovery/ui-t2i-acceptance-20261024.log`, `ui-main-process.log`, log app `Beta-Profile/user/logs/vanhsub-2026-10-24.log`.

## F-6 [P1 — Còn mở, đã thu hẹp] Watcher correlation: packaged app trip ~1s, source COMPLETED

**Đã giải quyết được (25/10):**
- Request shape thật: [[null,null,null,2052833273,3,"BELUGA",null,[...project...,1]],[[[prompt]]],null,null,null,uuid,uuid] — prompt single-
 ✓ → inspector singleOutput dual-shape ĐÃ VÁ.
- Response shape thật: wrb.fr/ogiZ0b → media element 2 UUID + URL flow-content.google/image/<assetId>?Signature → parser mới: assetId lấy từ UUID TRONG URL (regex không anchor), single-output = đúng 1 distinct URL — ĐÃ VÁ.
- Tile correlation: preview URL (asb/) ≠ CDN URL → so khớp theo assetId — ĐÃ VÁ.
- **SOURCE end-to-end COMPLETED (bằng chứng mạnh nhất): receipt b88e1b2a… state COMPLETED, artifact diagscene.jpg 296283 bytes sha 0bb717e7…, tile 97818cce… trên Flow. Toàn bộ pipeline code đúng với Flow UI thật.**
- Pre-click draft request: Flow gửi ogiZ0b-shape request khi fill (draft/prefetch) → bỏ qua pre-click (giữ tile-diff + receipt guard) — ĐÃ VÁ; early-input test vẫn PASS qua tile-diff.

**GIẢI QUYẾT 18:45 25/10:** sau khi cộng dồn các vá (đặc biệt pre-click draft-ignore), packaged R7 chạy END-TO-END qua UI: receipt COMPLETED + artifact + provenance. Delta packaged-vs-source không còn tái hiện. Evidence: acceptance/ui-paragraphfix-20261025j (receipt + session.json + artifact).

**Còn lại (lịch sử):** packaged app (Electron bundle) vẫn trip ~1000ms sau reserve trong khi source cùng code COMPLETED. 7 receipt RECONCILIATION_REQUIRED đều đã đối soát bằng Flow-side evidence. Khác biệt packaged-vs-source chưa xác định (nghi: listener/timing trong bundle, hoặc draft-request cửa sổ thời gian). Bước tiếp: instrument đường warn vào log file (console.warn không vào file log của app) hoặc diff execution packaged-vs-source trên cùng tab.

- Triệu chứng: click Generate thật → request được thấy → ~1s sau FLOW_SUBMISSION_RECONCILIATION_REQUIRED; generation vẫn thành công phía Google (5/5 lượt sinh tile mới; tile #13-#17).
- Đã loại trừ: promptMatches/singleOutput sai (diagnostic không fires), thiếu settle (đã vá). Còn lại: requestCount>1 với các body KHÁC nhau (dedupe theo hash body không đủ — attempt #6 vẫn trip, nghĩa là UI gửi lại request với body khác — có thể transport retry với nonce mới).
- Blocker chẩn đoán: console.warn của main process KHÔNG vào log file (chỉ stderr + logger IPC); các probe listener ngoài không thấy request generation (nghi vấn multi-tab/attach timing — có 3 tab trùng project).
- Bước tiếp theo: chạy 1 lượt diagnostic từ SOURCE (console.warn hiện trực tiếp) hoặc monitor sửa để bắt mọi tab + service worker → xem 2 body khác nhau khác gì → sửa inspector sao cho: nhiều body khác nhau của CÙNG prompt/project/x1 không còn bị coi là mơ hồ (so sánh nội dung đã chuẩn hóa), vẫn giữ chặn prompt/output khác.
- Trạng thái receipt: 4 receipt RECONCILIATION_REQUIRED (workspaces 20261025/20261025b/c/e/f), TẤT CẢ đã đối soát bằng evidence Flow-side (tile mới xuất hiện mỗi lượt, pending=0); KHÔNG xóa/sửa receipt; KHÔNG retry các job đó.
- Ảnh lượt #1 đã tải, hash, xem nội dung: khớp prompt + negative prompt có hiệu lực (không text/watermark) — bằng chứng bản sửa paragraph hoạt động trên Flow thật.

## F-7 [Đã vá] Download host allowlist thiếu flow.google.com

- Tile mới dùng URL https://flow.google.com/asb/... — assertFlowCdnUrl cũ chỉ cho flow-content.google/googleusercontent/googleapis/gstatic → từ chối đúng theo luật cũ nhưng giờ sẽ chặn output thật. Đã thêm flow.google.com vào allowlist (cùng host phiên, https, không credential trong URL).

## F-5 [Quan sát] Chrome innerText/serialization là nguồn lỗi xuyên suốt của T2I

- Ba sự cố độc lập (bug gốc 23/10, fixture 24/10, và rủi ro tương lai) đều xoay quanh việc đọc nội dung editor. Khuyến nghị: mọi code路径 mới liên quan prompt phải dùng `readFlowPrompt` + test fixture `<p>`-based (đã có `test_flow_prompt_document.ts`).

## Chưa điều tra / coverage gaps (tính đến 24/10 đêm)
- T2I live trên Flow UI mới (chặn bởi F-1). T2V/I2V live chưa thử trong lượt này.
- Workflow A/B/C (subtitle/TTS/export) chưa chạy lại trong phiên này.
- Soak/performance (mục 11 brief) chưa bắt đầu.
- Clean Windows install: BLOCKED (không có VM sạch).

## F-8 [P1 — DESIGN GAP, phát hiện 25/10 tối] Đường I2V/video chưa nằm dưới thiết kế gate credit

- Hiện tượng: scene motionType=video + i2v mà chưa có keyframe → service rẽ vào legacy executeUiGeneration (CDP Trusted UI) để sinh keyframe — KHÔNG qua receipt/gate credit của bộ T2I recovery.
- Rủi ro: generation Veo/video tiêu credits thật mà không qua quote-gate/flowMaxCredits (gate chỉ bảo vệ đường T2I đã recovery).
- Trạng thái tài liệu cũ khớp: VANHSUB_FLOW_T2I_RECOVERY_ACCEPTANCE.md ghi rõ "T2V/I2V không được mở rộng trong nhiệm vụ này" — khoảng trống đã biết, không phải regression mới.
- Khuyến nghị: đưa I2V vào thiết kế gate (quote đọc trước, receipt, x1) TRƯỚC khi chạy video thật; hoặc chỉ chạy I2V khi user phê duyệt riêng mức credit Veo.
- KHÔNG chạy I2V legacy trong phiên 25/10 — quyết định theo ưu tiên an toàn credit của brief (mục 10).
