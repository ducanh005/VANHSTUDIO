# AI Studio Phase 3 — Video tiếng Việt 3–5 phút

Ngày kiểm tra: 21/10/2026, Asia/Saigon. Tiếp nối báo cáo Phase 1 và Phase 2; không thay kết luận hoặc checkpoint UAT lịch sử.

## 1. Kết quả nghiệm thu

**Đã tạo được video tiếng Việt “Cuộc đua AI 2023–2026”, 16:9, 720p30, dài 236,433 giây.** Audio là lời đọc thật từ Piper tiếng Việt đã cài trên máy. Kịch bản được biên soạn, 12 hình minh họa tự tạo được nhập qua UI vào 49 cảnh; render FFmpeg và lưu SEO thủ công thành công. Restart Electron giữ nguyên audio, video và provenance.

**Manual/native acceptance: PASS trong phạm vi đã kiểm chứng. Automatic Full AI Live E2E: BLOCKED.** Chưa có bằng chứng LLM Live đủ điều kiện cho chuỗi tự động; Google Flow RPC vẫn bị chặn và không được gọi lại. Kokoro adapter được giữ nguyên, nhưng không lấy voice tiếng Anh làm bằng chứng TTS tiếng Việt.

Output để review, được sao chép sang ổ D và kiểm tra hash:

- Video cuối: `D:/VANHSUB-Phase3-20261021/acceptance/Cuoc-dua-AI-2023-2026-final.mp4`.
- Audio: `D:/VANHSUB-Phase3-20261021/acceptance/Giong-doc-tieng-Viet.mp3`.
- SRT: `D:/VANHSUB-Phase3-20261021/acceptance/Phu-de-timing-uoc-luong.srt`.
- SEO: `D:/VANHSUB-Phase3-20261021/acceptance/SEO-bien-soan.json`.

Video SHA-256: `32e23b1c77ecaf29f261c033f05c734715b319a439a84572270fe7ab42192c08`.

Bản MP4 trước sửa drift vẫn được giữ tại cùng thư mục với tên `Cuoc-dua-AI-2023-2026.mp4`; dùng bản `-final` để nghiệm thu. Không ghi đè bản đó.

## 2. Bảo toàn source và dữ liệu

- Chỉ sửa worktree `C:/Users/MTLS/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`, nhánh `codex/worktree-merge-audit-20261020`.
- HEAD giữ nguyên `58f4e7bc840a5774c6d09e87913f6ab869c985da`. Phase 1–3 vẫn chưa commit/stage; không push, merge, rebase hoặc cherry-pick.
- Hash danh sách file đang thay đổi trước Phase 3 lưu riêng ở `temp/aistudio-phase3/source-before.json`. Giữ các guard U01–U04, Kokoro, LLM readiness, provider isolation và manual import của Phase 1–2. Hai báo cáo trước không đổi nội dung.
- 9 file UAT gốc không đổi hash; không sửa checkpoint FAILED gốc. Beta `app.asar` vẫn có SHA-256 `fd7c63abc4b94068d80d892f2f27c2254bc045cb81b648f962304fa55d4a9e0a`.
- Đối chiếu 466 file có hash trong baseline 8 worktree khác: **0 file thay nội dung**. HEAD checkout D khác baseline cũ do công việc Douyin độc lập đã được ghi nhận ở Phase 2; không kết luận toàn bộ Git refs bất biến và không can thiệp thay đổi đó.
- Test dùng profile/store/project riêng; không dùng dữ liệu sản xuất. Các thư mục build mới nằm ở `D:/VANHSUB-Phase3-20261021/`; không ghi vào dependency junction hoặc build Beta cũ.
- Runtime evidence, profile, checkpoint và log riêng nằm dưới `temp/aistudio-phase3/` bị Git ignore. Không thêm account metadata, cookie, token hay key thật vào source/report.

## 3. TTS tiếng Việt đã triển khai

### Engine và phạm vi thực tế

Piper tiếng Việt đã tồn tại trong runtime riêng của Internal Beta. Adapter mới gọi worker `--worker` của bộ cài đó trực tiếp, dùng CPU và giới hạn thread. **Không tải model, cài Python/Docker, chạy HTTP server hoặc gọi dịch vụ trả phí.** Không thay đổi cấu hình/model của bộ cài đã có.

- Provider mới: `piper_local`, channel engine cùng tên; voice duy nhất `vi_VN-vais1000-medium`.
- Model gốc vi_VN, 22.050 Hz; audio được chuẩn hóa MP3 mono 24 kHz trong TTS service hiện hữu. Dữ liệu cấu hình được đối chiếu với model; không suy ra ngôn ngữ từ tên UI.
- [Cấu hình model công khai](https://huggingface.co/rhasspy/piper-voices/raw/main/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json) và MODEL_CARD đã cài được kiểm tra. MODEL_CARD ghi VAIS-1000/CC BY 4.0; engine có giấy phép riêng. Không đóng gói hoặc phân phối lại runtime/model trong build này.
- Kiểm tra SHA-256 worker/model trước khi chạy; chỉ tìm trong các vị trí runtime riêng đã biết. Renderer không chọn executable/script tùy ý qua IPC.
- Timeout 90 giây/đoạn, tối đa 6.000 ký tự, một worker tại một thời điểm. Rate -50% đến +100%; volume được chuẩn hóa; pitch khác 0 báo không hỗ trợ. Không tự đổi sang Edge/Kokoro khi lỗi.
- Worker offline, không shell; không đưa stdout/stderr narration vào log. Hủy tác vụ chờ child của chính tác vụ đóng trước khi dọn staging.
- Dùng lại tổng hợp từng câu, concat, chuẩn hóa và timing của `AiStudioTtsService`; không tạo pipeline TTS thứ hai. Stage 3 đọc engine/voice từ snapshot của episode. UI Settings/Cấu hình kênh có lựa chọn và nút kiểm tra runtime.

### Kết quả thật

- Probe giọng Việt: 7,464 giây audio thật; xử lý khoảng 10,771 giây.
- Video dài: 12 đoạn, 1.092 từ theo tách khoảng trắng, audio 236,424 giây; chuẩn bị audio/media mất 53,767 giây. Không phải synthetic tone/HTTP fixture.
- Native stage 3 → tạo audio → tạo engine mới → duyệt sang stage 4: PASS, không tái tổng hợp hoặc đổi hash audio.
- Hủy Piper đang chạy: PASS, giữ nguyên output cũ và script đầu vào; abort listener được gỡ.
- **Timing là `estimated_per_line`**, chia cue theo thời lượng đo của audio từng đoạn. Chưa phải forced alignment/word-boundary chính xác và chưa được người dùng nghe duyệt phát âm, nhấn giọng từng câu.
- Edge 403 và VietTTS HTTP không được gọi lại. Kokoro không có service đang chạy: synthesis Live **BLOCKED**; contract/normalization/cancel regression vẫn PASS.

## 4. LLM, approval và UX

| Lỗi/thiếu sót | Sửa chữa và bằng chứng |
|---|---|
| Structured script sai schema/rỗng có thể được thay bằng lời thoại mẫu hoặc đọc JSON | Validate nội dung từng line; structured response không hợp lệ báo lỗi. Loại lời thoại mẫu trong parser lỗi. HTTP loopback contract fixture kiểm tra schema hợp lệ, rỗng, sai kiểu, JSON hỏng và lỗi timeout. |
| SEO lỗi provider/schema vẫn có thể trông như thành công | Pipeline có config phải trả lỗi; không âm thầm sinh SEO dự phòng khi provider lỗi/adapter SEO chưa hỗ trợ. Utility no-config cũ không được dùng làm bằng chứng pipeline Live. |
| Duyệt stage khi artifact chưa hợp lệ | Shared UI/backend guard cho script, audio, timing, storyboard, media, video và SEO; kiểm tra tồn tại/file không rỗng cho media duyệt. Chặn thay đường dẫn qua `updatedArtifacts`; script sửa dùng cơ chế invalidation hiện hữu. |
| TikTok lỗi tự chuyển Edge | Bỏ fallback đó, báo thiếu session/provider/audio. Contract offline xác nhận không chuyển engine. |
| Manual SEO bị ghi là Chờ | `skipped` hiển thị Bỏ qua. Dữ liệu manual ở các stage nhập hiển thị Nhập thủ công; stage tự động hoàn tất chờ duyệt hiển thị Chờ duyệt. |
| Manual mode còn nút tự chạy provider | Vô hiệu hóa các nút tạo lại storyboard/media tự động trong manual mode; giữ thao tác nhập media. Không tự chuyển automatic sang manual. |
| Thiếu SEO khi không có LLM | Form SEO thủ công riêng, validate giới hạn qua IPC và backend, lưu file mới theo UUID, gắn `source: manual_authored`; không đăng tải hoặc gắn nhãn output LLM. |
| Lỗi cấu hình bị hiểu thành Google security block | Thu hẹp nhận diện unusual activity/CAPTCHA; hiển thị nhóm cấu hình, provider, media/timing và hệ thống. |

Readiness và snapshot Phase 2 được giữ. Kiểm tra snapshot, lựa chọn provider theo channel, đổi project/restart và không chuyển key/model/endpoint cũ sang provider mới: PASS bằng fixture/IPC có giới hạn tương ứng. HTTP fixture Custom LLM chỉ xác nhận contract, **không xác nhận model/provider Live**.

## 5. Media/render và lỗi phát hiện khi kiểm tra khung hình

1. Bỏ việc âm thầm dùng media của cảnh trước/cảnh đầu để thay cảnh thiếu file. Thiếu media báo lỗi và UI thoát busy, giữ audio hoàn thành; nhập lại file rồi xuất được.
2. FFmpeg render giới hạn 2 encoder thread và 1 filter-complex thread. Cancel chờ process đóng, gỡ listener; test native xác nhận owned FFmpeg đã thoát, không chỉ dựa vào promise reject. File video hoàn thành trước được giữ.
3. **Phát hiện drift chuyển cảnh:** trước sửa, frame ở 157 giây vẫn là minh họa 8 trong khi timeline đã sang minh họa 9. Nguyên nhân là làm tròn centisecond rồi trim từng cảnh riêng, tích lũy frame dư qua nhiều cảnh.
4. Sửa thành làm tròn **mốc cắt cộng dồn**, tính số frame nguyên từng cảnh, trim theo `end_frame`, chuẩn hóa PTS theo fps. Không còn ép cảnh ngắn tối thiểu 0,5 giây nếu timeline yêu cầu ngắn hơn.
5. Regression native 20 cảnh × 517 ms kiểm tra ảnh thực sát mốc cắt cuối: PASS. Regression render hỗn hợp, freeze clip ngắn, 30/60fps, dọc/4K và phần audio cuối vẫn PASS sau sửa.
6. Không mở tab Flow, không gọi lại generation RPC unusual activity, không masking hay bypass anti-bot. Media là 12 sơ đồ tự tạo, không gắn nhãn generation tự động.

## 6. Nghiệm thu video dài qua Electron

Profile riêng đã tạo project test mới, chọn rõ route nhập SRT + audio, nhập 49 cảnh bằng nút Chọn ảnh, lưu/restart và xuất bằng nút Xuất video thủ công. **Chỉ kết quả hộp thoại OS được stub để chọn file**; preload, trusted IPC, cấp quyền đường dẫn, media validation, provenance và FFmpeg đều chạy thật. Không seed checkpoint giả để gọi là toàn pipeline tự động.

Sau sửa assembler, mở lại chính project đã nhập, build mới chỉ rerender phần bị thay đổi; không lặp synthesis/import đã PASS. Output cũ giữ nguyên hash. Build cuối được kiểm tra lại toàn bộ decode và restart.

| Hạng mục | Số đo/kết quả cuối |
|---|---|
| Video | H.264, 1280×720, 30/1 fps, 16:9, 236,433333 giây |
| Audio nguồn | Giọng Việt Piper thật, MP3 mono 24 kHz, 236,424 giây |
| Audio trong MP4 | AAC, chênh duration so với nguồn dưới 0,15 giây |
| Render UI trên build cuối | 38.316 ms, một lần đo; không phải benchmark mọi máy |
| FFmpeg full decode | PASS toàn file với `-xerror` |
| Media | 49/49 cảnh ready, hash file trùng nguồn, provenance đúng project/session/scene, `automaticGeneration: false` |
| Chuyển minh họa | Frame 12/80/157/223 giây khớp minh họa 1/5/9/12; đối chiếu vùng tiêu đề với cả 12 ảnh, MAE 1,06–1,27/255 |
| Phụ đề | 49 cue; cuối ASS 0:03:56.42; kiểm tra khung hình có chữ tiếng Việt, không vượt audio |
| Audio cuối | RMS tại 234–235 giây khoảng 0,109, không bị mất phần lời cuối |
| Recovery | Restart trước render giữ media/audio; restart sau render/SEO giữ hash MP4/audio và `manual_authored` |
| Output safety | Rerender tạo file mới; bản MP4 trước không đổi hash; cancel native giữ output cũ |

Giới hạn: video dùng hình tĩnh có chủ đích, không chứng minh T2V/I2V Live; không đo chất lượng biên tập hay độ chính xác word-level từ full decode. Không suy luận memory leak/soak PASS từ thời gian render hoặc một lần lấy RAM.

## 7. Ma trận test và build

| Nhóm | Kết quả | Evidence trong `temp/aistudio-phase3/` |
|---|---|---|
| TypeScript toàn source | PASS, exit 0 | `typecheck-final.log` |
| Production renderer/main/preload | PASS | `build-final.log`, manifest trong build stage |
| LLM schema/timeout, approval, TikTok fail-closed | Automated PASS, fixture | `core.log`, `core-result.json` |
| Piper thật, stage 3/restart/timing/cancel | Real Native Runtime PASS | `core-result.json`, `prepare-long.log`, `long-input.json` |
| UI trạng thái/manual/approval/error/Piper | Automated UI fixture PASS | `ui.log` |
| UI U01–U04/Kokoro liên quan | Regression PASS, fixture | `ui-regression.log` |
| Snapshot/provider isolation | Automated PASS, fixture | `session-config.log`, `provider-isolation.log` |
| Kokoro contract/normalization/old output/cancel | Automated/native fixture PASS, không synthesis Live | `kokoro-regression.log` |
| IPC schemas | Automated PASS | `ipc-regression.log` |
| TTS alignment | Automated PASS | `alignment.log` |
| FFmpeg timeline + cancel + drift | Native Runtime PASS | `render-regression-final.log`, `render-guard-result.json` |
| Electron import/save/restart/manual render/SEO | UI integration + Native Runtime PASS | `electron-import-baseline.json`, `electron-result.json` |
| Output/source/UAT/Beta hashes | PASS trong phạm vi đã nêu | `final-manifest.json`, `other-worktrees-preservation.json` |
| LLM/provider automatic Live | BLOCKED, không gọi provider có phí | Thiếu cấu hình/quyền được xác minh cho lần chạy Live |
| Google Flow media Live | BLOCKED theo unusual activity đã biết | Không retry; không dùng session giả |
| Kokoro synthesis Live | BLOCKED do service chưa chạy | Không cài/chạy service mới |
| Nghe duyệt giọng, clean Windows, NSIS, soak | NOT TESTED trong Phase 3 | Không suy ra từ máy dev/build-check |

Các lần lỗi của harness được giữ: lần đọc trạng thái import quá sớm/chờ notice 4 giây và chờ label completed cũ khi rerender; đã sửa điểm đồng bộ, không nới kiểm tra output. Test Node snapshot chạy thiếu cờ dành riêng cho secret giả bị DPAPI fail-closed; chạy lại với cờ fixture chỉ trong process test. Electron nghiệm thu giữ cờ insecure test secrets bằng 0. Lỗi drift là lỗi sản phẩm thật và được sửa ở assembler; các file/video trước sửa còn lưu để đối chiếu.

## 8. Build và danh sách file

- Build cuối: `D:/VANHSUB-Phase3-20261021/vanhsub-build-check-YPXUa5`.
- Build ID: `aistudio-phase3-20261021-aba068a732aa`.
- SHA-256 bộ 277 file source allowlist: `aba068a732aa1371d8d2fd8a644df7c1d67f90e487d9225f4305fc72fa131c45`; **0 mismatch** giữa source cuối và build. Dependency runtime được pin theo bundle Phase 2 (Electron 43.5.0). Không tạo NSIS hay cài đè Beta.
- Build trước sửa frame giữ ở `D:/VANHSUB-Phase3-20261021/vanhsub-build-check-oJbR96`; không dùng làm build nghiệm thu cuối.

File code được bổ sung/sửa trong Phase 3, tương đối với worktree trên:

```text
main/tts-providers/piper/PiperLocalClient.ts              (mới)
shared/studioStageReadiness.js                           (mới)
renderer/components/ai-studio/PiperRuntimeStatus.tsx      (mới)
main/ai-studio/AiStudioPipelineEngine.ts
main/ai-studio/services/AiStudioTtsService.ts
main/ai-studio/services/AiStudioLlmService.ts
main/ai-studio/services/AiStudioVideoAssembler.ts
main/ai-studio/sessionConfig.ts
main/ai-studio/types.ts
main/ai-studio/ipc.ts
main/preload.ts
main/security/ipcPayload.ts
renderer/components/ai-studio/AiStudioSettingsTab.tsx
renderer/components/ai-studio/ChannelConfigModal.tsx
renderer/components/ai-studio/AutoPilotView.tsx
renderer/components/ai-studio/ActionableErrorBanner.tsx
renderer/components/ai-studio/autopilot/PipelineTrackerPanel.tsx
renderer/components/ai-studio/autopilot/StoryboardGridPanel.tsx
renderer/types/aiStudio.ts
renderer/types/electron.d.ts
tests/fixtures/ai_race_2023_2026_vi.json                   (mới)
tests/prepare_ai_studio_phase3_vi.ts                      (mới)
tests/test_ai_studio_phase3_core.ts                      (mới)
tests/test_ai_studio_phase3_ui.cjs                       (mới)
tests/test_ai_studio_phase3_render.ts                    (mới)
tests/test_ai_studio_phase3_electron.cjs                 (mới)
docs/VANHSUB_AISTUDIO_PHASE3.md                          (mới)
```

Những file Phase 1–2 đang dirty khác không được xem là thay đổi mới của Phase 3. Không có commit tương ứng vì yêu cầu giữ toàn bộ chưa commit để review.

## 9. Điều kiện tiếp tục Live và thao tác thực sự cần người dùng

**Internal Beta cho route đã kiểm chứng: CONDITIONALLY READY. Automatic Full AI Live E2E chưa đạt; Public Release không được kết luận READY.**

1. Người dùng nghe/duyệt MP4 và phát âm Piper, nhịp đọc, timing phụ đề ước lượng. Đây là duyệt chất lượng; không cần tự cài service để xem output đã tạo.
2. Muốn nghiệm thu automatic Facts → Script → TTS → Timing → Storyboard → Media → Render → SEO: cung cấp/cấu hình LLM endpoint/model có quyền truy cập hợp lệ và ngân sách nếu có phí. Readiness chỉ chứng minh cấu hình có điều kiện cần, không chứng minh quota/model Live. Snapshot đã FAILED lịch sử không tự nhận cấu hình mới.
3. Media tự động cần route API chính thức có key/quota được cấp phép; không tiếp tục Flow RPC đã chặn. Có thể tiếp tục nhập media hợp lệ theo route manual đã kiểm chứng. Chưa gọi API ảnh/video trả phí.
4. Nếu muốn Kokoro Live, cần cho phép cung cấp/chạy service tương thích; không cần làm việc này để sử dụng Piper tiếng Việt hiện có trên máy này. Máy khác thiếu runtime Piper sẽ báo chưa sẵn sàng, không tự cài.
5. Profile/project nghiệm thu riêng còn ở thư mục Temp và được tham chiếu trong evidence JSON; bản MP4/audio/SRT/SEO review đã sao chép sang ổ D. Không coi profile tạm hoặc build-check là bộ cài nâng cấp Beta; chưa phân phối runtime/model hoặc migrate dữ liệu sản xuất.

Không có bước bắt buộc nào còn thiếu để mở bản MP4 đã xuất. Chưa yêu cầu thao tác đăng nhập, CAPTCHA hoặc cấp key trong Phase 3 vì các hạng mục độc lập đã thực hiện xong; các quyền trên chỉ cần cho lượt nghiệm thu provider Live tiếp theo.
