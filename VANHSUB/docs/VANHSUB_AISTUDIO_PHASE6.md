# AI Studio Phase 6 — Git consolidation, packaged Internal Beta và Live UAT

Ngày 21/10/2026, Asia/Saigon. Tiếp nối Phase 5; không kiểm toán lại toàn ứng dụng.

## 1. Kết quả và quyết định

Đã chuyển source dirty Phase 1–5 thành commit local nhất quán trên nhánh mới, hoàn thiện kiểm tra duration/FPS và quyền trim/chi phí, tạo candidate Electron độc lập và chạy UAT trên executable đóng gói. Không push/merge, không thay Beta cũ và không gọi Google generation có phí.

| Mức nghiệm thu | Quyết định | Phạm vi |
|---|---|---|
| Internal Beta trên máy Windows hiện tại | **GO CÓ ĐIỀU KIỆN** | Packaged app, manual workflow, Piper đã cài, project compatibility và official contract offline đạt. Cần người dùng nghe/xem duyệt chất lượng; không suy rộng sang provider Live |
| Official Media Live / Automatic Full AI E2E | **NO-GO / BLOCKED** | Chưa có key/quota và phạm vi chi phí được người dùng chỉ định cho lượt Live; chưa chạy toàn chuỗi với LLM/media thật |
| Public Release | **NO-GO** | Chưa clean Windows/installer/signing/soak và chưa nghiệm thu provider Live; runtime/model ngoài app chưa đủ điều kiện phân phối |

Candidate cuối: **`D:/VANHSUB-Phase6-20261021/InternalBeta-R2`**. Chạy **`Run Beta.cmd`** để dùng profile riêng `Beta-Profile`; launcher không mở thêm khi thấy executable candidate này đang chạy. Legacy Flow Bridge được tắt trong launcher, không cần Bridge để dùng Official API. Không mở EXE trực tiếp nếu muốn giữ cách ly profile theo launcher.

`InternalBeta` không có hậu tố R2 là lần đóng gói bị loại; đã ghi `DO-NOT-USE.txt`, giữ nguyên để đối chiếu, không sử dụng làm bản nghiệm thu.

## 2. Source, backup và Git

- Worktree duy nhất được sửa: `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`.
- Nhánh gốc: `codex/worktree-merge-audit-20261020`, HEAD `58f4e7bc840a5774c6d09e87913f6ab869c985da`.
- Nhánh tích hợp mới: **`codex/aistudio-phase6-beta-20261021`**, tạo trực tiếp từ HEAD trên, giữ toàn bộ dirty source.
- Đối chiếu trước sửa: 280 source file khớp manifest Phase 5, không có drift. Sao lưu nguyên byte **63 file modified/untracked** và hash trước mutation vào `temp/aistudio-phase6/backup/`, danh mục `source-before.json`. Không có ignored source trong các thư mục source/test/docs/scripts/resources/extension được kiểm tra; temp/build/dependency junction không đưa vào Git.
- Commit source local: **`d3e354a42a949b4e836143b3ca6bee118479c7df`**, `feat(ai-studio): consolidate validated beta workflows and official media integration`.
- **67 file** được stage bằng danh sách tường minh, kiểm tra staged diff/path/whitespace và mẫu secret trước commit. Không stage wildcard toàn repository. Một commit source nhất quán để không tạo trạng thái trung gian thiếu schema/shared module/preload/IPC/UI. Commit tài liệu Phase 6 được tạo riêng sau khi chốt bằng chứng; SHA tip được ghi trong manifest cuối và `git log -2`.
- Giữ U01–U04, script guards, Kokoro/Piper, LLM readiness và provider-key isolation, frozen snapshot, checkpoint/lease, manual import/SEO, FFmpeg/timing/frame fixes và Official Media stage 6. Assembler chỉ thêm guard trim cho provenance official; manual import giữ chính sách đã nghiệm thu.
- Kiểm tra cuối: 63 backup nguyên vẹn; **466 file baseline trong 8 worktree khác**, **9 file UAT gốc**, báo cáo Phase 1–5, MP4 Phase 3 và Beta cũ giữ hash. Không sửa checkout Douyin/subtitle độc lập.
- Remote được kiểm tra read-only bằng `git ls-remote`: `origin/main` vẫn **`a99b7d780e2218f9c2362d30038c17006a0b97de`**, là tổ tiên của review HEAD. Không fetch/prune hoặc sửa remote-tracking ref. Trước Phase 6 ahead/behind **26/0**; sau source commit **27/0**, sau docs commit **28/0**.

Git consolidation không replay các nhánh cũ. Các patch tương đương/đã port của báo cáo Phase 4–5 được giữ; `8af33a6` subtitle preview clock vẫn ở checkout D để review riêng. Diff PR dự kiến bao gồm 26 commit review đã có cùng hai commit Phase 6; không gọi toàn bộ diff đó là riêng AI Studio.

## 3. Model/API và xử lý timeline

Đối chiếu [model card Omni](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash) và [hướng dẫn Interactions](https://ai.google.dev/gemini-api/docs/omni): model video `gemini-omni-1.1-flash` xuất 3–10 giây, 24 FPS. Route T2I vẫn dùng `gemini-3.1-flash-image`/generateContent, video dùng Interactions; không dùng payload Veo với tên model mới.

Các thay đổi Phase 6:

1. Preflight scene video trên 10 giây bị UNSUPPORTED; không tự sinh thêm clip. Scene dưới 3 giây chỉ được chạy khi đã chọn **Cho phép trim clip official**. Không gửi duration/FPS giả vào API.
2. Validation thực bằng FFprobe/FFmpeg: 720p, đúng aspect, decode đầy đủ; duration 3–10 giây với dung sai một frame metadata, FPS 24 với dung sai 0.01. Output 2 giây/11 giây/30 FPS bị từ chối dù là MP4 giải mã được.
3. Clip dài hơn scene quá 0.08 giây chỉ được gắn vào scene khi có quyền trim trong snapshot. Quyền đó được lưu `officialTrimAllowed` cùng scene; assembler kiểm tra lại trước render. Không âm thầm trim official artifact cũ chưa có quyền.
4. Clip ngắn hơn scene quá dung sai dừng với lỗi timing, giữ receipt/output. Chỉ tiếp tục khi scene có lựa chọn `freeze_last_frame` rõ ràng; retry/resume vẫn dùng receipt cũ, không POST bù. Test đã chứng minh trường hợp clip 3 giây cho scene 4 giây: lỗi → resume không tính thêm request → chọn freeze → stage 6 tiếp tục.
5. Video model 24 FPS và timeline 30 FPS được phân biệt: FFmpeg chuyển frame rate, không tăng tốc audio. Native UI render 3 giây ở 30/1 PASS; đây không phải clip Google Live.

T2I/T2V/I2V, pending interaction, Files ACTIVE/download và provenance vẫn có contract/native validation; không có Live acceptance mới. I2V gửi đúng bytes/hash keyframe của scene, không hứa khung đầu khớp pixel. First/last frame, FPS/duration request chính xác chưa được adapter triển khai.

## 4. Chi phí và request safety

Đã đối chiếu [bảng giá Google](https://ai.google.dev/gemini-api/docs/pricing): video 720p output tham khảo khoảng **$0.10/giây**, chưa gồm input/output khác. Đây không phải báo giá tổng hoặc trần chi phí. UI hiển thị cảnh báo, link nguồn, ô ghi **phạm vi chi phí được duyệt** và checkbox xác nhận ứng dụng **chưa có hard cap USD**. Thiếu ghi chú/xác nhận thì readiness BLOCKED; snapshot cũ không tự nhận quyền mới. Request count 1–20/episode vẫn là giới hạn số lần, không phải USD.

Không có cơ sở để hứa giới hạn tiền tuyệt đối từ số request khi chưa biết toàn bộ billing thực tế. Vì vậy không thêm bộ tính giả hoặc tự cấp quyền Live. Ghi chú ngân sách là bằng chứng phạm vi người dùng duyệt, không phải cơ chế tự chặn vượt tiền.

- Receipt exclusive tạo và fsync **trước POST**. Cùng process/lease không được tạo hai generation trùng. Giới hạn tính cả reservation đã lỗi/chưa đối soát.
- Response sidecar được ghi vào file tạm exclusive, fsync rồi publish bằng hard link không ghi đè. Crash trước publish không làm app POST lại: nếu có ID thì GET interaction cũ; không có ID thì cần đối soát.
- HTTP 401/403/429/500, timeout, cancellation, malformed response, quota và submission không rõ không tự retry paid POST. Không xóa receipt để vượt budget.
- Regenerate có nonce riêng scene, vẫn kiểm tra receipt cũ chưa đối soát. Pending có ID chỉ GET/poll lại; unknown không ID BLOCKED. Không có nút xóa đối soát tự động.
- Output hoàn thành được hash/decode lại khi recovery, không ghi đè file người dùng khác nội dung. Short/long mismatch giữ file và receipt thay vì generation lại.

Đây là cơ chế an toàn ứng dụng đã kiểm thử offline; không phải cam kết exactly-once billing của Google hoặc bảo đảm trước mọi lỗi phần cứng/mất điện.

## 5. Candidate độc lập và kiểm tra package

| Thuộc tính | Giá trị |
|---|---|
| Build ID | `aistudio-phase6-20261021-657f118df4d0` |
| Source commit | `d3e354a42a949b4e836143b3ca6bee118479c7df` |
| Source set SHA-256, 280 file | `657f118df4d0b3538def3021d2671bdb2963f50427de2ed191ccf0ea4a24d824` |
| EXE SHA-256 | `cb7930db9812eccef216c1ac302747c4bdfab5f5c82600769fcb877933f019dd` |
| app.asar SHA-256 | `42bd2534c8ff8ced5f114251c0370d0c7591a6c734f69723a156298768decb0f` |
| Electron | 43.5.0, Windows x64; unsigned directory candidate, không NSIS |
| Manifest | `InternalBeta-R2/phase6-manifest.json` và `temp/aistudio-phase6/final-manifest.json` |

EXE là Electron runtime; danh tính source của ứng dụng được gắn bằng commit/source hash/**app.asar hash**, không dựa riêng EXE hash.

Production renderer và main/preload build PASS trong snapshot cô lập. Đóng gói qua electron-builder với production dependency closure có sẵn, không npm install/rebuild/download. Lockfile nguồn và runtime seed bằng nhau khi parse JSON; khác raw hash do định dạng xuống dòng, không có thay đổi version. Package mới có runtime/dependency thật và **0 filesystem symlink/junction**; main/preload/home trong asar khớp byte build. Playwright chạy đúng EXE mới, xác nhận `app.isPackaged` và appPath trong asar, không chạy Electron từ build-check.

Kiểm tra FFmpeg/FFprobe/Whisper binary trong package: thực thi `-version`/`--help` exit 0. TTS và render tiếp tục sử dụng binary đóng gói thật. Chưa chạy Whisper inference có model trong lượt này; không gọi việc binary help PASS là ASR Live PASS.

Phát hiện thực tế khi inventory: dependency `@ffmpeg-installer/ffmpeg` mang theo `.env` chứa trường `NPM_CONFIG_TOKEN`. Không in/copy giá trị vào báo cáo hoặc Git, không thử sử dụng hoặc xác minh token. Candidate đầu bị loại. Đã thêm filter `.env`, `.env.*`, `.npmrc` vào cấu hình đóng gói và bỏ các file đó khi copy closure; R2 xác nhận không còn environment file, receipt/response/profile/model Piper trong archive. Seed/Beta cũ không bị sửa. Các lần đóng gói bị loại và cache riêng giữ local, không phân phối.

Không bundle Piper/model. Máy hiện tại dùng runtime đã cài. Với LOCALAPPDATA test không có runtime, packaged readiness trả `ready:false` và lý do thiếu cài đặt; không tự tải/cài hoặc fallback. Chưa cấp quyền phân phối model và chưa nghiệm thu clean Windows độc lập.

## 6. Kết quả kiểm thử có bằng chứng

| Hạng mục | Phân loại/kết quả | Bằng chứng chính |
|---|---|---|
| TypeScript, production renderer/main/preload | PASS — Automated build | `typecheck.log`, `build.log`; renderer 23.965s, main/preload 13.392s |
| Official API schema/parsing/T2I/T2V/I2V/Files | PASS — Offline Fixture/Contract | `contract.log`; transport giả lập, media PNG/MP4 native |
| 401/403/429/500, timeout/cancel/pending/restart, unknown/no duplicate | PASS — Offline Fixture/Contract | Receipt/recovery assertions; không provider Live |
| 3–10 giây/24 FPS, short scene consent, hỏng media | PASS — Offline + native validation | Chặn trước POST hoặc trước publish; giữ output cũ |
| Stage 6 → Stage 7, frozen snapshot/lease/ownership/hash | PASS — Offline transport + Native Runtime | `stage.log`, `stage-result.json`; video 3 giây FFmpeg thật |
| Manual import, ownership/corruption, IPC schemas | PASS — Native/Automated | `manual.log`, `import.log`, `ipc.log` |
| Packaged startup/preload/IPC, settings/cost/trim UI/DPAPI | PASS — UI E2E + Packaged Runtime | `electron-r3.log`, `electron-result.json`; key giả không plaintext trên disk |
| Piper tiếng Việt | PASS — Native Runtime | Packaged IPC tổng hợp lời nói thật **3.360s**; stage integration tổng hợp **4.800s**; không tone/mock |
| Thiếu Piper runtime | PASS — Packaged negative acceptance | Profile/environment riêng báo thiếu, không cài/fallback |
| Import SRT/audio/ảnh → render → restart | PASS — UI E2E + Native Runtime | Project riêng đường dẫn có dấu/khoảng trắng; MP4 3s, 720p30, full decode; audio/video hash giữ sau restart |
| Project Phase 3 | PASS — Packaged compatibility | Chỉ bản sao: 49 scene, audio/video/SEO giữ hash sau restart; không render thêm video dài |
| Approval recovery | PASS — Packaged checkpoint | Blueprint cung cấp thủ công ở gate 1, restart giữ facts hash và không tạo job trùng; không LLM Live |
| Google Official Media / LLM Live / đủ 8 stage tự động | BLOCKED | Chưa có quyền/key/quota/budget Live được chỉ định cho lượt thử |
| Clean Windows/NSIS installation | BLOCKED / NOT TESTED | Không có VM sạch độc lập; chưa tạo installer |
| Long-running soak/ASR inference/OCR/provider khác | NOT TESTED trong Phase 6 | Không chạy lại hoặc suy rộng kết quả lịch sử |

Native manual output review: `D:/VANHSUB-Phase6-20261021/acceptance/Native-manual-UAT-3s.mp4`, SHA-256 `931fd2643ce0ad50fda5b05e08688097c9644886e771d950a03f62fad23e95f0`. Đây là speech thật cắt 3 giây và ảnh fixture native nhập thủ công, không phải Full AI video. Video Phase 3 dài 236.433s vẫn nguyên hash `32e23b1c77ecaf29f261c033f05c734715b319a439a84572270fe7ab42192c08`.

Hai lượt UAT ban đầu dừng do selector test chọn trùng combobox. Đã định vị theo label đúng; không sửa logic ứng dụng hoặc bỏ assertion để PASS. Package lần đầu bị loại là phát hiện bảo mật nêu trên; R2 là candidate duy nhất được chốt. Main PID các lượt test cuối đã thoát. Không kết luận đã loại mọi resource leak từ kết quả này.

## 7. Thay đổi mới trong Phase 6

So với snapshot Phase 5: capability/readiness/shared types, provider video validation và atomic response publish, stage 6 trim guard, assembler official trim guard, MediaRouteSettings cost/trim UI; contract/stage/Electron tests tương ứng. Thêm `scripts/package-beta.cjs`, `scripts/start-internal-beta.ps1`, `tests/test_ai_studio_phase6_packaged.cjs`, filter bảo mật `electron-builder.yml` và báo cáo này. Package/lockfile không nâng version. Những file còn lại trong commit consolidation là source/test/docs Phase 1–5 đã được bảo toàn.

Manifest riêng ghi hash builder/packager/launcher bên cạnh 280 source file. Evidence thô nằm local `temp/aistudio-phase6/`, bị ignore. Không đưa profile, key, cookie, private provider ID, response base64, receipt hoặc output UAT vào Git.

## 8. Live UAT còn cần gì

Người dùng cần **chỉ định project, key có quyền/quota và phạm vi chi phí cho một request nhỏ** qua UI; không gửi key vào chat. Chọn Official API/model, limit 1, ghi phạm vi được duyệt và xác nhận chưa có hard cap USD; tạo episode mới để snapshot nhận cấu hình. Dùng một scene hợp lệ; I2V cần ảnh nhập đúng scene. Với video phải chọn chính sách trim nếu chấp nhận, freeze chỉ theo lựa chọn scene.

Chưa có quyền mới này trong Phase 6 nên không gọi provider. Khi được duyệt, chỉ chạy tối đa một request, kiểm tra receipt/media/provenance thật rồi dừng đánh giá. Không chạy toàn video 3–5 phút; không thử Flow RPC unusual activity hoặc bypass CAPTCHA. CONFIGURATION_READY không phải LIVE_VERIFIED. LLM Live cũng cần quyền/config riêng trước nghiệm thu đủ 8 stage; Facts không phải fact-check độc lập và timing hiện vẫn estimated.

## 9. PR, rollback và các blocker còn lại

Chưa tạo/push PR hoặc merge. PR tương lai từ `codex/aistudio-phase6-beta-20261021` sang `origin/main` cần người dùng duyệt phạm vi toàn bộ 28 commit ahead, bằng chứng UAT và các phần ngoài AI Studio đã có trong baseline. Không gộp nhánh D hoặc replay patch trùng.

Rollback source: dùng nhánh/commit đã lưu và backup để review; nếu cần hoàn tác sau này, tạo **revert commit** của integration trên nhánh được duyệt, cùng nhóm schema/provider/UI phụ thuộc. Không reset hard/clean/force push. Rollback sử dụng app: đóng candidate và mở Beta cũ; hai profile độc lập, không cần migrate ngược hoặc xóa dữ liệu.

Blocker thực tế còn lại: Official/LLM Live chưa nghiệm thu; không có trần USD tự động; submission không ID cần đối soát; clean installer/signing/soak chưa có; Piper phụ thuộc runtime cài sẵn và license phân phối chưa chốt; accurate alignment chưa triển khai. Internal Beta cho manual/native workflow trên máy này có thể UAT ngay, không tuyên bố Production Ready.
