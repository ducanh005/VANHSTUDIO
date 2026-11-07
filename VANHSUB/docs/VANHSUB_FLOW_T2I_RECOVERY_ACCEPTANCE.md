# VANHSUB — Flow T2I Recovery & Automatic Acceptance

Ngày cập nhật: 22/10/2026, giờ Việt Nam. Tiếp tục mục 11 của `VANHSUB_FLOW_CREDITS_ONLY_AUDIT.md`; chỉ xử lý T2I và boundary Stage 6 → Stage 7.

**Kết quả mới nhất — 23/10/2026, 10:34 (Việt Nam):** đăng nhập đã hợp lệ; một lần gọi production T2I service được thực hiện theo phê duyệt mới. Dừng trước Generate do `FLOW_PROMPT_INTEGRITY_FAILED`: ProseMirror biểu diễn hai dòng bằng hai `<p>`, `innerText` trả hai newline. Receipt đã lưu trước input, giữ `RECONCILIATION_REQUIRED`; 0 click Generate, không có artifact mới, không retry. Xem mục 12. Blocker đăng nhập ở mục 11 là lịch sử, không còn là blocker hiện tại.

## 1. Kết luận

Đã sửa thứ tự credit gate/receipt để giữ chỗ **trước nhập prompt**, bổ sung correlation giữa request do UI gửi, response và tile đúng project, hoàn thiện tải/kiểm định/publish artifact, và recovery không mua thêm generation. Regression Chrome fixture/native và Stage 6 → checkpoint/restart → render FFmpeg PASS.

**Chưa gửi Google generation mới trong lượt này.** Flow live chỉ được kiểm tra session/project/model/mode/x1/quote. Lượt duyệt cũ đã tiêu thụ, không dùng lại. Bản sửa mới chưa được đánh dấu Live T2I PASS hoặc Full AI Live E2E PASS.

**Cập nhật 20:21 ngày 22/10/2026:** người dùng đã duyệt riêng đúng một T2I mới, Nano Banana 2.1 · Image · x1 · quote tối đa 0 credit. Preflight mới bị chặn bởi trạng thái đăng nhập Google; chưa vào production generation service, chưa nhập prompt/click, không có receipt mới. Chi tiết mục 11. Snapshot FLOW_READY lúc 14:23–14:33 không còn là bằng chứng session hiện tại.

## 2. Repository và bảo toàn

- `D:/DEAN/DEAN/VANHSUB` hiện thuộc nhánh `codex/douyin-media-inspection`, có file chưa theo dõi. Không checkout/chuyển nhánh hoặc sửa checkout đó.
- Source được sửa tại worktree đang giữ đúng branch: `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`.
- Branch: `codex/aistudio-phase6-beta-20261021`; HEAD giữ `c9a1c3e51cc4b653bca7c98440c874273e9a9d89`. Không stage/commit/push/merge/reset.
- Baseline và bản sao trước sửa: `temp/flow-t2i-recovery/baseline.json`, `backup/`; lưu cả trạng thái checkout D và hash ảnh thật, file đối soát, receipt cũ, ASAR R2/candidate trước.
- Receipt cũ version 1 `SUBMITTING` được giữ nguyên byte. Code mới không tự đổi nó thành `COMPLETED`, không gắn ảnh đã đối soát vào episode như một generation tự động thành công.
- Ảnh JPEG thật trước đây vẫn là `D:/VANHSUB-FlowCredits-20261021/acceptance/t2i-approved-20261021/media/reconciled-flow-image.jpg`, SHA-256 `d8909439b3e0589a52a4f694ce73c02de29a56e2abc40fca3159812e2651bf55`.
- Không xóa collection test hoặc file người dùng; không ghi đè Beta R2/Preview-T2I-Fix. Candidate mới nằm riêng, xem mục 9.
- Không sửa LLM, TTS, ASR/OCR, Extension, dependency/lockfile hoặc kiến trúc render.

## 3. Root cause và bản sửa

| Lỗ hổng đã xác minh từ source/UAT | Sửa nguyên nhân gốc |
|---|---|
| Callback cũ ghi receipt sau nhập prompt; newline có thể submit trước callback | `beforeInput` bắt buộc: xác minh quote/project rồi exclusive-create + fsync receipt trước mọi thay đổi editor. T2I không còn đường bỏ qua bằng cách đặt `requireCreditApproval=false` |
| Receipt chỉ biết SUBMITTING/COMPLETED, không lưu đủ phase/correlation để recovery | Receipt v2 lưu session/project/scene/request key, hash toàn prompt, baseline asset IDs và phase. Legacy receipt không bị migrate âm thầm |
| Tile mới/spinner/editor rỗng không chứng minh là output của job này | Theo dõi thụ động request UI + chính response của request đó; chỉ nhận một output mới đúng asset ID/URL/project trên DOM, không thuộc baseline |
| HTTP 200 hoặc fallback sang response RPC khác có thể bị hiểu nhầm là thành công | Parser chỉ chấp nhận frame image RPC chính xác, một request với project/full prompt và x1 đúng. Response thiếu/mơ hồ, RPC khác, tile cũ hoặc project khác phải đối soát |
| Có thể overwrite file cũ khi đổi extension PNG → JPEG sau download | Sniff magic/MIME trước, chọn extension thật, kiểm định trong file tạm riêng, publish bằng hard link tạo mới độc quyền. File đã tồn tại không bị thay |
| Crash sau publish nhưng trước ghi COMPLETED có thể gây tạo lại media | Ghi hash/path artifact đã kiểm định trước publish; restart xác minh file đó hoặc tải lại remote asset đã correlate, không submit lại |

T2I vẫn đi qua `AiStudioPipelineEngine → AiStudioVisualService → BrowserAutomationAdapter`. Hai module mới chỉ tách phần T2I submission và image artifact để kiểm tra được; không tạo pipeline LLM/TTS/render thứ hai. T2V/I2V không được mở rộng trong nhiệm vụ này.

## 4. Prompt integrity và credit/receipt safety

Thứ tự cuối:

`Project/session + gallery baseline → quote/consent → receipt fsync → fill full prompt → read back → recheck quote/prompt/gallery → mark click-started → đúng một click → observe → download/native validation → atomic artifact → receipt COMPLETED → scene/checkpoint`.

- Positive và negative prompt được nối thành toàn bộ nội dung, hash trước nhập. Chỉ chuẩn hóa CRLF và khoảng trắng ở hai đầu, không gom/mất các dòng bên trong.
- Dùng `fill` cho T2I, không phát Enter bằng keyboard typing. Không dùng DOM fallback khi nhập lỗi. Read-back phải khớp cả positive và negative trước Generate.
- Nếu input tự sinh request/tile hoặc nội dung bị đổi, đã có receipt bảo vệ; app dừng, không bấm thêm Generate.
- Nút Generate phải có đúng một phần tử hiện và enabled trong prompt container, tên chính xác. Không chọn nút “Tạo bộ sưu tập”.
- Đọc lại quote trước click; model/mode/x1/giá phải đúng phạm vi đã giữ chỗ. Giá thay đổi thì dừng, không đổi model hoặc mua thêm output.
- Khóa reserve theo thư mục và exclusive receipt ngăn hai reservation vượt nhau. Lock còn lại sau crash được giữ để đối soát, không tự xóa để cho phép retry.
- Timeout/cancel không chứng minh chưa gửi. Receipt chưa rõ kết quả vẫn giữ chỗ output/budget, kể cả đổi nonce.
- Đây không phải hard cap do Google bảo đảm; credit thực tế vẫn chưa đối soát. Không gọi API AI có billing riêng, không tự retry generation.

## 5. Completion detection

| Trạng thái | Ý nghĩa |
|---|---|
| `NOT_SUBMITTED` | Thiếu gate, preflight bị chặn hoặc chưa chạm editor/click; không tự chạy lại |
| `SUBMITTING` | Receipt đã fsync trước input; phase phân biệt chuẩn bị và bắt đầu click |
| `GENERATING` | Có dấu hiệu request/tile đang chạy; kể cả remote media ready vẫn chưa phải artifact COMPLETED |
| `COMPLETED` | Backend đã download, MIME/magic/native decode/hash, publish artifact và ghi receipt thành công |
| `FAILED` | Request đã correlate bị provider từ chối và tile lỗi mới xác minh được; vẫn không retry/free budget tự động |
| `RECONCILIATION_REQUIRED` | Timeout, cancel sau input/submission, prompt/output/project không khớp hoặc bằng chứng chưa đủ |

Correlation dùng listener của **browser context** để thấy request do UI/service worker gửi, không chỉ Page. Chỉ đọc request/response của chính phiên; không xuất cookie, đọc auth header, tạo/replay generation RPC hoặc thay handshake/fingerprint.

Contract hiện hỗ trợ form `batchexecute`, image frame `ogiZ0b`, một task/output, project ID và full prompt khớp; response phải có đúng một cặp asset ID/HTTPS URL. Tile hoàn tất phải mới so với baseline, cùng project, cùng ID/URL, ảnh đã load, không pending. Không ghép UUID và URL rời rạc theo thứ tự hoặc fallback sang RPC khác.

**Giới hạn phải nghiệm thu live:** đây là contract đã kiểm thử bằng Chrome/transport fixture và source protocol sẵn có; chưa xác nhận lại cấu trúc request/response/CDN URL trên một generation mới sau sửa. Nếu Google đổi schema, response URL khác preview URL, hoặc output mơ hồ, code giữ đối soát thay vì báo PASS. Không tuyên bố Google chứng nhận CDP như API tích hợp chính thức.

## 6. Download, artifact và recovery

- Dùng request context của browser đã kết nối. Không export/copy cookie, không thêm Cookie header thủ công.
- Chỉ HTTPS, không username/password trong URL; host Flow CDN/Google CDN phải khớp domain, không chấp nhận hậu tố giả.
- `maxRedirects=0`: không follow redirect, kể cả response 302 trỏ host khác.
- Kiểm tra kích thước tối đa 128 MiB, MIME so với magic bytes, dimensions, FFprobe stream và FFmpeg full decode.
- PNG/JPEG/WebP/GIF được đặt đúng extension; MIME mâu thuẫn/corrupt/HTML bị từ chối trước publish.
- File tạm cùng thư mục được ghi độc quyền + fsync; hash/path validated được ghi vào receipt trước atomic publish. Hard link không thay file đã tồn tại; chỉ dọn file tạm do chính lần gọi tạo ra.
- Chỉ sau đó mới gắn provenance project/session/scene/request/asset/hash và ghi COMPLETED. Stage 6 mới đánh scene ready và persist checkpoint.
- Restart với completed receipt kiểm tra hash/native file; chưa rõ output thì không generation. Remote asset đã correlate có thể tải lại, hoặc dùng file validated đã publish trước crash. Legacy/mismatched/tampered receipt phải đối soát.
- Cancel download không publish file, tháo listener và dispose response đến muộn. Playwright không có per-request AbortSignal cho APIRequestContext: underlying GET có thể tiếp tục tối đa timeout 30 giây; không dispose context dùng chung hoặc tự gọi thêm request. Không báo đã hủy server-side generation.

## 7. Regression không tiêu credit

`tests/test_flow_t2i_recovery.ts`: Chrome fixture cô lập, HTTP transport fixture và FFprobe/FFmpeg thật; **không kết nối tài khoản Google để generation**.

| Kiểm tra | Kết quả |
|---|---|
| Thiếu durable gate / budget không duyệt | PASS — không nhập/click |
| Multiline + negative prompt / Enter-submit / text bị đổi | PASS — giữ full prompt, không Enter sớm; altered prompt không click |
| Input tự gửi ngoài ý muốn | PASS — receipt có trước, không click lần hai |
| Selector sidebar / đúng một Generate | PASS |
| Progress tile mới / completed asset correlated | PASS |
| Tile cũ / sai project / HTTP 200 thiếu media / RPC khác | PASS — không COMPLETED |
| Timeout sau submit / cancel sau submit | PASS — giữ receipt, không retry, tháo context listeners |
| Provider từ chối + tile lỗi có correlation | PASS — giữ FAILED, progress không nhảy lùi |
| CDN, MIME/magic, extension thật, FFprobe/FFmpeg | Native PASS |
| Domain giả / redirect / corrupt image / MIME sai | PASS — không publish |
| Cancel khi download, response đến muộn | PASS — không artifact, response được dispose |
| Restart sau mất kết nối tải file | PASS — chỉ phục hồi asset đã correlate, không generation thêm |
| Crash giữa publish và COMPLETED | PASS — kiểm tra file/hash đã ghi trước, không download/generation thêm |
| Duplicate receipt / nonce / legacy SUBMITTING | PASS — không submit lại, legacy byte giữ nguyên |

`tests/test_flow_credit_safety.ts` tiếp tục PASS policy/defaults/native safety; contract callback cũ thiếu `beforeInput` nay phải bị chặn trước input. Positive completion đã chuyển sang fixture request/response/DOM nghiêm ngặt ở test recovery; không bỏ assertion no-double-click hoặc kiểm định artifact để lấy PASS.

Bằng chứng local: `temp/flow-t2i-recovery/regression-final.log`, `regression-result.json`, `credit-safety.log`, `typecheck-final.log`. Harness lỗi tracing do thay cả APIRequestContext, job fixture dùng trùng directory và bộ đếm tổng bị ảnh hưởng bởi case bổ sung đã được sửa trong fixture/isolation; không đổi điều kiện production completion để ép PASS.

## 8. Stage 6 → Stage 7 offline

`tests/test_flow_t2i_stage_render.ts` sử dụng engine thật, entry state stage 5 **được seed rõ là fixture**, Chrome/provider transport fixture, ảnh test màu và đoạn audio Piper có sẵn từ UAT cũ. Không giả các stage Facts/Script thành Live PASS.

Đã xác minh:

1. Stage 6 gọi đúng production visual service, lưu artifact hợp lệ và provenance khớp scene/session/hash.
2. Scene ready và checkpoint được ghi qua engine.
3. Khởi tạo engine lại, resume Stage 6 không thêm submission fixture.
4. Duyệt Stage 7 tạo video 3 giây bằng FFmpeg, có audio/video streams và full decode thành công.
5. Video/audio gốc không bị sửa.

Native video SHA-256: `41a8083067616e006ee4768c05eac3ebd374d551662eac42e735ba7b663bdb6d`. Đường dẫn đầy đủ trong `temp/flow-t2i-recovery/stage-result.json`. **Đây là Automated + Native Runtime PASS, không phải Flow Live E2E PASS.** Ảnh thật đã đối soát thủ công trước đây không được đưa vào episode test như generation tự động.

## 9. Build, candidate và Git

TypeScript PASS. Production renderer/main/preload full build PASS (renderer 53,314 s; main/preload 32,471 s). Sau bản sửa nhỏ để progress không giảm khi FAILED, chỉ rebuild main/preload; toàn bộ input renderer không đổi, 21 file renderer output được so byte với full build rồi tái sử dụng. Không rerun renderer hoặc các suite ASR/TTS/LLM không liên quan.

Candidate mới: `D:/VANHSUB-FlowCredits-20261021/Preview-T2I-Recovery-20261022/Run Beta.cmd`. Profile riêng trong `Beta-Profile`, Bridge tắt để tránh tranh cổng, CDP dùng profile test đã xác minh. Không thay Preview-T2I-Fix, Beta R2 hoặc thư mục dữ liệu của chúng. Không download model hoặc cập nhật dependency; dùng runtime Electron baseline 43.5.0. Đây là directory build chưa ký, không phải bộ cài NSIS mới.

- TypeScript, full build và main/preload build cuối: PASS. Main/preload sau chỉnh progress: 13,787 s; renderer tái sử dụng đã so byte 21 file.
- Packaged smoke: PASS — Electron khởi động, renderer/preload/IPC, cấu hình Flow không yêu cầu media API key, consent mặc định off, production debug không expose, CDP đúng profile. Không generation và không chạy lại pipeline ASR/TTS không liên quan.
- 285 source files khớp build; main/preload/HTML trong ASAR khớp compiler output. Marker gate/receipt-before-input/correlation/native validation có trong bundle production.
- Source set SHA-256: `2f1c442325f467f51631b083dc9646be3e3096feac11b430e1600bc009ec7061`.
- EXE SHA-256: `fe372b00e9d2319d019dd1f1c85448691de1ccadc5e19aeaa6d3e5aeee1b667f`.
- ASAR SHA-256: `5bbe4805514fb31c43ccb8bd174112ccbeeb395bd6bab806566e758d03d3a907`.
- 207 file trước khi thêm manifest; không symlink/junction, không profile/receipt/secret/ONNX trong ASAR. Manifest cạnh EXE: `flow-t2i-recovery-manifest.json`; bản local `temp/flow-t2i-recovery/final-manifest.json`.
- Hash ảnh/file đối soát/receipt cũ/R2 ASAR/candidate cũ và EXE candidate cũ: không đổi. Checkout D giữ nhánh và trạng thái Git như baseline; các module Official/Piper/Kokoro/TTS/lockfile không đổi. Smoke main process đã thoát.
- Video native offline đã sao chép không ghi đè tới `D:/VANHSUB-FlowCredits-20261021/acceptance/T2I-recovery-OFFLINE-native-3s-20261022.mp4`, hash khớp mục 8.

Source mới trong lượt này: `main/browser-automation/FlowT2iSubmission.ts`, `FlowImageArtifact.ts`; fixture/test mới: `tests/flowT2iFixture.ts`, `test_flow_t2i_recovery.ts`, `test_flow_t2i_stage_render.ts`.

Source sửa thêm: `FlowCreditLedger.ts`, `AiStudioVisualService.ts`, `BrowserAutomationAdapter.ts`, browser automation types và contract test credit safety. Các sửa chữa trước đó vẫn giữ nguyên; không tự commit/push/merge.

## 10. Chuẩn bị Live — dừng trước Generate

Preflight chỉ đọc đã xác minh CDP 9224, đúng profile Chrome Flow test, session `FLOW_READY` và project test cũ được chỉ định. Project còn ảnh/collection trước đây, không có tile pending; tab người dùng không bị điều hướng hoặc đóng. Bridge chưa kết nối; route này dùng CDP, không đánh dấu Extension Live PASS.

Snapshot cuối lúc **14:23:12 ngày 22/10/2026 (Việt Nam)**: **Nano Banana 2.1 · image · x1 · quote 0 credit**, balance chưa xác minh, không security alert. Job mới riêng chưa có receipt; plan `approved=false`, không dùng receipt/consent của lượt đã tiêu thụ. Giá phải được đọc lại trước thao tác sau khi người dùng phản hồi; snapshot không bảo đảm giá giữ nguyên.

Prompt chuẩn bị:

> Three friendly geometric robots competing at a chessboard, blue and orange light, editorial illustration, wide composition.
>
> Avoid: text, logos, watermark, blur.

Đề xuất **một request T2I mới**, model trên, x1, budget 0 credit. Chỉ sau khi người dùng duyệt riêng mới nhập prompt/chạy service. Trước input và trước click phải đọc lại quote/model/mode/x1; khác phạm vi hoặc security restriction thì dừng. Không bật chấp nhận giá chưa biết, không retry timeout/unusual activity, không gọi API AI tính phí.

Còn thiếu duy nhất cho bước generation thử mới là phê duyệt riêng; nếu session/quote đổi trong lúc chờ thì phải kiểm tra lại trước thực hiện. Live T2I của source mới, exact prompt/asset correlation thật và tự động hoàn tất receipt/artifact vẫn **NOT TESTED** cho tới lúc đó. Không tuyên bố Automatic Acceptance hoặc Production Ready từ các fixture PASS.

## 11. Phê duyệt mới — preflight thực tế dừng trước generation

Người dùng đã duyệt đúng một T2I mới trên bản `Preview-T2I-Recovery-20261022`, với prompt ở mục 10, Nano Banana 2.1, Image, x1, quote tối đa 0 credit; không API AI tính phí, không retry. Phê duyệt mới này **chưa được sử dụng cho generation**. Phê duyệt lịch sử của mục 11 báo cáo Flow Credits Only vẫn đã tiêu thụ và không được tái sử dụng.

Preflight thực hiện lúc **20:18:44–20:18:59 ngày 22/10/2026 (Việt Nam)**:

- SHA-256 EXE/ASAR đúng candidate mục 9; toàn bộ 285 source file vẫn khớp build. Không sửa source production hoặc thay candidate để thực hiện lượt này.
- CDP 9224 kết nối được, process/profile Chrome VANHSUB test được xác minh. `SESSION_UNVERIFIED`; project URL đưa về trang giới thiệu `flow.google.com`, không có prompt editor, model selector hoặc credit quote.
- Vì không đọc được quote/project hiện tại nên dừng trước lời gọi production T2I service: **0 lần gọi service generation, 0 nhập prompt, 0 click Generate, 0 receipt mới, 0 artifact mới**. Không suy snapshot 0 credit ban chiều thành quote hiện tại.
- Chẩn đoán tiếp theo chỉ đọc DOM. Sau đó chỉ bấm nút vào ứng dụng “Tạo bằng Google Flow” trên trang giới thiệu, không phải nút Generate trong project. Lúc **20:21:19**, Google chuyển sang `accounts.google.com` với biểu mẫu đăng nhập. Không nhập tài khoản/mật khẩu, trích cookie/token hoặc vượt xác minh.
- Chưa đủ bằng chứng để gọi đây là lỗi completion/download của candidate; generation chưa bắt đầu. Không kết luận chắc chắn token hết hạn chỉ từ redirect, nhưng yêu cầu đăng nhập hiện tại là blocker đã quan sát được.

| Yêu cầu nghiệm thu trong lượt mới | Trạng thái thực tế |
|---|---|
| Candidate/source đúng bản đã duyệt | PASS — hash và 285 source file khớp |
| Chrome CDP và profile riêng | Real Runtime PASS |
| Project/model/mode/x1/quote ngay trước generation | BLOCKED — Google đang yêu cầu đăng nhập |
| Receipt trước nhập prompt | NOT TESTED live — chưa tới bước giữ chỗ, không tạo receipt giả |
| Positive/negative prompt nguyên vẹn | NOT TESTED live — chưa nhập |
| Chỉ một Generate | 0 click; gate dừng an toàn, chưa chứng minh one-click live |
| Theo dõi generation và completion correlation | NOT TESTED |
| Download/MIME/magic/FFmpeg/SHA-256 ảnh mới | NOT TESTED |
| Artifact scene/project/session, receipt COMPLETED, checkpoint | NOT TESTED; không tạo checkpoint thành công giả |
| Restart không generation thêm | NOT TESTED trên output thật mới; regression offline trước đó vẫn giữ nguyên |
| Stage 6 → Stage 7 bằng artifact thật mới | NOT TESTED — chưa có artifact mới; không dùng ảnh đối soát cũ thay thế |

Evidence local riêng: thư mục acceptance của job mới chứa `live-result.json`, `after-attempt.private.png`, `preflight-stop-diagnosis.json`, `entry-state.json`, `entry-state.private.png`. Bản tổng hợp ở `temp/flow-t2i-recovery/live-acceptance-status.json`; các file này không stage/commit/push. Không lưu request headers, cookie, token hoặc raw response tài khoản. Trường classification trong harness ban đầu mô tả đường thực thi dự định; bộ đếm service=0 và status tổng hợp mới là kết quả nghiệm thu: **Real Browser Preflight BLOCKED; Live Provider NOT TESTED**.

Một thao tác cần người dùng: hoàn tất đăng nhập Google trong cửa sổ Chrome test đã mở. Sau khi người dùng báo đăng nhập xong, kiểm tra lại project/model/Image/x1/quote 0 và receipt; chỉ khi đúng toàn bộ điều kiện mới dùng một lượt được duyệt đang còn chưa sử dụng. Không tự tạo request khác hoặc retry sau submission không rõ.

Git vẫn ở `codex/aistudio-phase6-beta-20261021`, HEAD `c9a1c3e51cc4b653bca7c98440c874273e9a9d89`; không stage/commit/push/merge. Chỉ cập nhật tài liệu và harness/evidence bỏ qua bởi Git; không chạy lại suite/build đã PASS vì source production không thay đổi. Hash ảnh, file đối soát, receipt cũ, Preview-T2I-Fix và Beta R2 được kiểm tra giữ nguyên.

## 12. Một lần thử được duyệt — 23/10/2026

### Preflight và phạm vi thực thi

Chrome test chưa chạy lúc bắt đầu; đã kiểm tra không có process sử dụng profile riêng rồi chạy launcher đã chuẩn bị. Không mở VANHSUB instance mới hoặc dùng Chrome profile cá nhân.

Preflight lúc **10:33:46**, kiểm tra lại ngay trước service lúc **10:34:04**: đúng project test, profile CDP 9224 đã xác minh, `FLOW_READY`, **Nano Banana 2.1 · Image · x1 · quote 0 credit**, không reference, không restriction/pending tile, receipt count 0. Quote ban ngày 22 không được tái sử dụng.

Candidate EXE/ASAR và 285 source file khớp hash mục 9. Harness gọi **production `AiStudioVisualService.generateViaGoogleFlow` từ source khớp build**, dùng BrowserAutomationAdapter và Chrome thật; không inject RPC client, transport fixture hoặc kết quả giả. Callback được bọc để quan sát nhưng vẫn gọi nguyên callback production. Đây là nghiệm thu runtime service với UI Google thật; **không phải bằng chứng gọi service từ IPC/UI của EXE đóng gói**. Candidate không bị sửa hoặc thay thế.

Nhật ký phê duyệt mới được tạo độc quyền trước service. Chỉ một lời gọi service; không gọi T2V/I2V/SEO/LLM/API AI tính phí. Lượt thử đã bắt đầu và sẽ không tự tái sử dụng phê duyệt đó để chạy lại.

### Nguyên nhân dừng và bằng chứng

1. **10:34:04.705**: receipt v2 `SUBMITTING`, phase `BEFORE_INPUT`, quote 0 đã được lưu qua production ledger trước thao tác editor.
2. **10:34:04.732**: quan sát input đầu tiên, sau receipt khoảng 27 ms. Không gửi Enter hoặc bấm Generate.
3. **10:34:04.751**: adapter trả `FLOW_PROMPT_INTEGRITY_FAILED`; service dừng, receipt thành `RECONCILIATION_REQUIRED`.
4. Quan sát DOM chỉ đọc sau dừng: nội dung đúng hai đoạn `<p>positive</p><p>Avoid: negative</p>`. `innerText` chèn **hai** newline giữa các đoạn, trong khi prompt được duyệt chứa **một** newline. `textContent` lại nối hai đoạn không có newline. Cả positive/negative text đầy đủ; không có bằng chứng mất từ, nhưng chuỗi so sánh không khớp.
5. SHA-256 prompt đã duyệt: `55dd0ca3592192f4c664633e9619d89bcb0d2679c937996ee1d9ed32a0182a02`. SHA-256 innerText: `644403d995ed29fc30953a2d5f570d903b5de9709e54721721b330e76cbfd1fb`.
6. Gate hoạt động an toàn: **0 click Generate được quan sát**, 0 request generation khớp parser, gallery vẫn 2 tile gồm ảnh cũ và collection cũ, không pending, không media mới. Không coi số request khớp bằng 0 là bằng chứng độc lập rằng mọi schema request có thể có đều bị theo dõi.

Root cause ở cách serialize nội dung editor trong `FlowT2iSubmission.ts`: `canonical(await editor.innerText())` chỉ chuẩn hóa CR/LF và trim, chưa xử lý ranh giới paragraph của ProseMirror. Fixture trước đó chưa mô phỏng biểu diễn hai paragraph này, nên PASS offline không chứng minh prompt integrity trên editor thật. Không nới lỏng guard hoặc sửa candidate rồi retry để lấy PASS.

Hướng sửa tiếp theo: đọc nội dung editor theo cấu trúc paragraph/hard-break có quy tắc xác định, giữ mọi ký tự và dòng trống có chủ đích; regression phải bao gồm DOM `<p>` thật, multiline/negative, `<br>`, mất/thay từ và Enter-submit. Không dùng chuẩn hóa toàn bộ whitespace vì có thể che mất thay đổi prompt. Bản sửa này **chưa được thực hiện trong lượt nghiệm thu**.

### Kết quả chín tiêu chí

| Tiêu chí | Bằng chứng lượt thật |
|---|---|
| Receipt trước input | Real Runtime PASS — callback lưu trước input khoảng 27 ms |
| Positive/negative prompt | Nội dung từ ngữ đủ; **FAIL** so khớp chuỗi do paragraph/newline |
| Đúng một Generate | 0 click; dừng an toàn, **chưa đạt** one-generation acceptance |
| Nhận diện/theo dõi generation | NOT TESTED — dừng trước click |
| Tự tải ảnh hoàn tất | NOT TESTED — không có ảnh mới |
| MIME/magic/FFmpeg/SHA-256 artifact mới | NOT TESTED |
| Artifact đúng scene/project/session | NOT TESTED; không gắn ảnh cũ làm kết quả mới |
| Receipt và checkpoint | Receipt `RECONCILIATION_REQUIRED`; không tạo COMPLETED/checkpoint stage6 giả |
| Restart không phát sinh generation mới | NOT TESTED live sau thành công; không gọi lại service vì receipt chưa đối soát |
| Stage 6 → 7 từ artifact mới | NOT TESTED — không có artifact mới để render |

**Automatic T2I acceptance: FAIL/BLOCKED ở prompt integrity. Live Provider generation completion: NOT TESTED.** Không có lỗi unusual activity được quan sát trong lượt này; chưa gửi tới bước đủ để đánh giá provider generation. Không tuyên bố Flow Live PASS hoặc full pipeline PASS. Actual credits vẫn chưa đối soát; không suy quote 0 thành hard cap provider.

Evidence riêng tại `D:/VANHSUB-FlowCredits-20261021/acceptance/t2i-recovery-20261022-cd7c12fb`: `new-approval-attempt.json`, `live-result.json`, `after-attempt.private.png`, `prompt-readonly-diagnosis.json`, `.flow-receipts/`. Kết quả preflight thất bại ngày 22 giữ riêng trong `prelogin-preflight-result.json`. Không publish project ID, signed media URL, cookie hoặc tài khoản trong báo cáo này.

Receipt mới SHA-256 sau dừng: `86112a13addbfee3bdeee390a4706872c32e032b3c3fd822591097f88b021369`. Giữ nguyên receipt này, không xóa hoặc đổi trạng thái để cho phép retry. Ảnh/receipt/collection cũ, candidate trước và Beta R2 giữ nguyên. Source production và Git HEAD không thay đổi, không commit/push/merge; không chạy lại build/regression đã PASS vì chưa sửa source.

## 13. Bản sửa prompt integrity offline — xác minh hoàn tất 24/10/2026

Trạng thái mục 12 → 13: bản sửa `readFlowPrompt` (đọc ranh giới dòng theo cấu trúc DOM, không dựa `innerText` phụ thuộc CSS) đã được viết ngày 23/10 kèm `tests/test_flow_prompt_document.ts`; lượt regression rộng hơn ngày 23/10 trả exit 1 tại `test_flow_t2i_recovery.ts:25` (`good.r.remoteMediaReady` = undefined) và TypeScript log rỗng. Phiên 24/10 chẩn đoán và đóng các điểm còn thiếu sau.

### Nguyên nhân gốc của failure regression 23/10 (có bằng chứng probe)

- `temp/flow-t2i-recovery/probe-dom.log`: Playwright `fill()` trên contenteditable **thường** (fixture cũ) tạo DOM hỗn hợp `[TEXT("Positive…"), <div>Avoid…</div>]` — bare text đứng cạnh block. `readFlowPrompt` chặn đúng thiết kế bằng `FLOW_PROMPT_UNSUPPORTED_NODE` (guard chống node không serialize được, ví dụ chip). `runApprovedT2i` catch lỗi → trả `RECONCILIATION_REQUIRED` → mất `remoteMediaReady`. `innerText` trả đúng prompt 1 newline nên bản cũ PASS — khớp hoàn toàn biểu hiện.
- Trên Flow thật editor là ProseMirror: schema luôn chuẩn hóa thành `<p>` block, không bao giờ sinh bare text cạnh block. Fixture cũ **không trung thực** với editor thật. Chẩn đoán: nguyên nhân nằm ở fixture, không phải production code.

### Sửa (chỉ fixture + assertion test; production `FlowT2iSubmission.ts` KHÔNG đổi trong đợt này)

- `tests/flowT2iFixture.ts`: (1) chuẩn hóa editor thành một `<p>` mỗi dòng logic sau input (debounced, cancel+reschedule, escape HTML, giữ nguyên DOM đã all-blocks) — mô phỏng schema ProseMirror; (2) thêm `editorPrompt()` serializer block-aware: RPC body ghép các block bằng `\n` đơn — vì probe xác nhận Chrome `innerText` trả `\n\n` giữa các `<p>` **kể cả khi `p{margin:0}`** (khoảng trắng là cấu trúc block, không phải margin); (3) `<style>p{margin:0}</style>` giữ làm tài liệu hóa ý định.
- `tests/test_flow_t2i_recovery.ts`: assertion `beforeSubmit` đổi từ `innerText` sang `readFlowPrompt` (bộ đọc chuẩn theo cấu trúc DOM — đúng tinh thần bản sửa; `innerText` phụ thuộc CSS là chính thứ gây bug gốc).
- Regression log mới: `temp/flow-t2i-recovery/prompt-fix-regression-v2.log`; kết quả `regression-result.json` mới; bản PASS 22/10 được bảo toàn tại `regression-result-20261022-PASS.json`.

### Kết quả xác minh 24/10 (giờ Việt Nam)

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| `test_flow_t2i_recovery.ts` full regression | **PASS 23/23 checks**, exit 0, hermetic (`liveProvider:false`, `realGoogleGenerations:0`) | `prompt-fix-regression-v2.log` |
| `test_flow_prompt_document.ts` (paragraph integrity, Chrome thật) | **PASS**, exit 0 | `prompt-fix-paragraph.log` |
| `test_flow_t2i_stage_render.ts` (dùng fixture vừa sửa) | **PASS**, exit 0 | `stage-render-after-fixture-fix.log` |
| TypeScript `tsc --noEmit` toàn main tree | **PASS**, 0 error | `prompt-fix-types-v2.log` |

Probe trung gian: `probe-v3.log` (chẩn đoán từng bước, bắt lỗi `FLOW_PROMPT_UNSUPPORTED_NODE`), `probe-v3-after-fix.log`, `probe-v4-after-serializer.log` (RPC prompt 1 newline khớp, 1 click, 1 tile đúng asset/project).

### Giới hạn — không đổi so với mục 12

- Đây là **AUTOMATED TEST + CHROME/PROVIDER FIXTURE + NATIVE RUNTIME** PASS. Vẫn **chưa có**: generation live sau sửa (cần phê duyệt mới của người dùng; lượt duyệt cũ đã tiêu), nghiệm thu từ EXE đóng gói qua UI của app.
- Receipt `t2i-recovery-20261022-cd7c12fb` vẫn `RECONCILIATION_REQUIRED`, giữ nguyên. `doNotRetry` vẫn đúng cho lượt đã tiêu.
- Git: branch `codex/aistudio-phase6-beta-20261021`, HEAD `c9a1c3e…` không đổi; không stage/commit/push/merge. Candidate `Preview-T2I-Recovery-20261022` không rebuild trong đợt này (chỉ fixture/test đổi — production bundle không đổi theo source hiện tại, tức candidate cũ KHÔNG chứa fixture; bản candidate tương lai phải build lại nếu muốn mang theo sửa đổi test, nhưng production main/preload không đổi nên ASAR cũ vẫn khớp source production).
