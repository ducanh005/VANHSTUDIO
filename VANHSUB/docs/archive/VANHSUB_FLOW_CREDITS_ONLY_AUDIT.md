# VANHSUB — Google Flow Credits Only

Ngày: 21/10/2026. Phạm vi: tiếp tục Phase 6–7, điều chỉnh AI Studio theo yêu cầu sản phẩm mới nhất; không audit lại toàn ứng dụng.

Cập nhật 22/10/2026: xem `VANHSUB_FLOW_T2I_RECOVERY_ACCEPTANCE.md` cho bản sửa durable gate trước input, correlation, atomic artifact/recovery và candidate mới. Mục 11 dưới đây giữ nguyên kết quả lượt live cũ; chưa có generation mới trong đợt recovery.

Cập nhật 20:21 ngày 22/10/2026: lượt mới đã được người dùng duyệt riêng nhưng preflight dừng vì Google yêu cầu đăng nhập; 0 lời gọi service generation, 0 click Generate và không có receipt mới. Xem mục 11 của báo cáo recovery. Không dùng snapshot đăng nhập/quote ban chiều làm bằng chứng session hiện tại.

Cập nhật 10:34 ngày 23/10/2026: session hợp lệ, đã chạy đúng một lần production T2I service theo phê duyệt mới. Dừng trước Generate vì `FLOW_PROMPT_INTEGRITY_FAILED` (ProseMirror paragraph tạo hai newline trong innerText). Receipt đã lưu trước input và giữ `RECONCILIATION_REQUIRED`, 0 click Generate/không artifact mới/không retry. Xem mục 12 của báo cáo recovery; chưa đạt automatic Live T2I PASS.

**Cập nhật sau khi người dùng duyệt 1 T2I, budget 0 credit:** Flow đã tạo một ảnh thật; tải lại chính ảnh đó và FFprobe/FFmpeg PASS. Luồng tự động ban đầu FAIL vì nhập newline kích hoạt generation trước callback và chọn nhầm nút bộ sưu tập, sau đó báo timeout. Đã sửa source và regression; không gửi generation thứ hai. Mục 11 là kết quả live và candidate mới nhất; các hash/bằng chứng ở mục 7 ghi nhận candidate trước lượt live để giữ lịch sử, không dùng candidate cũ cho generation.

## 1. Kết luận nghiệm thu

Đã đưa mặc định của episode mới về **Gemini Web → Piper tiếng Việt local → Google Flow qua Chrome → timing/subtitle/FFmpeg local**. Flow không đòi Gemini API key. Official Media API vẫn được giữ nguyên thành route riêng, không được bật mặc định hoặc dùng làm fallback khi Flow lỗi.

**Chưa đạt nghiệm thu generation Flow tự động hoàn chỉnh.** CDP, profile test, project và quote trên UI thật đã xác minh. Sau phê duyệt, đã chạy một T2I; ảnh thật tồn tại và đã decode được, nhưng app không hoàn thành tự động và không gửi đủ phần negative prompt. Không retry hoặc gọi API AI tính phí. Quote trước thao tác bằng 0; credit thực tế chưa đối soát. Không suy ra Gemini Web đăng nhập từ Flow.

| Mức nghiệm thu | Kết quả | Giới hạn bằng chứng |
|---|---|---|
| TypeScript, renderer/main/preload build | PASS | Source cuối cùng; không phải Live Provider |
| Regression policy, receipt, ownership, checkpoint, media import | Automated / Native PASS | Fixture và engine native; không xác nhận Google đã generation |
| Electron đã đóng gói, cấu hình và restart | UI E2E / Real Runtime PASS | Profile thử riêng; không thay Beta R2 |
| CDP 9224 và profile Flow test | Real Runtime PASS, chỉ đọc | Không generation, không điều khiển tab thủ công |
| Flow login/session/project | `FLOW_READY`, project test riêng có prompt/generate control | Đã đọc Nano Banana 2.1 · image · x1 · quote 0 credit; balance/quota chưa xác minh |
| Extension / Bridge pairing | NOT TESTED trong lượt này | Bridge không kết nối; CDP và Bridge là hai trạng thái khác nhau |
| Gemini Web LLM | Cấu hình mặc định hợp lệ; Live NOT TESTED | Profile Electron thử chưa đăng nhập; không gọi API thay thế |
| T2I trên Google | Real image + download/decode PASS; automatic app acceptance FAIL | Đối soát riêng sau timeout; full prompt không nguyên vẹn. Bản sửa chưa Live retry |
| T2V/I2V trên Google | NOT TESTED | Không có phê duyệt generation video trong lượt này |
| Full AI Live E2E | NOT READY | Chưa có chuỗi LLM thật → Flow thật → render |
| Internal Beta manual/local | CONDITIONALLY READY | Giữ kết quả native/manual đã nghiệm thu; cần kịch bản/audio/media hợp lệ |
| Public Release | NOT READY | Không có clean Windows acceptance và chưa giải quyết các blocker live dưới đây |

## 2. Source, baseline và bảo toàn

- Worktree duy nhất được sửa: `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`.
- Branch: `codex/aistudio-phase6-beta-20261021`.
- HEAD giữ nguyên `c9a1c3e51cc4b653bca7c98440c874273e9a9d89`; phần source Phase 6 đã có trong ancestry. Lượt này **không commit, stage, push, merge, reset hay xóa worktree**.
- Sao lưu nguyên bản 20 file trước khi sửa. Kiểm tra hash bảo toàn 466 file của các worktree khác và 9 file UAT cũ: PASS.
- OfficialGeminiVisualProvider, VisualProviderRouter, shared officialMediaConfig, PiperLocalClient, KokoroClient, AiStudioTtsService và package-lock giữ nguyên hash so với snapshot Phase 6. Không cập nhật dependency/model hoặc cài dịch vụ.
- Beta R2 giữ nguyên ASAR SHA-256 `42bd2534c8ff8ced5f114251c0370d0c7591a6c734f69723a156298768decb0f`; EXE giữ nguyên `cb7930db9812eccef216c1ac302747c4bdfab5f5c82600769fcb877933f019dd`.
- Beta cũ giữ nguyên ASAR `fd7c63abc4b94068d80d892f2f27c2254bc045cb81b648f962304fa55d4a9e0a`.
- Video thủ công Phase 3 giữ nguyên hash `32e23b1c77ecaf29f261c033f05c734715b319a439a84572270fe7ab42192c08`. Không viết vào project gốc khi kiểm thử tương thích.
- Các báo cáo Phase 1–6 không bị sửa. Bằng chứng chi tiết, đường dẫn project/receipt và metadata runtime giữ ở thư mục `temp/flow-credits-only/` bị Git ignore, không đưa lên GitHub.

## 3. Kiến trúc Flow và nguyên nhân chưa generation được

Đường mới tái sử dụng `AiStudioPipelineEngine → AiStudioVisualService → BrowserAutomationAdapter → Chrome UI/CDP`, sau đó tải media, kiểm định native và chuyển artifact về pipeline hiện có. Không tạo pipeline TTS/render song song.

Đường RPC cũ từng trả `PUBLIC_ERROR_UNUSUAL_ACTIVITY`. Việc người dùng tạo ảnh trực tiếp thành công trước đây chỉ xác nhận thao tác trực tiếp của tài khoản; không chứng minh request của VANHSUB hợp lệ hoặc generation tự động hoàn tất. Không gửi lại request RPC đó trong lượt này.

Trước sửa, một số nhánh RPC có fallback sang UI sau unusual activity; thao tác click UI có nhánh DOM click thứ hai nếu click Playwright lỗi; một số launcher/session sửa User-Agent, client hints hoặc webdriver. Những hành vi này không phù hợp yêu cầu mới và làm khó phân biệt lỗi submission với kết quả generation.

Hiện production chặn route RPC legacy; xóa các fallback unusual-activity → UI; không giả danh trình duyệt. Đường UI mới chỉ chạy khi có phê duyệt, CDP đã kết nối, đúng project, model/mode/x1 đọc được và receipt đã được ghi bền vững. Nếu click đã xảy ra nhưng transport timeout, không click lần hai. Response HTTP/RPC không được tính là thành công: phải có `COMPLETED`, URL media phù hợp, tải và decode thành công mới lưu provenance.

Tài liệu công khai của Google mô tả UI Flow, credit và browser được khuyến nghị; **chưa có bằng chứng Google chứng nhận Playwright/CDP như một tích hợp tự động được hỗ trợ chính thức**. Báo cáo này không khẳng định điều đó. Chỉ dùng UI trong phiên test riêng, dừng khi có security restriction; không dùng Official API để thay credit Flow.

## 4. Thay đổi đã hoàn thành

### Cấu hình và UI

- Main và cả hai bộ default renderer cùng dùng Gemini Web, Piper `vi_VN-vais1000-medium`, Flow `playwright/live_window`, x1, không auto retry, consent mặc định tắt.
- Route hiển thị rõ **Google Flow — sử dụng credit tài khoản qua Chrome**. Không có trường API key trong route này. Official API ghi rõ billing riêng ngoài credit Flow; không tự chọn khi thiếu điều kiện.
- Model Flow, T2V/I2V, giới hạn output/job, credit được duyệt và xác nhận project được lưu riêng. Thay đổi phạm vi/model/budget/mode làm mất consent cũ.
- Nút **Kết nối / kiểm tra Flow CDP — không generation** sử dụng IPC không nhận payload; chỉ kiểm tra loopback 9224 và Chrome profile VANHSUB/test đã được xác minh. Không launch generation hoặc chọn project/tab người dùng.
- Kết quả hiển thị CDP, Bridge và session riêng. Badge media Flow chỉ có sau kiểm định, không hứa credit thực tế đã đối soát.
- Không tự migrate snapshot của episode cũ sang route/model mới. Muốn dùng default mới cần cấu hình và tạo episode mới.

### Submission, isolation và artifact

- Chỉ tái sử dụng tab automation sở hữu; không nhận tab Flow/blank tab thủ công làm tab automation.
- Callback trước click kiểm tra lại session và đúng remote project, model/mode/x1; không tự đổi model hoặc chuyển route để vượt lỗi.
- Phát hiện thêm lỗi trên UI Flow thật: mode/giá nằm trong overlay, model có biểu tượng, các nút x2–x4 chỉ là lựa chọn chưa chọn. Đã sửa bộ đọc: mở riêng menu settings, đọc model sau khi bỏ icon, chỉ đếm radio đang chọn, lấy quote từ câu chi phí, đóng menu nếu app đã mở. Không chọn model/mode hoặc submit trong phép kiểm tra này. Quote mâu thuẫn hoặc tên model không khớp vẫn bị chặn. Kiểm tra trực tiếp sau sửa đọc được Nano Banana 2.1 / image / x1 / 0 credit.
- Đã bỏ click fallback thứ hai sau lỗi transport; fixture trình duyệt thật tái hiện click xảy ra rồi lỗi, bộ đếm vẫn bằng 1.
- Flow T2V không tự mua thêm keyframe. I2V cần asset ID và file hash của keyframe Flow đúng scene/project/session. Keyframe thiếu hoặc bị sửa bị chặn.
- Tải bằng request context của chính trình duyệt đã kết nối, không xuất/copy cookie hoặc tự ghép Cookie header. Chỉ nhận HTTPS từ danh sách Google CDN cho phép, không follow redirect, giới hạn dữ liệu nhận 128 MiB, ghi file mới độc quyền rồi kiểm định/decode native và hash.
- Đường download này chưa được nghiệm thu trên CDN Flow thật; timeout 90 giây, chưa ngắt network request ngay khi cancel (kiểm tra signal trước/sau request). Không gọi đây là cancellation live PASS.
- Production không expose `window.debug`; IPC production từ chối `debug:*`, `bridge:eval` và `bridge:trigger-ui-gen`, tránh đường tắt bỏ qua duyệt credit.

### Credit protection và recovery

- Policy chung không nhận API key làm điều kiện Flow; yêu cầu consent đúng project, model cụ thể, x1, giới hạn 1–20 output/job và budget hữu hạn không âm.
- Ghi receipt `SUBMITTING` bằng exclusive create + fsync **trước click**. Receipt chứa correlation key của project/scene/task/prompt/model/refhash/nonce; không chứa prompt, key hoặc cookie.
- Receipt chưa rõ kết quả tiếp tục giữ chỗ cho output/credit; không tự submit lại kể cả khi đổi nonce. Resume một receipt hoàn tất chỉ dùng file còn đúng thư mục/hash/decode; file thiếu/hỏng buộc đối soát.
- Giá đọc được được cộng dồn vào mức đã đặt; không đủ credit hoặc vượt output thì dừng. Giá chưa đọc được chỉ được phép khi có xác nhận riêng, budget dương và limit đúng 1; lượt đó giữ toàn bộ budget, không mua thêm generation.
- Trường hợp không rõ click/provider kết quả vẫn bị tính giữ chỗ. Chưa có UI đối soát receipt tự động; cần kiểm tra thủ công trước khi quyết định một job mới.
- **Không có hard cap credit phía Google.** Budget ứng dụng là kiểm soát trước submit dựa trên dữ liệu UI, không phải giới hạn chi tiêu được nhà cung cấp bảo đảm. Credit thực tế luôn `null` khi chưa đối soát; số dư có thể bị tác vụ khác cùng tài khoản sử dụng.
- Regenerate từng scene Flow hiện bị chặn với `FLOW_REGENERATION_REQUIRES_NEW_APPROVAL`; phải có job/episode mới được duyệt. Không âm thầm mở lại ngân sách hoặc sửa snapshot cũ. Nút cũ chưa có quy trình re-approval riêng — đây là hạn chế UX còn lại. Official regeneration giữ luồng riêng.
- Giới hạn hiện tại tối đa 20 output/job; storyboard có nhiều hơn 20 scene cần generation sẽ bị chặn, chưa phải nghiệm thu tự động cả video dài. Không chia job ngầm để vượt phạm vi duyệt.

## 5. Kết nối/session thực tế

Đã chạy launcher test có sẵn, chỉ mở Chrome profile VANHSUB riêng, không đổi profile cá nhân. CDP lắng nghe `127.0.0.1:9224`; kiểm tra PID/command line nội bộ khớp profile test được cho phép; không ghi command line chứa dữ liệu phiên vào báo cáo. Sau kiểm tra dashboard, đã thực hiện thêm navigation và settings trên tab automation riêng.

- Kết nối Playwright CDP thành công; một tab Flow có trước và sau kiểm tra, tab không thuộc automation, không bị điều hướng hoặc đóng.
- Dashboard có dấu hiệu tài khoản và danh sách project; `FLOW_READY`, `projectLoaded=false`, có prompt container nhưng không có generate button của project.
- Không mở project đầu tiên của người dùng. Tạo một project test trống qua nút **Dự án mới** trên tab riêng; lưu URL/ID ở evidence local bị ignore. Tab gốc không đổi URL và không bị đóng.
- Mở lại chính project test bằng canonical URL mà adapter generation sử dụng: PASS, đúng project ID, `FLOW_READY`, prompt/generate control hiện diện. Tab kiểm tra do automation tạo đã được đóng sau kiểm tra; project trống được giữ nguyên, không xóa.
- Đọc settings thật: **Nano Banana 2.1, mode image, x1, “Quá trình tạo sẽ tốn 0 tín dụng”**. Trước sửa bộ đọc trả model/mode/quote `null`; sau sửa kiểm tra cả menu tự mở/đóng và menu mở sẵn đều trả đúng giá trị. Chưa đọc số dư; quote này không phải lịch sử trừ credit hoặc bảo đảm giá không thay đổi.
- Bản Electron đóng gói gọi IPC mới và nhận **Profile test đã xác minh**: PASS.
- Bridge/Extension không kết nối trong phiên này. Không thay extension, không tuyên bố pairing protocol hay generation qua Bridge PASS. Code bảo mật Extension 1.0.9 được giữ nguyên.
- Gemini Web là phiên riêng; không gọi Gemini generation và không đánh dấu đăng nhập chỉ vì Flow có account marker.

**Trạng thái sau phê duyệt:** một T2I đã tạo ra ảnh thật. Source được sửa sau lỗi live; chưa chạy generation lại. T2V/I2V, correlation trong nhiều job đồng thời và full Flow → render vẫn chưa có Live acceptance; selector có thể tiếp tục thay đổi. RPC cũ vẫn bị khóa. Xem mục 11 cho giới hạn bằng chứng cụ thể.

## 6. T2I/T2V/I2V và Stage 6 → Stage 7

| Hạng mục | Bằng chứng hiện có | Chưa chứng minh |
|---|---|---|
| T2I | Ảnh thật từ Google, asset ID trên DOM, tải CDN và FFprobe/FFmpeg: PASS đối soát | Tự động app FAIL; full prompt và thứ tự guard sai ở bản trước. Source đã sửa, không Live retry |
| T2V | T2V không ngầm tạo keyframe, budget/output/terminal error guard | Video Google thật và credit: NOT TESTED |
| I2V | Chặn missing/tampered keyframe, cùng scene/project/session, reference hash | Upload media thủ công → Flow asset ID chưa triển khai; exact reference binding trên UI Google chưa Live PASS |
| Media import | Regression native image/video, corrupt/type/ownership: PASS | Không gắn nhãn generation tự động cho import |
| Stage 6 → 7 | Vẫn dùng engine/checkpoint/artifact path/render hiện có; receipt recovery có kiểm định | Chưa có artifact Flow UI thật đi tới render trong lượt này |
| Manual/local | Bản sao project cũ mở bằng Electron mới, completed/manual, 49 scene hashes, audio/video nguyên vẹn | Không chạy lại synthesis/render dài đã có PASS vì code Piper/FFmpeg không đổi; không nghiệm thu SEO live |

Provenance Flow mới được thiết kế ghi source `google_flow_ui`, remote project, scene, session, request key, asset ID nếu response cung cấp, hash file/refhash và quoted credits. Lượt live mới có asset ID trên DOM nhưng **không hoàn tất receipt/provenance tự động**, vì prompt thực tế không nguyên vẹn. Chưa có generation ID đầy đủ, không đặt ID giả. File đối soát nằm riêng và không được gắn thành completed episode giả. Media import tiếp tục có provenance manual riêng.

Phiên manual native trước đây đã có video 236,433 giây/49 scene. Lượt này chỉ xác minh tương thích/reopen, không sử dụng kết quả đó để tuyên bố Full AI Live PASS. Piper runtime/model có sẵn trên máy được kiểm tra qua UI + IPC: ready; không tải model hoặc tạo audio giả.

## 7. Build, test và candidate cô lập

| Kiểm tra | Kết quả | Bằng chứng local |
|---|---|---|
| TypeScript | PASS | `temp/flow-credits-only/typecheck-overlay.log`, sau sửa parser |
| Renderer production | PASS, 19,123 s | `build-release.log`, bản cuối sau sửa parser |
| Main/preload production | PASS, 15,010 s | `build-release.log` |
| Credit policy/ledger/session/tab/click/native media | PASS | `safety-overlay.log`, có case overlay thật/zero quote/mismatch/ambiguous price |
| Navigation/project/settings Flow UI thật | PASS, không generation | `prepare-project.json`, `canonical-project.json`, `inspect-prepared-fixed.log` |
| Flow project isolation | PASS 8/8 | `project-isolation.log`; fixture RPC, không Live |
| Active lease, cancel, duplicate exclusion, interrupted recovery | PASS | `operations.log` |
| Session snapshot/restart/project switch/regeneration permission | PASS | `snapshot.log` |
| Manual media import + SRT/audio | PASS | `import.log`, `manual.log` |
| IPC payload regression | PASS | `ipc.log` |
| Electron package UI/config save/restart/read-only CDP | PASS | `electron-result.json`, `electron-release.log`, bản cuối Electron 43.5.0 |
| Project compatibility | PASS, 49 media hash + audio/video gốc | `electron-result.json` |
| Source → build → package | PASS, 283 source files | `final-manifest.json` |
| Clean Windows installation | NOT TESTED/BLOCKED | Không có máy Windows sạch độc lập; đây là máy dev |

Test snapshot đã cập nhật contract: regeneration Flow chưa được duyệt phải bị từ chối, không gọi provider, config và Flow URL của session cũ không thay đổi. Không bỏ assertion bảo toàn script/voice/render/restart để lấy PASS. Harness headless dùng opt-in secret fixture riêng; bản Electron production không bật plaintext fallback.

Candidate độc lập, không ghi đè R2:

`D:/VANHSUB-FlowCredits-20261021/Preview-FlowUI/Run Beta.cmd`

Launcher dùng `Preview-FlowUI/Beta-Profile` mới; không tự copy cấu hình/project/credentials R2. Bridge tắt mặc định trong candidate để tránh tranh cổng, dùng nút kiểm tra CDP trong cấu hình media. Không có instance test còn tồn tại sau E2E; Chrome test được giữ nguyên. Thư mục Preview trước đó được bảo toàn như candidate trung gian, không phải bản mới nhất.

- Electron 43.5.0, directory build, chưa ký, **không phải bộ cài NSIS mới**.
- Đã loại khỏi candidate giao bản trung gian resolve dependency checkout với Electron 43.4.1; bản cuối chỉ dùng dependency runtime baseline 43.5.0, không install/update dependency. Các thư mục build trung gian được giữ, không xóa.
- Không bundle Piper model; dùng runtime đã có trên máy. Không bundle profile, receipt, `.env`, `.npmrc` hoặc ONNX.
- 207 file trước khi thêm manifest; không symlink/junction tới source/node_modules/Beta cũ.
- Source set SHA-256: `18079156f11ca8114b04b7f589757d53d2d283f5e6ace4ae4e18581f1133c656`.
- EXE SHA-256: `eedb284ebf2193d16d4527fdb404b9ee7b381f9e0bce8ff05857ab082a28a367`.
- ASAR SHA-256: `7d194bdd7c77c10818b86644a599a4c2805b14bce4315cd9e53f6e30dcb3b0ef`.
- Manifest đầy đủ cạnh EXE: `flow-credits-manifest.json`; evidence chi tiết chỉ lưu local, chưa commit/push.

## 8. Phương án đã duyệt và phạm vi thực hiện

Chưa cần API key, mua credit hoặc nâng gói. Chrome test đã được mở/kết nối, không yêu cầu người dùng mở lại shortcut.

Phương án nghiệm thu tiếp theo: **một T2I, Nano Banana 2.1, x1 output, project test trống đã tạo, budget 0 credit theo quote hiện tại**. Trước click phải đọc lại đúng project/model/image/x1 và quote vẫn bằng 0; nếu khác thì không submit. Không dùng T2V/I2V trong cùng lượt. Nếu Google yêu cầu xác minh hoặc trả unusual activity/timeout chưa đối soát thì dừng, không retry. Đây là bài nghiệm thu generation UI/adapter, chưa phải full pipeline Facts → SEO.

Người dùng đã duyệt đúng một T2I này. Phạm vi đã được dùng; không tự gửi lượt thứ hai sau khi sửa. Không bật tùy chọn chấp nhận giá chưa biết. Quote UI chưa phải hard cap provider, kể cả khi đang hiển thị 0. Không yêu cầu người dùng tự mở Chrome, tạo project hoặc nhập API key.

Sau khi được duyệt, các thao tác mở lại project test trên tab automation, chuẩn bị prompt và kiểm định media vẫn do công cụ thực hiện; chỉ yêu cầu người dùng đăng nhập/xác minh khi Google bắt buộc. Gemini Web login là bước độc lập nếu muốn chạy Facts/Script/SEO tự động; khi chưa đủ điều kiện vẫn dùng nhập kịch bản/SRT/audio/media thủ công đã có.

Không cần thao tác người dùng để lấy ảnh đã tạo — đã tải và giải mã xong. Nếu sau này nghiệm thu generation mới của bản sửa, cần phê duyệt riêng; không dùng lại consent một lượt này.

## 9. File thay đổi và phần giữ nguyên

Source mới: `shared/flowCreditPolicy.js`, `main/ai-studio/FlowCreditLedger.ts`, `main/ai-studio/flowConnection.ts`.

Source sửa: pipeline engine, visual service, main/renderer AI Studio types/defaults, browser adapter/types/process manager, Gemini/Veo/ChatGPT browser launcher/session, IPC/preload/payload validation, MediaRouteSettings, StoryboardSceneCard và renderer Electron declarations.

Tests: thêm `tests/test_flow_credit_safety.ts`, `tests/test_flow_credits_electron.cjs`; sửa contract regeneration của `tests/test_ai_studio_session_config.ts`. Báo cáo này là tài liệu mới duy nhất của lượt sửa.

Git cuối lượt: 17 file tracked đã sửa, 6 file mới (3 module, 2 test, 1 báo cáo), index không được stage; HEAD vẫn `c9a1c3e`. `git diff --check` không có lỗi whitespace, chỉ cảnh báo cấu hình chuyển LF/CRLF của Git. Source/package manifest xác nhận không có mismatch.

Không đổi module Official provider/router, Piper/Kokoro, TTS service, lockfile, Extension hoặc FFmpeg assembler. Các module browser dùng chung bị bỏ masking nên cần live login acceptance riêng khi nhà cung cấp yêu cầu; không hứa tương thích provider chỉ từ build. Chưa có Full AI Live, long-running soak hoặc clean installation mới.

## 10. Nguồn đối chiếu

- [Google Flow — AI credits](https://support.google.com/flow/answer/16526234?hl=en): credit dùng chung tài khoản, chi phí theo generation/output; không suy số output từ số HTTP request.
- [Google Flow — tạo video và model/settings](https://support.google.com/flow/answer/16352836?hl=en): cần kiểm tra model và cấu hình đang hoạt động.
- [Google Flow — khả năng và giới hạn](https://support.google.com/flow/answer/16353333?hl=en): tính năng phụ thuộc model và môi trường browser; không xem hỗ trợ browser là chứng nhận API/CDP automation.

Không áp bảng giá cố định từ tài liệu vào hard cap. Model/credit hiển thị của chính phiên Flow vẫn phải xác minh trước generation.

## 11. Kết quả một T2I thật sau phê duyệt — trạng thái mới nhất

### Phạm vi và bằng chứng

- Người dùng duyệt: một ảnh Nano Banana 2.1, x1, project test đã tạo, budget 0 credit. Trước khi nhập prompt đã đọc lại đúng project/account, model/image/x1, quote 0; không dùng API key hoặc route API tính phí.
- Gọi production source service `AiStudioVisualService.generateViaGoogleFlow` với Chrome/CDP thật và receipt/job test riêng. Đây là **Real Provider Runtime của service/adapter**, không phải chạy full pipeline bằng UI Electron và không tạo session/checkpoint LLM giả.
- Kết quả ban đầu: `FLOW_STOPPED: TIMEOUT_SUBMITTING` sau khoảng 16,786 giây. Screenshot cho thấy ảnh đang tạo ở 60%; không resubmit khi app trả timeout.
- Đối soát chỉ đọc: một ảnh hoàn tất trong project test ban đầu trống; các tab có trước giữ nguyên URL và không bị đóng. Không quan sát thấy security alert/unusual activity trong lượt này; không suy ra route RPC cũ đã hết bị chặn.
- Listener network chỉ gắn ở Page và bộ lọc endpoint không nhận được request generation. Vì vậy số đếm network bằng 0 **không có nghĩa không generation**, cũng không đủ để xác nhận số request provider. Bằng chứng một output là gallery của project test và ảnh tải thật; không dùng bộ đếm sai để báo PASS.

### Lỗi có bằng chứng và bản sửa

| Lỗi | Bằng chứng | Bản sửa / giới hạn xác minh |
|---|---|---|
| P0: prompt có newline kích hoạt gửi trước gate cuối | `keyboard.type` nhập prompt nối negative prompt bằng newline; ảnh đã chạy nhưng editor chỉ còn phần `Avoid: ...`; callback/receipt đến sau lúc generation khởi động | Đổi T2I sang `locator.fill`, I2V append bằng `keyboard.insertText`, kiểm tra lại đầy đủ text. Bỏ DOM fallback khi nhập lỗi, dừng trước click. Regression trên Chrome fixture có Enter-submit handler xác nhận không có Enter/submission sớm và denied budget không click. **Chưa Live thử lại** |
| Chọn nhầm nút tạo bộ sưu tập | Selector `aria-label*="tạo"` trúng nút sidebar trước nút Generate, xuất hiện một bộ sưu tập trống ngoài ý muốn trong project test | Chỉ khớp tên Generate chính xác / component generate. Regression đặt nút bộ sưu tập trước Generate: click đúng Generate một lần, collection count 0. Không xóa bộ sưu tập test đã phát sinh |
| Acknowledgment quá hẹp | UI có tile/progress 60% nhưng editor còn negative prompt, bộ chờ cũ không nhận spinner/empty prompt nên báo `TIMEOUT_SUBMITTING` | Theo dõi tile image/video mới và progress, giữ bước kiểm định media độc lập. Phân biệt lỗi pre-submit với click không rõ kết quả. Baseline không đọc được thì dừng thay vì coi là gallery trống |
| CDN thực bị allowlist từ chối | Ảnh trong DOM dùng HTTPS `flow-content.google`; lần tải đầu dừng `FLOW_DOWNLOAD_URL_UNTRUSTED` trước HTTP | Thêm domain CDN thực vào allowlist, vẫn chặn HTTP và domain giả hậu tố. Tải **chính ảnh cũ**, không generation, rồi native decode PASS |
| Hàm evaluate không tự chứa khi chạy source bằng tsx | New full-browser regression phát hiện helper name bị transform của test runner đưa ra ngoài page context | Dùng method của object trong evaluate; test trực tiếp bằng tsx PASS. Không bỏ các assertion completion/guard để lấy PASS |

Tài liệu [Playwright Keyboard](https://playwright.dev/docs/api/class-keyboard#keyboard-insert-text) phân biệt gõ phím với chèn text; [Locator.fill](https://playwright.dev/docs/api/class-locator#locator-fill) hỗ trợ contenteditable. Bản sửa không giả fingerprint hoặc né anti-bot. Cơ chế newline được kiểm chứng thêm bằng fixture Enter-submit và trạng thái editor/ảnh thật, không suy từ HTTP 200.

### Output thật và integrity

- File JPEG: `D:/VANHSUB-FlowCredits-20261021/acceptance/t2i-approved-20261021/media/reconciled-flow-image.jpg`.
- 1376 × 768, FFprobe codec `mjpeg`, FFmpeg full decode PASS.
- SHA-256: `d8909439b3e0589a52a4f694ce73c02de29a56e2abc40fca3159812e2651bf55`.
- Download nhận JPEG dưới tên `.png`; đã giữ bản tải gốc và sao chép cùng byte sang `.jpg`, hash không đổi, không re-encode/ghi đè file cũ.
- Asset ID thực được giữ trong evidence private. Chưa có generation ID đầy đủ. Prompt ảnh thiếu phần negative prompt dự kiến; **không chứng nhận full prompt integrity**.
- Giữ receipt ban đầu `SUBMITTING`, không đổi thành `COMPLETED` để che lỗi. File đối soát có metadata riêng, không gắn nhãn một episode tự động đã hoàn tất.
- Quote UI trước submit: 0 credit; **actual credits = chưa đối soát**, không tuyên bố hard cap. Một ảnh đã tạo, không retry, không T2V/I2V, không gọi Gemini/Veo/OpenAI/DeepSeek paid API.

### Kiểm thử bản sửa

- TypeScript: `temp/flow-credits-only/typecheck-t2i-final.log` PASS.
- Regression trực tiếp: `tsx tests/test_flow_credit_safety.ts` PASS (`safety-t2i-final.log`), bao gồm multiline/no early submit, denied budget/no click, đúng nút Generate, acknowledgment tile mới, native decode/CDN trust, receipt/no resubmit và các guard cũ.
- Production build: `build-t2i-final.log` PASS; renderer 16,037 s; main/preload 10,844 s. Đóng gói dùng đúng dependency baseline Electron 43.5.0.
- Không chạy lại provider để lấy PASS sau sửa. New Live T2I trên source mới: **NOT TESTED**. Full automatic app acceptance của lượt đã chạy: **FAIL**. Actual image download/decode của lượt đó: **Real Provider + Native PASS sau đối soát riêng**.
- LLM/voice/render không đổi trong lượt sửa này; giữ bằng chứng trước, không nhân số PASS bằng cách chạy lại toàn bộ suite.

### Candidate cuối sau sửa, đã kiểm tra đóng gói

- Khởi chạy: `D:/VANHSUB-FlowCredits-20261021/Preview-T2I-Fix/Run Beta.cmd`.
- Electron 43.5.0, unsigned directory candidate; không cài đè Beta R2, không tạo installer mới. Profile độc lập `Preview-T2I-Fix/Beta-Profile`, Bridge tắt, CDP test dùng cơ chế kiểm tra profile hiện có.
- Electron UI/config save/restart, Piper readiness, IPC CDP, mở bản sao manual project 49 scene và kiểm tra media hashes: PASS, `electron-t2i-final.log`. Phần UI E2E này không generation và không được dùng thay Live acceptance.
- 283 source files khớp build; main/preload/renderer trong ASAR khớp snapshot; không bundle profile/receipt/secret/model, không symlink/junction trong candidate. Manifest: `flow-credits-manifest.json` cạnh EXE và bản evidence `temp/flow-credits-only/final-t2i-manifest.json`.
- Source set SHA-256: `b0ffed3e2ffd7c662c3687ecd81276c6046b78d808fcfd50599e01241cd70603`.
- EXE SHA-256: `bfdc17dbdd48a05467c94044a4f8270bf0a21bf65154453b9043f72c7b0ff60d`.
- ASAR SHA-256: `9dca9776ea73f58ec3817469d6c4011d1641db8ee7692f893a0d5136721ebda2`.
- Kiểm tra bảo toàn cuối: backup 20 file, 466 file tại worktree khác, 9 file UAT, Beta R2, Beta cũ và video Phase 3: PASS. Các module Official/Piper/Kokoro/TTS/lockfile giữ nguyên. Không xóa project, bộ sưu tập test, artifact, branch hay worktree.
- Giữ nguyên branch `codex/aistudio-phase6-beta-20261021`, HEAD `c9a1c3e`; không stage/commit/push/merge. Tổng trạng thái vẫn 17 tracked file sửa + 6 file mới tính cả công việc trước lượt T2I. Lượt sửa sau phê duyệt chỉ chạm BrowserAutomationAdapter, AiStudioVisualService, test_flow_credit_safety và báo cáo này.

**Quyết định:** manual/local Internal Beta vẫn CONDITIONALLY READY; Flow automatic E2E chưa nghiệm thu. Bản sửa chưa có một generation mới được duyệt/thực thi, nên không báo Live PASS cho thứ tự credit gate, prompt integrity, acknowledgment và tự động hoàn tất receipt sau sửa. Public Release NOT READY. Không yêu cầu thao tác thủ công để tải ảnh đã tạo; việc đó đã hoàn tất.
