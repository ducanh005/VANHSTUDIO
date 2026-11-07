# AI Studio Phase 4 — Stabilization và integration readiness

Ngày: 21/10/2026, Asia/Saigon. Tiếp nối Phase 1–3; không thay thế báo cáo, Beta hoặc checkpoint UAT cũ.

## 1. Quyết định nghiệm thu

**GO có điều kiện cho review Internal Beta trên máy hiện tại, phạm vi manual/native và Piper tiếng Việt. NO-GO cho Automatic Full AI Live E2E và Public Release.** Chưa có thao tác Git tích hợp/phát hành nào được thực hiện.

| Phạm vi độc lập | Kết quả | Giới hạn |
|---|---|---|
| A. Manual/native video production | PASS kỹ thuật | Video Phase 3, media tự tạo, timing ước lượng; cần nghe/xem duyệt chất lượng |
| B. Piper Vietnamese TTS | Real Native Runtime PASS | Một voice vi_VN đã cài, CPU; không phải mọi máy/voice/đoạn văn đều được nghiệm thu |
| C. LLM Live generation | BLOCKED cho nghiệm thu Live | Không đọc credentials; chưa có provider/account/model và ngân sách Live được chỉ định cho Phase 4 |
| D. Automatic media generation | BLOCKED | Flow unusual activity; official adapter chưa nối vào stage 6/UI; video model preview sắp ngừng |
| E. Automatic Full AI E2E | NO-GO / BLOCKED | A+B không thay cho C+D; chưa có lần chạy thật đủ 8 stage |
| F. Packaging / clean installation | NOT TESTED; clean Windows BLOCKED | Candidate build-check trên máy dev, không phải installer/clean-install PASS |

Không phát hiện lỗi media mới cần xuất lại video. Các lỗi mới sửa ở LLM/storyboard, assembler và audio Phase 3 không đổi; giữ nguyên bản MP4 đã nghiệm thu.

## 2. Git và công việc chưa commit

- Worktree duy nhất được sửa: `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`.
- Branch `codex/worktree-merge-audit-20261020`, HEAD giữ `58f4e7bc840a5774c6d09e87913f6ab869c985da`. Các sửa Phase 1–4 vẫn chưa stage/commit. Không reset, merge, rebase, cherry-pick, push hoặc xóa file/worktree/stash.
- Đã đọc 9 worktree, 11 local branch và 6 remote-tracking ref, cùng alias origin/HEAD; stash trống. Không sửa checkout Douyin/subtitle tại D.
- `git ls-remote origin refs/heads/main` xác nhận remote main vẫn **a99b7d780e2218f9c2362d30038c17006a0b97de**. Không fetch/prune hay thay ref để kiểm tra việc này.
- `origin/main` là tổ tiên nhánh review: **26 commit chỉ ở review, 0 commit chỉ ở origin/main**. Local `main` là lịch sử cũ `df9d768`; so với review phân kỳ 87/5, không dùng local main đó làm baseline tích hợp.
- Nhánh D `codex/douyin-media-inspection` ở **8af33a6**. So với review, graph có 7 commit riêng phía D; không đồng nghĩa cần cherry-pick cả 7.
- 466 file có hash trong baseline 8 worktree khác giữ nguyên nội dung. 9 file UAT gốc, hai báo cáo Phase 1–2, báo cáo Phase 3 và Beta `app.asar` giữ nguyên. Video Phase 3 giữ SHA-256 `32e23b1c77ecaf29f261c033f05c734715b319a439a84572270fe7ab42192c08`.

### Phân loại Phase 1–3 và phụ thuộc

| Nhóm | Nội dung giữ lại | Điểm giao nhau phải review cùng nhau |
|---|---|---|
| Phase 1, U01–U04 | Trạng thái thật, bỏ điểm AI giả, canonical script, catalog Kokoro | Engine, IPC, ScriptWorkspace, header, channel modal, types |
| Phase 2 | Kokoro HTTP adapter, LLM readiness/snapshot/key isolation, manual SRT+audio/import/render | TTS, sessionConfig, store, preload, shared guards, Settings và AutoPilot |
| Phase 3 | Piper vi_VN native, approval/artifact guards, manual SEO, fail-closed script/SEO, frame-based render | Cùng engine/IPC/types/TTS/UI; không thể chia phase bằng cách stage nguyên file |
| Phase 4 | Blueprint/storyboard fail-closed, shot coverage, không tự gửi lại generation khi quota | Chỉ 2 production source file khác candidate Phase 3: LLM service và storyboard service |

Các snapshot dirty-file được đối chiếu tại `temp/aistudio-phase4/phase-classification.json`. Đây là phân loại bằng content hash; không phải các commit độc lập. Build cuối vẫn chứa 277 file source allowlist, chỉ 2 file production khác build Phase 3, xác nhận không mất các module Phase 1–3 khác. File test có sửa được liệt kê ở phần 9.

### Các commit phía D và kế hoạch không gộp trùng

| Commit | Quyết định review |
|---|---|
| `5402ea6`, `df9d768` | `git cherry` xác nhận patch tương đương đã có; không replay |
| `39beaa6` | Freeze/fill mode đã port qua `78fc559`, giữ snapshot/lease mới; không lấy nguyên implementation cũ |
| `070c919` | I2V/provenance/CDP đã port qua `2f2bcdd`; không suy ra Flow Live hiện tại từ UAT cũ |
| `ea1b716` | Workflow 20–30 giây/3 scene đã port qua `f1fd533`; giữ ownership mới |
| `96da0ca` | Douyin inspection đã có bản tích hợp `a99b7d7` + `bf9984c`; không replay bản cũ |
| `8af33a6` | Thay đổi subtitle preview clock mới, 3 file, chưa có ở review. Giữ nguyên tại nhánh D để review riêng, không tự tích hợp trong Phase 4 |

Mapping các port được đối chiếu với `WORKTREE_MERGE_AUDIT.md` và source hiện tại, ngoài kiểm tra patch-id. Các HAR, script thao tác browser, output và project thử nghiệm chưa track ở D không phải đầu vào tự động cho merge.

**Kế hoạch tích hợp để người dùng review trước:**

1. Giữ nguyên các worktree; dùng manifest/source hash của candidate này làm mốc. Chưa thực hiện commit hoặc tạo nhánh mới trong Phase 4.
2. Khi được phép, tạo nhánh review từ HEAD review đã xác minh; đưa toàn bộ bản sửa AI Studio và test/docs liên quan vào trạng thái commit có thể build. Do file giao nhau qua nhiều phase, không tách commit theo tên file mà làm mất schema/preload/shared guard phụ thuộc. Có thể dùng một commit tích hợp AI Studio nhất quán, rồi tách hardening khi hunk đã được kiểm chứng riêng.
3. Review `8af33a6` riêng; nếu được duyệt, tích hợp clock vào nhánh đó, chạy đúng regression subtitle/editor/preview và kiểm tra UI. Không cherry-pick toàn nhánh D hoặc đè file bằng ours/theirs.
4. Kiểm tra remote main lại ngay trước tích hợp, so diff nhánh review với origin/main, bảo đảm các bản vá bảo mật mới hơn còn nguyên. PR phải cho thấy cả các commit review lịch sử và dirty changes đã được phê duyệt.
5. UAT candidate/duyệt chất lượng trước quyết định merge. Không merge vào main đang phân kỳ cũ; mọi thay đổi main/remote phải là bước được người dùng cho phép riêng.

## 3. Lỗi mới đã sửa và kiểm chứng

| Phát hiện source / tái hiện | Bản sửa | Validation |
|---|---|---|
| Blueprint trả rác/thiếu outline vẫn được bù bằng dàn ý giật gân mẫu | Cần title/hook/angle và ít nhất 3 ý có nội dung; không sinh outline mẫu. Vẫn repair/extract được nội dung provider thực sự cung cấp đủ schema | HTTP fixture hợp lệ, rác, rỗng, sai kiểu; adversarial parser hợp lệ và noise fail-closed |
| Storyboard thiếu prompt/mapping bị tự bổ sung, bỏ sót hoặc đảo câu | Validate media_type, image_prompt và coverage câu thoại liên tục, đúng thứ tự, đúng số lượng; không đoán mapping khi thiếu | Các response thiếu prompt, thiếu câu, sai thứ tự bị từ chối; schema hợp lệ được giữ |
| LLM storyboard lỗi rồi chạy greedy fallback, có thể trông như stage LLM thành công | Nếu đã chọn LLM clustering mà provider/schema thất bại, dừng stage và báo rõ; giữ script/audio/timing. Thuật toán local không dùng LLM vẫn được giữ cho mode vốn được cấu hình như vậy | Inject timeout vào LLM; stage báo lỗi, artifact trước còn nguyên; storyboard modes regression PASS |
| OpenAI-compatible SDK tự retry generation khi 429/5xx | `maxRetries: 0` cho client LLM; retry là quyết định chạy lại có chủ đích | HTTP 429 fixture nhận đúng 1 request |
| Blueprint SDK error có thể bị log nguyên object | Log tên provider và thông báo đã redact/key-replace, không in object SDK/raw response | Error fixture và source review; không đọc key thật |

Không viết lại kiến trúc, không đổi default voice/model, không thay renderer trong Phase 4. Test adversarial cũ mong đợi noise thành blueprint đã được sửa theo contract mới: tăng dữ liệu fixture hợp lệ lên 3 ý, thêm angle còn thiếu và assert noise phải throw; không bỏ kiểm tra để đạt PASS.

## 4. Kiểm tra khách quan video Phase 3

File kiểm tra: `D:/VANHSUB-Phase3-20261021/acceptance/Cuoc-dua-AI-2023-2026-final.mp4`. Không ghi đè hoặc đổi hash file này.

| Kiểm tra | Kết quả đo |
|---|---|
| Streams / duration | H.264 1280×720 30 fps, 236,433333 giây; AAC 24 kHz, metadata 236,364 giây |
| FFmpeg full decode | Exit 0 với `-xerror`; không thấy corruption |
| Blackdetect | 0 interval, ngưỡng pixel 0,1 và thời gian ít nhất 0,5 giây |
| Silencedetect | 0 interval kéo dài ít nhất 0,8 giây ở ngưỡng -40 dB |
| Freeze | 48 sự kiện ở ngưỡng -50 dB/1 giây. Media là hình tĩnh có chủ đích, subtitle đổi theo cue; không gọi các hold này là renderer bị treo |
| Scene boundaries | 11 lần đổi minh họa; kiểm tra ảnh ngay trước/sau mốc cắt theo timeline 30 fps: 22/22 mẫu đúng identity, không bị giữ ảnh cũ qua mốc cắt |
| Phụ đề | Raster toàn bộ 49 cue trên nền đen bằng libass; bbox x=22…1256, y=528…575 trên 1280×720. 0 mẫu chạm vùng rủi ro 16 px quanh mép |
| Thứ tự/timing cue | Tất cả end>start, không đảo/overlap, cue cuối kết thúc 236.424 ms; trong thời lượng audio |
| Audio cuối | PCM decode nguồn 236,363542 giây, output 236,373333 giây. 0,5 giây cuối vùng chung có tương quan 0,999998; RMS nguồn/output 0,08647/0,08645 |
| Hash / provenance | SHA-256 MP4 trùng Phase 3; 49 scene trùng file hash và metadata manual_import |
| Restart | Candidate mới mở bản sao project thực, sau restart giữ audio/video/49 media hash và SEO manual_authored |

Khác biệt metadata MP3/AAC khoảng 60 ms không chứng minh bị cắt lời; PCM decode cho thấy output bao phủ nguồn, tín hiệu cuối gần như trùng. Các ngưỡng trên không phát hiện mọi lỗi ngắn hơn ngưỡng. Bbox không thay việc đọc hiểu phụ đề, kiểm tra ngắt dòng đẹp hay nghe duyệt phát âm. Không có ground truth cho độ tự nhiên/phát âm và chưa đánh giá chủ quan chất lượng biên tập.

Evidence riêng: `video-quality.json`, `av-scan.log`, `subtitle-frames/`, `boundaries.json`, `audio-tail.json` dưới `temp/aistudio-phase4/`.

## 5. Piper và timing

- Dùng nguyên runtime/model vi_VN đã cài và TTS service hiện hữu; không cài/chạy service hoặc tải model. Không đóng gói lại model/Python/Piper trong candidate.
- Giới hạn adapter giữ như Phase 3: một worker CPU, tối đa 6.000 ký tự/đoạn, 90 giây/đoạn, speed -50%…+100%; pitch khác 0 báo không hỗ trợ. Voice/model được pin; không coi là runtime tổng quát cho mọi Piper voice.
- Line audio đo bằng FFprobe. Word timing được phân phối ước lượng trong khoảng line; `alignmentSource=estimated_per_line`, không phải forced alignment. Manual SRT cũng cần người dùng duyệt nếu nguồn timing không chính xác.
- Whisper.cpp hiện có tạo transcript/SRT; Faster-Whisper có word timestamps, nhưng transcript nhận dạng lại không tự động trở thành forced alignment của đúng canonical script. Hybrid token alignment đang có có thể dùng để so khớp transcript với script sau này, cần ngưỡng coverage và kiểm chứng trước khi áp dụng.
- Không chạy nhánh có thể tải model hoặc cài Python mới. Không thêm timing pipeline song song hay đổi nhãn thành accurate word alignment. Phase 3 đã sửa drift frame cộng dồn, Phase 4 kiểm tra trực tiếp toàn bộ các lần đổi minh họa.
- Regression native Piper stage 3/cancel/restart còn PASS trên source cuối. Kiểm thử TTS hỏng ở câu thứ hai là **fault injection**, dùng speech có sẵn và xác nhận không mutate input/ghi đè output; không gọi đó là provider failure Live.

## 6. Contract của chuỗi Automatic

Các stage dùng snapshot riêng của episode; đổi cấu hình toàn cục không đổi snapshot cũ. Checkpoint ghi atomic sau stage hoàn tất, lease theo session ngăn thao tác chồng nhau. Resume kiểm tra stage trước và readiness ở stage cần LLM; invalidation có thể bỏ pointer của output cần tạo lại nhưng giữ file cũ/revision trên đĩa.

| Stage | Đầu vào → provider thực tế → artifact | Validation / recovery / lỗi |
|---|---|---|
| 1 Facts | Topic/blueprint → LLM API hoặc blueprint người dùng đưa → facts.json | Parser mới fail-closed. “Facts” hiện là outline/nguồn nhập, **chưa phải bộ kiểm chứng sự thật độc lập có citation**. Restart gate giữ facts |
| 2 Script | Blueprint + channel/snapshot → DeepSeek/OpenAI/Custom hoặc route web đã cấu hình → script/canonical lines | Script schema/readiness, không filler khi lỗi; cancel/lease chặn kết quả hoàn tất muộn; chưa Live |
| 3 TTS | Canonical script + voice snapshot → Piper/Kokoro/Edge/TikTok được chọn → per-line audio + MP3 | Staging, probe, output safety; hỏng câu giữa rollback; worker cancel, không đổi engine ngầm |
| 4 Timing | Audio + script/metadata → module TTS/FFprobe hiện hữu → aligned lines/timing | Measured line timing, estimated words được ghi nhãn; không tự nhận forced alignment |
| 5 Storyboard | Script/timing + mode/snapshot → LLM clustering hoặc thuật toán local theo mode → storyboard/scene mapping | Schema và coverage mới; lỗi LLM không tự chuyển greedy. Mode local không phải LLM generation Live |
| 6 Media | Scene/prompt/keyframe → Flow/DOM theo engine hiện có → media/index/provenance | Flow bị chặn chưa nghiệm thu lại. Official adapter độc lập chưa được gọi từ stage này. Manual route hoạt động riêng |
| 7 Render | Validated scenes/audio/subtitle + rendering snapshot → FFmpeg → MP4 mới | Frame timeline, missing/corrupt media guard, owned-process cancellation; giữ output cũ |
| 8 SEO | Script/topic → API LLM có adapter → metadata | Schema fail-closed, không metadata mẫu khi lỗi; giữ video hoàn thành. Manual SEO riêng ghi nguồn thủ công, không publish |

**Giới hạn cancellation cần giữ trong UAT:** các request LLM hiện có timeout SDK 45 giây, không phải mọi call đã nhận AbortSignal để hủy transport ngay. Lease giữ tới khi request kết thúc và chặn late completion/duplicate; cancel có thể chưa giải phóng tài nguyên ngay. Chưa có soak/concurrency dài hạn để chứng minh toàn ứng dụng không leak.

## 7. Live provider readiness

### LLM

DeepSeek/OpenAI có endpoint mặc định; Custom cần model, endpoint và key hợp lệ. Readiness/snapshot/provider ownership đã kiểm chứng bằng fixture; không gọi provider trả phí, đọc key thật hoặc đăng nhập web. HTTP 429, malformed blueprint/script/storyboard và injected timeout được phân loại **Automated**, không Live PASS.

Điều kiện cho lượt Live tiếp theo: người dùng chỉ định provider/model/endpoint đang được phép sử dụng và giới hạn request/chi phí, cấu hình key qua UI. Sau đó chỉ thử một request nhỏ trước, không chạy toàn video hoặc retry vô hạn. Không suy ra tài khoản thật thiếu key chỉ vì profile test mới chưa có key. Web routes không được dùng để vượt bảo vệ và chưa được xác nhận đủ adapter cho toàn chuỗi, nhất là SEO.

### Media chính thức

`OfficialGeminiVisualProvider` có route image generateContent và video long-running, API key trong header, không redirect, kiểm tra host download, media decode và receipt/idempotency chống submit trùng. Test contract offline về I2V bytes/cancel/output/host còn PASS; **không chứng minh model, quota, response schema Live còn tương thích**.

- Source search chỉ có định nghĩa `generateOfficial`, không có caller trong app stage/UI. Có key đơn thuần **chưa đủ** để chọn route này trong pipeline; còn công việc nối route rõ ràng và provenance/error handling được nghiệm thu.
- [Tài liệu image generation](https://ai.google.dev/gemini-api/docs/image-generation) còn liệt kê `gemini-3.1-flash-image` mà adapter dùng. Không tự đổi sang model khác.
- [Tài liệu video Google](https://ai.google.dev/gemini-api/docs/video), cập nhật 19/10/2026, thông báo các Veo 3.1 preview, gồm `veo-3.1-fast-generate-preview` đang hard-code trong adapter, ngừng ngày **22/10/2026**. Cần review migration contract/model trước nghiệm thu Live; không thay model âm thầm hoặc gọi thử route cũ có phí.
- Không gửi Flow RPC unusual activity, không browser masking, CAPTCHA bypass hoặc giả session. Manual import vẫn độc lập; chứng cứ Flow E2E cũ không được dùng để nâng trạng thái hiện tại.

## 8. Build, runtime và regression

Candidate: `D:/VANHSUB-Phase4-20261021/vanhsub-build-check-Ub3Kjo`.

- Build ID **aistudio-phase4-20261021-4df749da19e7**.
- SHA-256 bộ 277 source allowlist: `4df749da19e7fd9f9c39bc211edcc364c14b99d8c011c43bb079cbe28779453d`; 0 mismatch source cuối/build.
- Renderer production PASS, main/preload production PASS, TypeScript PASS.
- main.js: `3c6210b21ca3a205987935224b32dff44da1fa1a0e978eb516238c9d23d25ec2`.
- preload.js: `96266b3160d321f3d660097eecb9afcad5707cc54bfebc0d582814861a2dee55`.
- Manifest đầy đủ ở `temp/aistudio-phase4/final-manifest.json` và `phase4-manifest.json` trong candidate. Electron 43.5.0 từ dependency bundle đã pin; build-check còn dựa dependency junction trên máy dev, không phải bản phân phối độc lập.

| Bài kiểm tra liên quan | Kết quả / evidence |
|---|---|
| New schema/quota/storyboard/middle TTS failure/output path/invalid snapshot | Automated PASS; `stability-result.json`, `stability.log` |
| Approval/resume race, lease cancel, late result, interrupted recovery | Automated PASS; `operations.log` |
| Storyboard modes | Automated PASS; `storyboard-modes.log` |
| Adversarial suite liên quan parser/storyboard | 13/13 PASS; `adversarial.log` |
| Script/SEO schema và native Piper stage 3/restart | Automated + Native Runtime PASS; `llm-regression.log`, `core-result.json` |
| Official media contract | Offline contract PASS; `official-contract.log`, không Live |
| Candidate fresh profile | Real Electron startup/IPC/Piper readiness PASS |
| Genuine Phase 3 project compatibility | COPY sang profile riêng, remap chỉ đường dẫn test đã copy; 49 media/MP4/audio/SEO hash PASS; original không bị mở để migrate |
| Restart completed và awaiting approval | Real Electron PASS; gate fixture blueprint nhập sẵn, không LLM generation |
| Process cleanup | Sau shutdown hoàn tất, 0 main PID test còn chạy; không thấy FFmpeg/Python test còn chạy. Không suy ra soak/memory-leak PASS |
| Missing/corrupt media, render cancel | Giữ bằng chứng Native PASS Phase 3 vì assembler không đổi; Phase 4 thêm full-file quality/boundary checks |

Thử đường dẫn output bị chặn bằng parent là file (ENOTDIR) trên project riêng: output cũ nguyên vẹn. **Chưa coi đây là NTFS ACL-denied hoặc clean Windows permission PASS.** Lần đầu fault-injection harness dùng nhầm vị trí argument output đã được sửa; log lỗi giữ riêng. Kiểm tra PID ngay lúc Electron đang shutdown từng thấy PID còn sống; kiểm tra sau shutdown xác nhận đã thoát, không kill process người dùng hoặc gọi đó là memory leak.

Không dựng thêm installer: chưa nghiệm thu clean Windows, candidate chưa độc lập dependency và chưa xác minh điều kiện phân phối runtime/model. Không đóng gói Piper/model hoặc cài đè Beta. Source renderer/media không đổi nên không chạy lại toàn bộ UI/render regression đã PASS chỉ để tăng số lượng.

## 9. Danh sách thay đổi Phase 4 và việc còn lại

Production source:

- `main/ai-studio/services/AiStudioLlmService.ts`: blueprint/shot guards, quota no-retry, sanitized blueprint errors.
- `main/ai-studio/services/AiStudioStoryboardService.ts`: fail-closed khi LLM clustering lỗi.

Test/report:

- `tests/test_ai_studio_phase4_stability.ts`, `tests/test_ai_studio_phase4_electron.cjs`: mới.
- `tests/test_challenger_m2_adversarial.ts`: cập nhật fixture/expectation đúng schema, thêm noise rejection.
- `tests/test_ai_studio_phase3_core.ts`: cho chọn thư mục evidence để regression tiếp theo không ghi đè kết quả Phase 3; kết quả lượt Phase 4 được tách riêng.
- `docs/VANHSUB_AISTUDIO_PHASE4.md`: báo cáo này. Các script quality/hash/inventory nằm trong temp ignored, không đưa runtime metadata lên Git.

**Bắt buộc người dùng:** nghe/xem video để duyệt phát âm, nhấn giọng, ngắt dòng, nội dung và nhịp dựng; nếu muốn Live, chỉ định/cấp quyền provider và budget, nhập key qua UI. Không cần tự mở Chrome/cài service để xem video đã xuất.

**Công việc kỹ thuật còn cần trước Automatic Full Live:** nối official media route vào stage/UI có lựa chọn rõ ràng; migration model/API video sắp ngừng; kiểm tra request/response/provenance Live có quota hợp lệ; quyết định yêu cầu kiểm chứng facts/citation; cải thiện transport cancellation nếu cần SLA hủy nhanh; chỉ áp dụng ASR/alignment khi có coverage/ground truth phù hợp. Các việc này không thể giải quyết bằng tuyên bố fixture PASS hoặc chỉ yêu cầu người dùng thêm key.

**Trước Public Release:** bản phân phối độc lập, license review nếu phân phối runtime/model, clean Windows install/uninstall, filesystem ACL, recovery/soak và provider Live theo phạm vi sản phẩm. Không thay thế bằng nghiệm thu máy dev. Kế hoạch Git ở phần 2 chỉ là đề xuất để review, chưa thực hiện.
