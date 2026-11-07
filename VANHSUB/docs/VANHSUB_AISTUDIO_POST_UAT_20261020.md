# AI Studio — Khắc phục sau UAT 20/10/2026

Ngày thực hiện: 20/10/2026. Phạm vi: U01–U04, đường đi cấu hình/resume B01 và kiểm tra Bridge/media B02; không audit lại toàn bộ ứng dụng.

## 1. Kết quả và giới hạn nghiệm thu

**Đã sửa U01–U04 và lỗi giữ credential của provider cũ khi đổi provider.** TypeScript, production renderer/main/preload, các regression liên quan và kiểm thử bản Electron cô lập đều PASS trong phạm vi dưới đây.

**AI Studio Live E2E vẫn BLOCKED, chưa hoàn thành một tập mới.** Không có lời đọc/media do provider thật tạo ra trong đợt này. Kokoro chỉ có API đọc danh sách giọng; AI Studio chưa có adapter tổng hợp Kokoro. Nhánh TTS này hiện báo lỗi rõ ràng thay vì âm thầm chạy Edge. Không coi việc báo lỗi đúng là TTS Live PASS.

| Mức nghiệm thu | Kết luận |
| --- | --- |
| Bản sửa UI/guard/configuration offline | PASS theo bằng chứng bên dưới |
| Electron runtime/IPC/restart trong profile test riêng | PASS cho các tình huống đã chạy |
| AI Studio Internal Beta end-to-end | BLOCKED ở điều kiện LLM/TTS/media; chưa đủ điều kiện xác nhận dùng trọn pipeline |
| Public Release | NOT READY; chưa có Live E2E, installer mới hoặc clean Windows acceptance |

## 2. Repository, Beta và bảo toàn dữ liệu

- Worktree thực thi: `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`.
- Nhánh: `codex/worktree-merge-audit-20261020`.
- HEAD trước/sau: `58f4e7bc840a5774c6d09e87913f6ab869c985da`.
- Worktree này sạch trước đợt sửa. Các bản sửa trong báo cáo **chưa commit**, không stage, push, merge hay rebase.
- Checkout `D:/DEAN/DEAN/VANHSUB` nằm trên nhánh cũ `codex/douyin-media-inspection`, HEAD `96da0ca`, có dữ liệu chưa được Git theo dõi. Không chuyển nhánh hoặc ghi đè checkout đó. Tiếp tục trên worktree review mới hơn có HEAD khớp mốc UAT.
- Kiểm tra bảo toàn các worktree cũ: 8 worktree, 466 file gốc đã có hash; không đổi nội dung hoặc HEAD, các ref được đối chiếu giữ nguyên và stash vẫn rỗng. Đây là kiểm tra bảo toàn, không thực hiện lại merge worktree.
- 9 file UAT gốc đã ghi hash, gồm facts/checkpoint/action log/bằng chứng/báo cáo: **không thay đổi** sau kiểm thử. Không sửa/migrate phiên FAILED gốc.
- Beta `app.asar` trước/sau vẫn có SHA-256 `fd7c63abc4b94068d80d892f2f27c2254bc045cb81b648f962304fa55d4a9e0a`.
- Launcher cũ ghi `884591d`; metadata này không đủ để chứng minh commit source chính xác của binary. Hash xác định binary được bảo toàn; bản sửa hiện tại chưa được cài vào Beta đó.
- Các lần chạy Electron dùng profile, settings, task store, Bible store và project test riêng; tắt Flow Bridge trong harness. Hai PID main do lần nghiệm thu cuối tạo ra đều đã thoát. Không đóng Beta của người dùng.

## 3. Root cause và bản sửa

### U01 — Header hiển thị sai trạng thái

`AutoPilotHeader.tsx` trước đây gom nhiều trạng thái về nhãn xử lý. Đã ánh xạ riêng `running`, `awaiting_approval`, `failed/error`, `cancelled`, `completed`, `paused`, `idle`; trạng thái chưa biết có nhãn riêng. Không suy diễn trạng thái từ provider.

Đã kiểm tra 8 trạng thái qua component React và kiểm tra FAILED sau restart trong production renderer Electron.

### U02 — AI 3/5 là dữ liệu hardcode

Đã bỏ điểm cố định. Header hiển thị `Chưa đánh giá` cùng tên provider khi không có phép đo. Không dùng nhãn này để xác nhận provider đã đăng nhập hoặc hoạt động.

### U03 — Script không hợp lệ vẫn được thao tác/chuyển TTS

Các điều kiện cũ dựa vào busy hoặc độ dài mảng, chưa chặn mảng rỗng ở mọi đường gọi; frontend còn giữ script của phiên trước khi phiên mới không có dòng nào.

- Thêm validator chung: có ít nhất một dòng và từng dòng có ký tự chữ/số đọc được; từ chối nội dung chỉ có khoảng trắng, dấu câu hoặc emoji.
- UI khóa duyệt/lồng tiếng, chấm điểm, cải thiện và yêu cầu sửa khi script không hợp lệ. Chỉ duyệt stage 2 khi stage đó thành công, session đang chờ duyệt và không bận.
- Đồng bộ script rỗng khi chuyển phiên; không giữ lời thoại của phiên trước.
- Backend kiểm tra ở approve stage 2, resume stage 3, kết quả sinh script, cập nhật script, evaluate/refine và đầu vào TTS.
- Với session đã tồn tại, evaluate/refine dùng script canonical của session; payload truyền thêm script không được dùng để thay thế script canonical đang thiếu.
- Validate trước khi sửa artifacts/checkpoint ở các đường approve/resume bị từ chối. Không tạo thư mục/file TTS khi đầu vào rỗng.
- Giữ nguyên lỗi công khai cũ của refine cho trường hợp mảng rỗng; thay đổi contract evaluate rỗng từ điểm 0 giả sang báo lỗi có chủ đích.

### U04 — Kokoro hiển thị loading dù không có request hoàn tất

Nhãn loading trước đây phụ thuộc lựa chọn engine, không có vòng đời request tương ứng.

- Thêm IPC `aiStudio:voices:kokoro` không nhận tham số, qua guard renderer/payload hiện hữu.
- Main đọc catalog từ `http://127.0.0.1:8880/v1/audio/voices`, timeout 5 giây, không redirect/proxy, giới hạn response 256 KiB. Không tải model, khởi chạy container hoặc gọi synthesis.
- Kiểm tra schema, ID, số lượng; hỗ trợ danh sách tên giọng và object có ID/name. Không biến lỗi server thành danh sách rỗng giả.
- UI có idle/loading/success/empty/error, nút tải lại thủ công và timeout dự phòng 8 giây; bỏ qua response đến muộn khi đóng modal hoặc đổi engine. Không tự retry.
- Giữ lựa chọn giọng cũ nếu không có trong catalog nhưng đánh dấu không khả dụng; không âm thầm đổi giọng.
- Sửa footer để lỗi dài không ép nút lưu thành nhiều dòng; đã xem screenshot bản Electron.

**Phát hiện kèm theo:** Stage 3 và TTS service chưa có bộ tổng hợp Kokoro/local ONNX, trước đây có thể rơi xuống Edge. Đã chặn rõ hai đường này. Catalog PASS không đồng nghĩa Kokoro synthesis PASS. Server local hiện không kết nối được trên endpoint catalog mặc định trong lần chạy Electron cuối.

## 4. B01 — Provider, snapshot và resume

### Lỗi đã tái hiện và sửa

1. `resolveProductionConfig` gắn tên provider trong channel lên cấu hình LLM đã merge nhưng giữ key/model/base URL cũ. Lớp adapter phía sau thấy provider đã trùng tên nên không còn phát hiện credential thuộc provider trước.
2. Cùng lỗi đó tồn tại sớm hơn ở `updateAiStudioConfig`: chuyển project chỉ gửi provider nhưng merge nguyên credential đã mã hóa từ cấu hình hiện tại.
3. Form Settings đổi provider bằng cách spread toàn bộ `form.llm`, khiến payload tiếp tục gửi key/model/endpoint của provider cũ. Optimistic renderer store cũng giữ các giá trị đó khi nhận patch chỉ có provider.

Đã thống nhất quy tắc chọn provider ở main bằng `selectLlmProvider`: giữ cấu hình nếu provider không đổi; khi đổi thì xóa key/model/endpoint trước khi áp dụng cấu hình mới được cung cấp rõ ràng. Store từ chối provider không hợp lệ trước khi lưu. Settings và optimistic store áp dụng cùng quy tắc xóa credential cũ. Form có thông báo để người dùng nhập lại cấu hình tương ứng.

Negative control xác nhận key fixture bị giữ lại trước sửa. Sau sửa đã xác minh resolver, backend store, form Settings và IPC thật; key mới được cung cấp rõ ràng vẫn được giữ, cập nhật cùng provider không xóa key. Không đọc credential thật để chạy các bài này.

Ứng dụng vẫn dùng một slot credential LLM hiện hành; đổi sang provider khác cần cấu hình key phù hợp lại. Không bổ sung kho key nhiều provider hoặc migration trong đợt sửa này.

### Thiết kế được giữ nguyên

`Project config → resolve provider/overrides → capture encrypted snapshot → checkpoint → restore snapshot → adapter`.

- Snapshot được tạo khi bắt đầu session và giữ các cấu hình sản xuất; không mang cả danh sách project vào checkpoint.
- Đổi cấu hình chung hoặc chuyển project không đổi provider/key của session đã có snapshot.
- Resume stage 2 sử dụng snapshot cũ; stage 1/facts đã thành công không bị chạy lại trong tình huống đã kiểm tra.
- Engine mới đọc lại checkpoint và giữ nguyên bytes facts. Lease chặn resume trùng khi tác vụ trước chưa kết thúc.
- Resume stage 3 bị từ chối nếu script chưa hợp lệ, không ghi checkpoint bị từ chối.
- Không sửa phiên FAILED gốc. Các trường hợp resume được thực hiện trên phiên test riêng.

Lỗi thiếu API key ở stage 2 được truyền qua IPC và hiển thị đúng là FAILED. **Thêm key vào Settings không tự chữa snapshot của phiên FAILED cũ.** Sau khi cấu hình hợp lệ, tạo project/session test mới; không chỉnh checkpoint cũ để ép chạy.

## 5. B02 — Browser Bridge/Flow/media

| Hạng mục | Bằng chứng đợt này | Phân loại |
| --- | --- | --- |
| Protocol 2, proof/origin/owner/revoke | Test WebSocket loopback thật với peer extension mô phỏng | Automated integration PASS; không phải Chrome Extension Live |
| Tab ownership, request correlation, idempotency | Fixture test, gồm unusual activity chỉ gửi một lần và trả trạng thái yêu cầu người dùng | Automated PASS; không phải CDP Live |
| Official visual adapter, I2V provenance/bytes, cancel, ambiguous submission | Contract test với transport/validator fixture | Automated PASS; không gọi API thật |
| Import media vào scene | FFmpeg tạo media fixture hợp lệ; kiểm tra decoding, owner, hash, file lỗi và giữ checkpoint khi từ chối | Offline native runtime PASS |
| Assembler/render timeline | FFmpeg/FFprobe thật với media fixture | Offline native runtime PASS; không phải video do provider tạo |
| Chrome/CDP/profile/tab thực tế | Không mở/kết nối lại browser trong đợt sửa này | NOT TESTED |
| Flow đăng nhập và generation T2I/T2V/I2V | Không thực hiện request hoặc kiểm tra đăng nhập mới | NOT TESTED đợt này; route Web RPC trước đó vẫn BLOCKED do unusual activity |
| Reconnect/disconnect với Extension thật | Không chạy lại nghiệm thu live | NOT TESTED |

Đã đọc các đường BrowserProcessManager, tab/correlation, visual router và media validation hiện hữu; không thay đổi các module đã PASS này để refactor.

**Rủi ro từ source hiện hữu:** `main/ai-studio/gemini/GeminiWebSessionManager.ts` có UA đổi sang Firefox ở luồng auth Google, bỏ client hints và sửa `navigator.webdriver`; `main/browser-automation/BrowserProcessManager.ts` có `--disable-blink-features=AutomationControlled`. Không bổ sung, gọi đăng nhập hoặc khởi chạy các route này trong bài nghiệm thu. Chưa loại bỏ/review toàn diện các cơ chế đó, vì vậy không chứng nhận chúng là con đường tích hợp được hỗ trợ. Không dùng chúng để vượt hạn chế của Google.

Không retry Flow RPC đã nhận `PUBLIC_ERROR_UNUSUAL_ACTIVITY`, không sao chép cookie, không tiêu credit generation.

## 6. Kiểm thử và bằng chứng

Bằng chứng chi tiết ở `temp/aistudio-post-uat/`, được giữ local và nằm ngoài file đưa vào Git. Các filename dưới đây không chứa credential thật; không đưa raw logs/runtime metadata lên remote.

### Automated tests

- `test_ai_studio_post_uat_ui.cjs`: mount các component thật trong Chrome headless; trạng thái/header, bỏ điểm giả, script hợp lệ/rỗng/stale/FAILED, Kokoro đủ trạng thái/retry/late response và Settings đổi provider xóa credential. **PASS**. IPC ở bài này là fixture. Log: `ui-provider-after.log`.
- `test_ai_studio_post_uat_runtime.ts`: script guards, checkpoint không đổi khi từ chối, resolver/store credential isolation, missing-key thật, restart/resume facts, lease và catalog HTTP loopback có schema/error/timeout. **PASS**. Phần hoàn thành script dùng transport fixture, không phải LLM Live.
- Regression liên quan **PASS**: `test_channel_provider_isolation.ts`, `test_ai_studio_channel_settings.ts`, `test_ai_studio_script_evaluation.ts`, `test_ai_studio_script_refinement.ts`, `test_ai_studio_script_invalidation.ts`, `test_ai_studio_session_config.ts`, `test_ai_studio_session_operations.ts`, `test_ai_studio_tts_alignment.ts`, `test_ai_studio_media_import.ts`, `test_ai_studio_render_timeline.ts`, `test_rc_ipc_payload.ts`, `test_rc_extension_pairing.ts`.
- B02 offline **PASS**: `test_rc_bridge_pairing.ts`, `test_official_visual_provider_contract.ts`, `test_browser_tab_isolation_and_correlation.ts`.
- Các bài có cấu hình/key/audio/video giả lập chỉ chứng minh contract/routing tương ứng. Đặc biệt snapshot routing test có fake audio/video, không phải synthesis/render Live. Native render test riêng mới chứng minh FFmpeg thực thi trên fixture.
- Sau bản sửa store/provider cuối, chỉ chạy lại 4 entrypoint bị ảnh hưởng và component/Electron test; không lặp toàn bộ test suite.

Tổng hợp kết quả cuối: `regression-final.json` (13 entrypoint liên quan) và `bridge-media-results.json` (3 entrypoint B02). Không dùng số lượng PASS để suy ra độ sẵn sàng Live.

Một lần chạy lại snapshot test thiếu cờ cho encryption fixture trong môi trường Node headless nên bị từ chối DPAPI đúng thiết kế; chạy lại với `VANHSUB_ALLOW_INSECURE_TEST_SECRETS=1` chỉ trong process test riêng đã PASS. Không bật fallback này cho production/Electron. Lần build đầu phát hiện loader Nextron không transpile TypeScript ngoài thư mục main; validator dùng JS/JSDoc chung và các build cuối đã PASS. Các log trước sửa/harness thất bại được giữ lại, không xóa bằng chứng.

### Production Electron runtime và UI E2E có giới hạn

`test_ai_studio_post_uat_electron.cjs` chạy **assets production vừa build**, Electron 43.5.0, settings/preload/IPC/store thật, profile test mới; không trỏ vào Beta hoặc UAT gốc. **8 kiểm tra PASS**:

1. IPC lưu provider mới xóa key DPAPI/model/endpoint cũ, dùng key test không có quyền gọi provider.
2. Lỗi thiếu key từ service qua IPC.
3. Canonical script rỗng chặn evaluate/refine/resume dù payload chèn thêm lời thoại hợp lệ.
4. Production renderer hiển thị FAILED và khóa các nút cần script.
5. Đóng/mở lại app giữ trạng thái FAILED, facts và nhãn UI.
6. Script do test nhập thủ công được duyệt stage 2; stage 3 Kokoro báo chưa hỗ trợ, không tạo audio hoặc chạy Edge ngầm.
7. Catalog IPC thật trả lỗi không kết nối được trong thời hạn.
8. Modal Kokoro thoát loading, báo lỗi và mở nút tải lại; screenshot footer đã kiểm tra.

Project/facts/script đầu vào do test cung cấp rõ ràng; đây không phải người dùng thao tác toàn pipeline và không phải provider sinh nội dung. Log/result: `electron-provider-final.log`, `electron-result.json`; screenshot: `ui-kokoro.png`.

### Build

- TypeScript `tsc --noEmit --incremental false --pretty false`: **PASS**, exit 0, gồm main/renderer theo tsconfig hiện tại.
- Next production renderer: **PASS**, 23.782 giây.
- Nextron main/preload webpack: **PASS**, 11.941 giây.
- Nguồn trong stage được đối chiếu hash với worktree: **271 file, 0 khác biệt**.
- Dùng dependency bundle đã có ở ổ D, không install/update dependency và không sửa junction `node_modules` dùng chung.
- Không tạo NSIS/exe/app.asar mới. Packaging, nâng cấp bản cài hiện hành, clean Windows: **NOT TESTED** trong đợt này.

## 7. File thay đổi

| Nhóm | File | Mục đích |
| --- | --- | --- |
| Header | `renderer/components/ai-studio/autopilot/AutoPilotHeader.tsx` | U01/U02 |
| Script UI | `renderer/components/ai-studio/ScriptWorkspaceView.tsx` | U03, reset stale script và gate đúng stage |
| Script validator | `shared/aiStudioScript.js` | Quy tắc chung cho renderer/main |
| Pipeline/artifacts | `main/ai-studio/AiStudioPipelineEngine.ts`, `main/ai-studio/sessionArtifacts.ts` | Guards trước mutation/TTS và từ chối Kokoro chưa triển khai |
| Services | `main/ai-studio/services/AiStudioLlmService.ts`, `main/ai-studio/services/AiStudioTtsService.ts` | Script guards, chọn provider và chặn fallback TTS sai |
| Provider | `main/ai-studio/llmProviderConfig.ts`, `main/ai-studio/sessionConfig.ts`, `main/store/aiStudioStore.ts` | Credential ownership khi chọn/lưu/snapshot provider |
| Settings | `renderer/components/ai-studio/AiStudioSettingsTab.tsx`, `renderer/lib/store/aiStudioStore.ts` | Xóa credential cũ trong draft/optimistic store |
| Kokoro UI/main | `renderer/components/ai-studio/ChannelConfigModal.tsx`, `main/ai-studio/kokoroVoices.ts` | Catalog thật và request lifecycle |
| IPC | `main/ai-studio/ipc.ts`, `main/preload.ts`, `main/security/ipcPayload.ts`, `renderer/types/aiStudio.ts`, `renderer/types/electron.d.ts` | Catalog bridge/types và canonical script guards |
| Tests | `tests/test_ai_studio_post_uat_ui.cjs`, `tests/test_ai_studio_post_uat_runtime.ts`, `tests/test_ai_studio_post_uat_electron.cjs` | Regression mới có negative control và Electron riêng |
| Contract tests cập nhật | `tests/test_ai_studio_script_evaluation.ts`, `tests/test_rc_ipc_payload.ts` | Empty evaluate phải lỗi; catalog không nhận endpoint từ renderer |

## 8. Định danh build để review

- Version ứng dụng: `1.0.0`; không gán nhầm dirty build cho một commit đã phát hành.
- Build ID: `post-uat-20261020-cf5eb9740280`.
- Base commit: `58f4e7bc840a5774c6d09e87913f6ab869c985da`; **dirty source**.
- Stage: `D:/DEAN/DEAN/VANHSUB/temp/vanhsub-build-check-EyQpag`.
- Manifest: `post-uat-manifest.json` và `build-check-result.json` trong stage; bản đối chiếu local: `temp/aistudio-post-uat/final-manifest.json`.
- SHA-256 tập source build: `cf5eb9740280e92991785bd6d121e51bd739c4e70c7f7677b4c5946a5df40f37` (JSON các cặp đường dẫn/hash sắp thứ tự; không bao gồm docs/tests).

| Artifact | SHA-256 |
| --- | --- |
| `app/main.js` | `d681c902ca007f441fbcc7aac780dfda5debfc1ddacc513052cd5b50da962d6b` |
| `app/preload.js` | `4fc02d2ac4ecabeeb7c56d4fc22be5f3dfebce864e5ae18a853f85979793e60f` |
| `app/home/index.html` | `246d0770483b7157dc7c91f4dff0c59d2733015d75b11fa15b85f0fa7fcc76a3` |

## 9. Điều kiện còn thiếu để chạy Live E2E

1. **LLM — BLOCKED:** UAT gốc dừng do thiếu key trong snapshot. Đợt sửa không đọc credential thật, tự đăng nhập hoặc gọi dịch vụ trả phí. Cần người dùng chọn provider có quyền sử dụng và cấu hình key qua UI ứng dụng nếu chưa có. Sau đó tạo project/session test mới để snapshot cấu hình hợp lệ. Không gửi key qua chat/log.
2. **TTS — BLOCKED:** Kokoro catalog mặc định không có server trả lời và AI Studio chưa có synthesis adapter Kokoro/local ONNX. Bật server catalog đơn thuần chưa đủ. Cần hoàn thiện adapter hợp lệ hoặc chọn engine đã tích hợp và đã được cấp quyền; Edge từng 403 chưa được thử lại trong đợt này, TikTok không được coi có session hợp lệ. Không tự giả handshake/token.
3. **Media — BLOCKED đối với Flow Web RPC cũ:** tiếp tục giữ trạng thái unusual activity; không yêu cầu retry. Có thể dùng API chính thức khi có key/quota/quyền hoặc nhập media do người dùng tạo vào scene. Chưa thực hiện generation/import UI thật trong một tập Live mới ở đợt này.
4. **Browser automation — chưa được chấp nhận Live:** CDP/profile/auth/tab/reconnect thực tế chưa kiểm tra lại; các logic masking/UA hiện hữu cần được xử lý qua hạng mục riêng, không dùng để ép Live PASS.
5. Sau khi đủ LLM/TTS/media hợp lệ, chạy từng checkpoint `Facts → Script → TTS → Timing → Storyboard → Media → Render → SEO` trên project mới; xác minh lời thoại thật, hash/owner/provenance, duration, decoding và output trước khi duyệt bước kế. Hiện TTS thật, timing với giọng thật, storyboard/media/render/SEO toàn tập mới: **NOT TESTED**.

Không cần thao tác người dùng để hoàn tất các bản sửa offline đã thực hiện. Chỉ phần key/quyền tài khoản hoặc chọn hướng triển khai provider còn thiếu mới cần can thiệp. Không thay Beta đang sử dụng trước khi review bản build cô lập và nghiệm thu các điều kiện trên.
