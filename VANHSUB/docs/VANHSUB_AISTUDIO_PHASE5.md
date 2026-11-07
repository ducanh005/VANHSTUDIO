# AI Studio Phase 5 — Official Media API, migration và Beta candidate

Ngày: 21/10/2026, Asia/Saigon. Tiếp nối source/candidate Phase 4; không thay Beta, dữ liệu hoặc kết luận Live lịch sử.

## 1. Kết quả

**Đã có caller thật cho Official API ở stage 6**, nối storyboard/scene → router → provider → validation → provenance/hash → checkpoint. Đã chạy engine stage 6 → stage 7 với transport fixture và FFmpeg thật. T2I, T2V, I2V có contract test riêng; không gọi Google generation có phí.

| Quyết định độc lập | Trạng thái |
|---|---|
| Internal Beta để review trên máy này | **GO có điều kiện**: build/runtime/manual/native và official integration offline đạt; cần UAT chất lượng và provider Live trước sử dụng hàng loạt |
| Automatic Full AI Live E2E | **NO-GO / BLOCKED**: chưa có quyền/key/quota/budget Live được xác minh; chưa chạy đủ 8 stage bằng provider thật |
| Public Release | **NO-GO**: chưa có installer/clean-install/soak và acceptance provider Live |

Build candidate cuối: `D:/VANHSUB-Phase5-20261021/vanhsub-build-check-vnN9A3`.

Build ID: **aistudio-phase5-20261021-78e50cf4cdc3**.

## 2. Bảo toàn Phase 1–4 và Git

- Worktree: `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`; branch `codex/worktree-merge-audit-20261020`.
- HEAD trước/sau: `58f4e7bc840a5774c6d09e87913f6ab869c985da`. Không stage, commit, push, merge, reset, rebase, cherry-pick hoặc xóa worktree/stash/file của người dùng.
- Trước sửa: **53 file dirty**, 0 mismatch với manifest production Phase 4. Đã copy nguyên nội dung và hash từng file vào `temp/aistudio-phase5/dirty-backup/`, danh mục `source-before.json`; snapshot bị Git ignore.
- Đối chiếu cuối: 53 bản backup vẫn khớp; báo cáo Phase 1–4 không đổi. 466 file trong baseline 8 worktree khác và 9 file UAT cũ giữ nguyên hash. Không can thiệp công việc Douyin/subtitle tại D.
- Piper, Kokoro, TTS service, FFmpeg assembler, LLM service/guards, checkpoint ownership và package/lockfile giữ nguyên byte so với Phase 4. Các hook engine/IPC/UI mới được thêm lên nền này.
- Beta `app.asar` giữ SHA-256 `fd7c63abc4b94068d80d892f2f27c2254bc045cb81b648f962304fa55d4a9e0a`. MP4 Phase 3 giữ `32e23b1c77ecaf29f261c033f05c734715b319a439a84572270fe7ab42192c08`.
- Kiểm tra remote bằng `git ls-remote`: main vẫn `a99b7d780e2218f9c2362d30038c17006a0b97de`, là tổ tiên nhánh review; review ahead/behind **26/0**. Không fetch/prune hay sửa ref.

## 3. Migration model/API

Theo [hướng dẫn Google Omni](https://ai.google.dev/gemini-api/docs/omni), video dùng Interactions API; output REST nằm trong `steps`. Không lấy tiện ích SDK `output_video` làm schema REST. Lịch Veo preview được đối chiếu với [video guide](https://ai.google.dev/gemini-api/docs/video) và [deprecations](https://ai.google.dev/gemini-api/docs/deprecations/).

| Nhánh trong adapter | Contract đang triển khai |
|---|---|
| Ảnh | `gemini-3.1-flash-image`, POST `/v1beta/models/{model}:generateContent`; đọc inlineData của đúng image candidate |
| Video | `gemini-omni-1.1-flash`, POST `/v1beta/interactions`; schema riêng, không dùng `instances/parameters/predictLongRunning` của Veo |
| Authentication | API key trong `x-goog-api-key`, host Google cố định; không query key, không endpoint tùy ý hoặc theo redirect |
| Output video | Đọc `model_output.content` trong `steps`; hỗ trợ base64 MP4 hoặc Files URI → trạng thái ACTIVE → download binary |
| Pending interaction | Lưu ID opaque, GET đúng interaction đã gửi; không POST mới khi resume |

`veo-3.1-fast-generate-preview` không còn là model video của official adapter. Giữ nguyên Legacy Flow ở route riêng; không đổi tên model rồi gửi payload Veo cũ vào Omni. Không tự migrate receipt/job cũ thành request có phí mới.

### Capability ứng dụng, có chủ đích giới hạn

- **T2I:** một model ảnh trong danh sách cho phép, từ prompt scene, 16:9 hoặc 9:16.
- **T2V:** model Omni đã chọn, text input; không gửi ảnh tham chiếu ngầm.
- **I2V:** ảnh PNG/JPEG được chọn riêng cho scene, kiểm tra ownership/hash/decode trước khi gửi chính xác bytes. Không tự tạo keyframe khác để thay ảnh thiếu.
- Video yêu cầu 720p; scene video dài trên 0 đến 10 giây là giới hạn conservative của bản tích hợp này. Kiểm tra output duration, kích thước/aspect và FPS thực tế; không gửi tham số duration/FPS chưa được triển khai.
- Không triển khai first/last-frame interpolation, video edit/extend, điều khiển FPS/duration chính xác hoặc model tùy ý. Không tuyên bố I2V bảo đảm khung đầu giống pixel tham chiếu.
- Motion note từ storyboard được giữ trong scene và ghép vào prompt video. Negative text được ghép vào prompt, không gửi trường negative-prompt riêng không tương thích.

Những giới hạn trên là của VANHSUB Phase 5, không phải tuyên bố mọi capability/giới hạn của model. Model/endpoint/schema được chuẩn bị theo tài liệu; chưa chứng minh quyền truy cập hoặc response Live trong tài khoản người dùng.

## 4. Caller stage 6 và ba chế độ media

### Official API

`AiStudioPipelineEngine` có nhánh `engine=official_api` trước nhánh Flow. Nhánh này gọi `runOfficialMediaStage` → `VisualProviderRouter.generateOfficial` → `OfficialGeminiVisualProvider`; lỗi quay về stage FAILED/CANCELLED, không rơi sang Flow, browser hay synthetic fallback.

1. Dùng config snapshot của episode và scene canonical, không nhận đường dẫn/keyframe/model tùy ý qua payload readiness.
2. Preflight toàn bộ batch trước request đầu: model/task, prompt/timing, consent đúng project, key, limit, keyframe, ownership và output writable.
3. Tạo request key từ project/session/scene/model/task/prompt/aspect/keyframe hash và nonce của **scene**. Tạo lại một cảnh không đổi identity của các cảnh khác.
4. Router gộp in-flight request trùng key. Session lease chặn hai approve/resume/regenerate gần nhau trước khi chúng cùng gửi request.
5. Sau generation: kiểm tra MIME/magic, full decode FFmpeg, metadata FFprobe/dimensions/aspect/FPS/duration. Không đưa media sai vào scene/render.
6. Gắn artifact cùng provider/model/task/request key/request ID, hash, keyframe hash, owner và media timing; cập nhật index/checkpoint sau validation. Không ghi đè media/MP4 hoàn thành trước đó.
7. Nếu clip ngắn hơn timeline, báo mismatch, giữ receipt/output; chỉ dùng freeze khi người dùng chọn fill mode rõ ràng, không generation lại ngầm.

Stage 6 có progress riêng và badge “Official API · đã kiểm định”. Badge xác nhận artifact đã validation, **không phải nhãn nghiệm thu Google Live**. Scene regeneration đơn lẻ cũng dùng đúng route/lease; tác vụ “both” không được tự biến thành chuỗi request có phí, cần chọn ảnh hoặc video rõ ràng.

### Manual Import

Manual episode không phụ thuộc LLM/media key/consent. Readiness báo route manual, không báo Flow. Đường SRT+audio → import → render giữ nguyên. Với auto episode chọn I2V, nhập keyframe vào scene video giữ intent video/pending; nhập ảnh không làm cảnh đó âm thầm thành T2I.

### Legacy Flow

Giữ route cũ, hiển thị chưa nghiệm thu lại. Không gọi Flow RPC, không masking/CAPTCHA bypass hoặc chọn tab người dùng trong Phase 5. Không tự chuyển Official ↔ Flow khi lỗi. Không dùng E2E Flow cũ làm bằng chứng Live hiện tại.

## 5. Readiness, consent và chống tính phí trùng

UI Settings và Cấu hình kênh có selector route, model ảnh/video, T2V/I2V, password key, request limit và consent. Consent gắn với project; đổi project không kế thừa quyền gọi. Cấu hình mới áp dụng episode mới, episode cũ giữ snapshot. Key media dùng cơ chế DPAPI hiện có, không lưu vào project flowConfig dạng plaintext.

Nút “Kiểm tra media tập này” kiểm tra snapshot/scene thật qua trusted IPC; payload chỉ có sessionId tùy chọn, không cho chèn endpoint/key/path.

| Trạng thái | Ý nghĩa |
|---|---|
| CONFIGURATION_READY | Đủ điều kiện cấu hình/preflight; chưa chứng minh authentication/quota |
| BLOCKED | Thiếu key, consent, budget, keyframe, manual/legacy route hoặc submission chưa đối soát |
| UNSUPPORTED | Model, task, aspect hoặc tham số chưa hỗ trợ |
| FAILED | Preflight/artifact/IO hỏng hoặc generation/validation thất bại |
| LIVE_VERIFIED | Dành cho nghiệm thu provider thật; **không cấp trạng thái này chỉ từ key/config hoặc fixture**. Lượt này chưa có Live verification |

Giới hạn hiện tại: 1–20 request/episode, mặc định chưa cho gọi. Preflight yêu cầu đủ limit cho cả batch trước request đầu. Receipt đã giữ chỗ, kể cả lỗi/không xác định, vẫn tính vào limit. Đây là **hạn mức số request, không phải chặn số USD**; lượt Live cần ngân sách/quota riêng được cho phép.

### Receipt và recovery

- Receipt riêng dưới workspace episode, exclusive create và `fsync` **trước** POST có thể tính phí. Không lưu key/prompt/raw error vào receipt.
- Có response: lưu output response riêng để resume có thể validate/tải/lưu lại mà không POST. Có interaction ID: lưu trước polling; resume chỉ GET request đã có. Files URI được kiểm tra host/path/query, không theo redirect chứa credential.
- Không có ID/response sau timeout/network/error: BLOCKED/RECONCILIATION_REQUIRED. Không sửa prompt/nonce rồi gửi lại cùng scene để vượt receipt chưa đối soát.
- HTTP 401/403/429/500 không tự retry generation. SDK response malformed hoặc job status không hợp lệ không thành COMPLETED.
- Artifact đã có chỉ được dùng lại khi bytes/hash/validation khớp; không ghi đè file đã thay đổi. File bị mất có response lưu được phục hồi mà không POST mới.
- Receipt/job cũ thiếu fingerprint mới cần review, không âm thầm chuyển thành Omni generation.
- Cancel abort fetch/poll; lease giữ đến khi tác vụ kết thúc. Native decode/probe đang chạy có thể cần chờ bounded validator; preflight kiểm tra abort trước cảnh tiếp theo, không mở thêm chuỗi worker sau hủy.

Chưa có UI reconciliation đầy đủ cho trường hợp không biết ID: cần xem receipt/provider account và quyết định thủ công. Bản này ưu tiên không gửi trùng có phí; không xóa receipt để làm nút Retry hoạt động. Hạn mức/snapshot cũ không tự tăng khi sửa setting toàn cục.

## 6. Kết quả test

| Bài kiểm tra | Kết quả / phân loại |
|---|---|
| Request/response image và Interactions REST | Automated contract PASS; transport fixture |
| T2I, T2V, I2V exact reference bytes/hash, URI/Files download | Contract + native media decode PASS; không Google Live |
| 401/403/429/500, malformed JSON/schema/base64/MIME/corrupt MP4 | PASS, không tự generation lại, không ghi output hỏng |
| Timeout, cancel, pending interaction resume | PASS: một POST, GET/poll/download khi có ID/response; bất định thì chặn |
| Aspect/model/FPS/duration/task/keyframe không hỗ trợ | PASS: từ chối trước POST |
| Per-episode budget và consent project | PASS: batch vượt limit/sai project không gửi request |
| Stage 6 caller + scene provenance/ownership | Engine integration PASS với fixture; scene hash/model/request/keyframe identity đúng |
| Hai approve gần nhau, restart/resume, file mất | PASS: lease chặn duplicate, phục hồi từ response mà không thêm POST |
| Explicit regenerate một scene | PASS: file mới, nonce riêng của scene, giữ hash MP4 trước; không đổi nonce scene khác |
| Scene có submission chưa đối soát | PASS: chặn regenerate mới, không vượt receipt bằng nonce |
| Keyframe import cho I2V | Native import PASS, giữ video intent và source manual_import cho ảnh đầu vào |
| **Stage 6 → Stage 7** | **PASS engine + FFmpeg thật**, 2 cảnh, MP4 3,000 giây, full decode; media API response là fixture |
| Piper Vietnamese | Native synthesis PASS, voice vi_VN thật **4.896 ms**; không download/service mới. Test render dùng đoạn audio 3 giây để nghiệm thu kỹ thuật |
| Manual SRT/audio/import và media validation | Native regression PASS: nguồn bất biến, scene/duration/type/ownership, reject media hỏng |
| Snapshot/provider routing, session lease và IPC payload | Automated regression PASS |
| UI Settings/Channel/Kokoro/canonical script liên quan | Mounted React regression PASS |
| Production Electron | PASS: profile mới, form official/model/consent/budget/save/restart, DPAPI at rest, manual snapshot isolation |
| Project Phase 3 | COPY vào profile riêng, 49 media/MP4/audio/SEO hash sau restart PASS; original không bị mở để migrate |
| Full Automatic 8-stage provider Live | BLOCKED / chưa chạy; không nâng từ các PASS trên |
| Installer/clean Windows/long soak | NOT TESTED trong Phase 5 |

Output kỹ thuật riêng: `D:/VANHSUB-Phase5-20261021/acceptance/Stage6-to-Stage7-offline-fixture.mp4`. Đây là clip kiểm thử với màu/ảnh native, transport fixture và excerpt lời đọc; không phải video AI sinh Live về cuộc đua AI. Video tiếng Việt dài Phase 3 vẫn là output manual/native riêng đã giữ nguyên.

Evidence ở `temp/aistudio-phase5/`: `contract-final.log`, `contract-result.json`, `stage-final.log`, `stage-result.json`, `manual-regression.log`, `import-regression.log`, `operations-regression.log`, `snapshot-regression.log`, `ipc-regression.log`, `ui-regression.log`, `electron.log`, `electron-result.json`, `typecheck-final.log`. Profile/receipt/response/media test chỉ lưu local, không đưa lên Git.

## 7. Build candidate và giới hạn kiểm thử

- TypeScript PASS. Production renderer và main/preload PASS.
- Source allowlist: **280 file**, SHA-256 bộ source **78e50cf4cdc39b70aa19d24c83eec0fff717e56ffbc2871a88e0f46085634a2e**, **0 mismatch** giữa source cuối và candidate.
- So với Phase 4: 16 file production được thêm/sửa, danh sách/hash đầy đủ trong `temp/aistudio-phase5/final-manifest.json` và `phase5-manifest.json` ở candidate.
- Candidate runtime Electron 43.5.0 dùng dependency bundle đã pin trên máy. Không nâng dependency hoặc tải model. Build-check vẫn dựa dependency junction; không coi là bản phân phối tự chứa.
- Test profile riêng, Bridge tắt, không mở Chrome/Flow/account; cờ insecure test secrets bằng 0 trong Electron. CLI fault/transport fixture dùng secret giả trong thư mục test riêng.
- Key test không xuất hiện trong các artifact build kiểm tra; receipt không chứa key. Không in raw response hoặc signed URL trong lỗi provider. Không truy xuất credential/tài khoản thực để làm test PASS.
- Main PID của lượt test đã thoát; không thấy FFmpeg/Python/Electron test còn chạy lúc kiểm tra cuối. Không suy ra đã chứng minh không memory leak/soak từ điều này.
- Giữ các build trung gian để đối chiếu; chỉ build ID/path ở đầu báo cáo là candidate cuối. Không thay Beta và không tạo/cài NSIS. Không phân phối lại runtime/model Piper.

Rủi ro còn lại: quyền/quota/region/schema thực tế chưa được chạy Live; download redirect ngoài host cho phép bị chặn có chủ đích; không có workflow UI đối soát submission không ID; native validation không hủy tức thì mọi probe; timing vẫn estimated, không forced alignment; Facts vẫn là blueprint/nguồn nhập, không fact-check độc lập. Các điều kiện clean Windows, license phân phối và soak của Phase 4 vẫn giữ nguyên.

## 8. Danh sách thay đổi và consolidation plan

Production khác Phase 4:

```text
main/ai-studio/providers/OfficialGeminiVisualProvider.ts
main/ai-studio/providers/VisualProviderRouter.ts
main/ai-studio/officialMediaStage.ts                       (mới)
main/ai-studio/AiStudioPipelineEngine.ts
main/ai-studio/types.ts
main/ai-studio/ipc.ts
main/preload.ts
main/security/ipcPayload.ts
shared/officialMediaConfig.js                            (mới)
renderer/types/aiStudio.ts
renderer/types/electron.d.ts
renderer/components/ai-studio/MediaRouteSettings.tsx        (mới)
renderer/components/ai-studio/AiStudioSettingsTab.tsx
renderer/components/ai-studio/ChannelConfigModal.tsx
renderer/components/ai-studio/AutoPilotView.tsx
renderer/components/ai-studio/autopilot/StoryboardSceneCard.tsx
```

Test mới: `tests/test_ai_studio_phase5_stage.ts`, `tests/test_ai_studio_phase5_electron.cjs`. Test `tests/test_official_visual_provider_contract.ts` chuyển từ Veo/fake magic bytes sang contract Omni và media FFmpeg thật; không bỏ assertion no-retry/ownership/output để đạt PASS. Báo cáo mới: `docs/VANHSUB_AISTUDIO_PHASE5.md`. Không sửa package/lockfile hoặc module subtitle/Douyin độc lập.

### Đề xuất commit/PR để duyệt, chưa thực hiện

1. **Nền Phase 1–4 nhất quán:** dùng snapshot/manifest Phase 4 và backup, giữ toàn bộ U01–U04, Kokoro/Piper/readiness/manual/render/security tương ứng. Nếu chia nhỏ thêm phải dựng lại trạng thái trung gian và test, không stage file final vào commit cũ rồi thiếu dependency.
2. **Official contract/capability:** provider/router + shared config + các type bổ sung tương thích + contract test. Cần chung schema request/response và receipt, không tách đổi tên model khỏi payload.
3. **Stage 6 integration/security:** helper/engine + IPC/preload/schema/renderer declaration + stage integration tests. Đây là nhóm phụ thuộc chéo cần review cùng nhau.
4. **UI cấu hình/nguồn media:** MediaRouteSettings, Settings/Channel/AutoPilot/SceneCard và production Electron test; phụ thuộc nhóm 2–3.
5. **Docs/manifest review:** báo cáo Phase 1–5 và thông tin build được lọc; không đưa temp/profile/receipt/base64/media riêng tư lên Git. Có thể squash nhóm 2–4 nếu không thể chứng minh mỗi trạng thái trung gian build được.

PR dự kiến mở từ nhánh review được cho phép sang **origin/main**, không dựa local main `df9d768` đang phân kỳ cũ. PR sẽ bao gồm cả 26 commit review đã có, trong đó có sửa TTS/media/Douyin ngoài AI Studio; phải nêu phạm vi đó thay vì gọi toàn bộ diff là Phase 5.

Các patch `5402ea6/df9d768` tương đương đã có; `39beaa6/070c919/ea1b716` đã được port giữ security mới; `96da0ca` đã có bản tích hợp mới hơn. `8af33a6` subtitle preview clock vẫn ở nhánh D, chưa tích hợp; review/test riêng nếu được duyệt, không replay toàn nhánh. Những file HAR/runtime/script chưa track ở D được giữ nguyên tại chỗ.

Rollback/review trước commit dựa 53 bản backup dirty + manifest/source Phase 4 và candidate Phase 5; sau khi có commit mới mới đề xuất revert theo nhóm phụ thuộc. **Không dùng reset hard/clean/force push để rollback.** Chưa tạo commit/PR/nhánh tích hợp mới trong Phase 5.

## 9. Điều kiện Live và thao tác người dùng thực sự cần

Phần kỹ thuật nối route đã hoàn thành trong phạm vi offline. Để thử Live cần:

1. Người dùng chọn project, cấu hình key có quyền model/quota qua UI, chỉ định ngân sách và cho phép thử **một request nhỏ**. Không gửi key vào chat/log/report.
2. Tạo episode mới để snapshot nhận route/model/consent/budget. Chuẩn bị một scene phù hợp; I2V cần keyframe được nhập hợp lệ. Limit 1 chỉ đủ batch 1 scene hoặc regeneration có chủ đích 1 scene; preflight không tự gửi một phần batch lớn vượt limit.
3. Chỉ khi được phép mới chạy request đó, kiểm tra media/provenance thật rồi dừng để đánh giá. Không chạy ngay video 3–5 phút, không retry khi quota/security hoặc submission bất định. Nếu muốn mở rộng cần quyền/budget tiếp theo.
4. Nghe/xem duyệt chất lượng và timing. Provider Live của LLM cũng cần cấu hình/quyền riêng trước nghiệm thu toàn chuỗi; có media API không chứng minh Facts/Script/SEO Live.

Chưa yêu cầu đăng nhập Chrome, CAPTCHA, cài service/model hay thao tác Git. Không phát sinh chi phí API trong Phase 5. **Internal Beta review có điều kiện GO; Automatic Live E2E và Public Release vẫn NO-GO cho đến khi các blocker tương ứng được nghiệm thu.**
