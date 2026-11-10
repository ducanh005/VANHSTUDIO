# Tiến độ sửa AI Studio

Phạm vi: báo cáo kiểm tra AI Studio ngày 14/10/2026. Sửa theo từng đợt nhỏ, kiểm chứng và push từng commit lên main.

## Đợt 1 — Cách ly dữ liệu từng tập (AS-01)

- Tập mới lưu tại `<output>/sessions/<sessionId>`; media ở thư mục riêng của tập, kể cả khi nhiều kênh dùng chung output hoặc thư mục media ngoài.
- Session giữ `ownerProjectId`, `workspaceDir` và `mediaDir`; đọc/ghi/import/render không chuyển theo kênh đang active.
- Catalog checkpoint riêng theo ID giúp tìm lại tập sau restart. Checkpoint chỉ được nạp khi ID trong file khớp ID yêu cầu.
- Giữ đường dẫn legacy đã xác minh. Chặn ghi/render/regenerate nếu checkpoint/index thuộc session khác hoặc catalog chỉ ra tài nguyên dùng chung. Không tự di chuyển/xóa tài nguyên legacy.
- Ghi checkpoint thất bại được trả thành lỗi; không tiếp tục báo lưu thành công. File tạm có UUID và được dọn khi thất bại.

Kiểm chứng:

- `tests/test_ai_studio_session_isolation.ts`: pass; real start/storage/import, không gọi provider. Bao gồm hai tập cùng output/media root, switch/restart, lookup sai ID, bảo toàn legacy, chặn conflict trước fallback DOM, và lỗi ghi đĩa.
- TypeScript main và renderer: pass.
- `git diff --check`: pass.
- Bộ `scripts/test_google_flow_rpc_visual_service.ts` chưa pass và dừng trước các case engine: mock video/regenerate rơi vào endpoint kế thừa và yêu cầu cookies; fallback kỳ vọng cũ; test file rỗng dùng `assert.throws` cho `validateMediaFile` async, tạo rejection không được xử lý. Các lỗi đầu ra nằm trong service/RPC/test chưa sửa ở đợt này. Không coi bộ này là bằng chứng regression đã pass.

Giới hạn: chưa xác nhận provider live hay UI Electron. Chưa xử lý snapshot cấu hình, khóa job, invalidation, alignment hoặc render timeline; các mục này thuộc đợt sau. Legacy đã bị ghi đè vẫn không thể tự phục hồi.

Commit đợt 1: `e27fd6a` (đã push main).

## Đợt 2 — Giữ đủ lời đọc và áp dụng thông số dựng phim (AS-08, một phần AS-12)

- Clip ngắn được loop để bao phủ đúng thời lượng cảnh; xuất video giới hạn theo thời lượng giọng thay vì cắt theo stream visual ngắn nhất.
- Ken Burns nhận một frame nguồn rồi mở thành đúng số frame của cảnh, tránh nhân thời lượng khi ảnh input đang loop. Kiểm tra actual output duration trước báo dựng thành công.
- FPS 30/60 được dùng cho input, zoompan, filter và output; 4K thật theo tỷ lệ ngang/dọc/vuông.
- `tests/test_ai_studio_render_timeline.ts`: FFmpeg thật, pixel sampling xác nhận thứ tự/cắt cảnh, mẫu audio cuối xác nhận còn lời đọc, video dọc 60fps, ảnh có/không Ken Burns và một bản dựng 4K thật.
- TypeScript main/renderer và diff whitespace được kiểm tra trước commit.

AS-12 còn phần preset phụ đề và các thông số transition/zoom; chưa coi toàn bộ AS-12 đã hoàn tất. Chưa nghiệm thu footage/giọng thật hoặc bản đóng gói.

Commit đợt 2: `7d2d583` (đã push main).

## Đợt 3 — Lưu đúng cấu hình kênh và kết quả lưu (AS-10, một phần AS-11)

- Backend lưu chỉnh sửa channelProfile vào savedProjects của project active; đổi kênh hoặc mở lại store không mất avatar/mô tả/voice/master prompt. Checkpoint mang bản sao profile cũ không được ghi đè profile hiện hành.
- Settings chỉ gửi các section người dùng sửa, không gửi cả project list/profile cũ. Form giữ section đang chỉnh khi có cập nhật tiến độ; các section chưa sửa vẫn nhận cấu hình mới. Edit phát sinh trong lúc save không bị đánh dấu đã lưu nhầm.
- Settings/reset/modal kênh/setup/chuyển/xóa project kiểm tra boolean lưu thành công; lỗi giữ nguyên màn hình và hiển thị thông báo lỗi. Setup dùng một lần saveProject thay vì nhiều lần ghi cùng dữ liệu.
- Modal kênh không reset draft chỉ vì response checkpoint tạo object profile mới có cùng nội dung.
- `tests/test_ai_studio_channel_settings.ts`: pass; kiểm chứng qua renderer store nối backend thật trên thư mục tạm, A→B→A, restart, checkpoint profile cũ, bảo toàn draft và rollback lỗi ghi.
- TypeScript main/renderer và diff whitespace: kiểm tra trước commit. Chưa nghiệm thu UI Electron trực quan.

AS-11 còn việc tuần tự/version hóa toàn bộ request store và cập nhật checkpoint/project data đồng thời; đợt này không coi tất cả race condition đã xử lý. Snapshot cấu hình của tập (AS-02) vẫn thuộc đợt riêng.

Commit đợt 3: `1c9c422` (đã push main).

## Đợt 4 — Cấu hình cố định theo từng tập (AS-02)

- Tập mới chụp riêng các section sản xuất, áp dụng options và tỷ lệ của blueprint khi start. Không chụp cả danh sách project. API key LLM/visual dùng cùng codec bảo vệ secret của settings store trước khi ghi checkpoint.
- Duyệt/resume, tạo lại scene, dựng lại video và IPC chấm/sửa script lấy cấu hình của session. Chuyển kênh/đổi model/giọng/thông số chung không đổi cấu hình của tập đang làm.
- Lựa chọn provider/voice tường minh trong options không bị profile kênh ghi đè; thông tin dự án Flow vẫn gắn với owner/session.
- Đổi shotMode/granularity của tập là override tường minh khi chạy lại từ bước 5, có kiểm tra enum và bước. Không sửa defaults của kênh khác. UI hiển thị tỷ lệ/resolution/FPS đã chụp và đọc mức phân cảnh/provider từ snapshot.
- Legacy có owner xác minh được sẽ chụp profile owner cùng cấu hình chung hiện tại vào lần sử dụng đầu. Không thể phục hồi cấu hình chung lịch sử đã bị thay đổi; session không xác định được owner khi đang có project active được chặn, thay vì lấy cấu hình kênh khác.
- `tests/test_ai_studio_session_config.ts`: pass trên store/checkpoint thật; các provider giả lập. Kiểm tra options, credential không có plaintext trong checkpoint, A→B/restart, đường gọi script/voice/render/regeneration và override storyboard. Không coi đây là nghiệm thu provider live.
- Regression cách ly session và TypeScript main/renderer được kiểm tra. Chưa xử lý AS-03 (khóa job), AS-04 (revision/invalidation) hoặc nội dung AI/refiner ở đợt này.

Commit đợt 4: `f642fb2` (đã push main).

## Đợt 5 — Khóa tác vụ và kiểm soát chuyển bước (AS-03)

- Reservation đồng bộ theo session bảo vệ approve/resume, render/regenerate/import và IPC sửa/chấm kịch bản. Tác vụ của session khác vẫn chạy độc lập.
- Approve phải khớp bước hiện tại, bước đã success và session đang awaiting_approval. Từ chối stage ngoài 1–8 trước khi xóa/reset artifacts. Hai lệnh duyệt đồng thời chỉ có một lệnh được chấp nhận.
- Cancel abort/kill process nhưng giữ khóa tới khi promise thật kết thúc. Chặn nhận kết quả script/TTS/metadata muộn sau cancel, và kiểm tra signal trước lưu media/render.
- Cancel ở cổng duyệt giữ success của bước đã hoàn tất; resume mặc định sang bước kế tiếp. Shared error handler luôn nhả khóa và vẫn gửi lỗi khi không lưu được failure checkpoint.
- Lookup phân biệt job đang chạy thật với checkpoint running đã gián đoạn. `jobActive` là dữ liệu runtime, không lưu xuống checkpoint. UI khôi phục trạng thái chạy và lấy kết quả hủy từ backend, không tự giả lập thành công khi hủy lỗi.
- `tests/test_ai_studio_session_operations.ts`: pass; kiểm chứng duyệt sai bước, payload không làm đổi dữ liệu khi bị từ chối, duyệt trùng, khóa mutator, provider bỏ qua abort, cancel tại gate, kết quả muộn và phục hồi job gián đoạn.
- Snapshot/cách ly regression và TypeScript được kiểm tra. Provider live và UI Electron trực quan vẫn chưa được nghiệm thu.

Commit đợt 5: `5d6e81e` (đã push main).

## Đợt 6 — Vô hiệu hóa sản phẩm sau khi sửa kịch bản (AS-04)

- Sửa lời đọc/speaker/voiceDirection hoặc thứ tự dòng làm mất hiệu lực audio, alignment, storyboard, sub, video và metadata; quay về cổng duyệt kịch bản. Chỉ đổi chỉ dẫn hình ảnh giữ audio/timing và quay về cổng duyệt alignment nếu đã hoàn tất.
- Mỗi lần sửa lời hoặc chạy lại bước 1–3 dùng thư mục production revision mới. Checkpoint giữ vị trí ổn định; voice/timing/media cũ không bị xóa và không được dùng làm cache cho bản lời mới. Undo cũng tạo revision mới, không khôi phục pointer audio cũ.
- Chặn kịch bản rỗng/ID trùng; no-op giữ sản phẩm. Lưu history trước thay đổi; bỏ điểm đánh giá cũ.
- IPC trả lại session đã invalidation. Inline edit/undo chỉ cập nhật UI khi lưu thành công; lỗi giữ form. Refinement không tự chấm lại bằng closure chứa lời cũ. Bỏ auto-evaluation trùng với backend. Callback lưu checkpoint đúng owner và chặn response từ project đã rời.
- `tests/test_ai_studio_script_invalidation.ts`: pass trên checkpoint/storage thật, kiểm tra visual-only, narration, undo, no-op, input lỗi, cache mới, giữ file cũ và chặn render stale.
- Regression session operations/config và TypeScript main/renderer: pass. Chưa nghiệm thu provider live hoặc UI Electron trực quan. Cơ chế regenerate/cache media theo từng shot (AS-09) vẫn cần đợt riêng.

Commit đợt 6: `61690dd` (đã push main).

## Đợt 7 — Chỉnh kịch bản theo provider và yêu cầu thật (AS-05)

- Xóa bộ sửa mẫu chèn La Braña/Tây Ban Nha và phát hiện khảo cổ vào mọi chủ đề. Refinement gửi kịch bản, blueprint, phong cách và toàn bộ chỉ dẫn người dùng tới provider của tập (API/ChatGPT Web/Gemini Web).
- Prompt yêu cầu giữ dữ kiện/chủ đề, không bịa số liệu/xung đột. Parser chỉ nhận nội dung lời và chỉ dẫn, giữ ID/thứ tự/số dòng; chặn thiếu dòng, ID sai, lời rỗng hoặc enum sai. Không nhận audio/timing/file pointer từ model. Rút gọn hiện thực hiện trong từng dòng.
- Provider lỗi hoặc JSON không hợp lệ sẽ báo lỗi, không trả bản sửa mẫu giả thành công. UI hiển thị lỗi và giữ yêu cầu tự nhập để thử lại. Nếu bản sửa hợp lệ nhưng chấm lại lỗi, giữ bản sửa và bỏ điểm cũ.
- `tests/test_ai_studio_script_refinement.ts`: pass với provider giả lập; kiểm tra yêu cầu tùy ý, đầu vào chủ đề, không thêm mẫu khảo cổ, schema và thất bại không fallback. TypeScript main/renderer kiểm tra trước commit. Chưa xác minh chất lượng phản hồi provider live; chấm điểm heuristics AS-06 xử lý riêng.

Commit đợt 7: `330f51a` (đã push main).

## Đợt 8 — Chấm điểm có nguồn gốc và cấu hình đúng (AS-06, phần chấm kịch bản)

- Bỏ chấm regex/điểm cố định, bỏ lời khẳng định dữ kiện đúng và thông báo so sánh chất lượng provider không có bằng chứng. Gửi toàn bộ lời thoại tới `evaluationLlm` của tập; phản hồi phải đủ D1–D10, điểm 0–10, nhận xét từng tiêu chí và critique. Điểm tổng/thấp nhất/tiêu chí yếu tính từ phản hồi đã kiểm tra.
- Lưu method/provider và hiển thị nguồn gốc nhận xét. Đánh dấu rõ chưa kiểm chứng nguồn độc lập; D2 là dữ kiện cần kiểm chứng. Điểm legacy chưa biết phương pháp được nhắc chấm lại.
- Không dùng API key/baseURL của provider hiện hành để gọi API provider khác. Do settings chỉ có một bộ API credential, lựa chọn API chấm khác provider hiện hành báo thiếu cấu hình; web hoặc cùng API provider hoạt động theo cấu hình đã lưu.
- IPC evaluate/refine dùng script/blueprint hiện hành trong session, trả canonical session và kiểm tra abort trước lưu. UI hiển thị lỗi chấm điểm. Không sinh điểm giả khi provider/JSON lỗi; auto-evaluation lỗi không chặn script đã tạo.
- `tests/test_ai_studio_script_evaluation.ts`, refinement, session operations/config và TypeScript: kiểm tra bằng provider giả lập. Không chạy provider live hoặc nghiên cứu nguồn bên ngoài. Chức năng research/fact-check vẫn còn cần xử lý riêng; không coi điểm LLM là kiểm chứng dữ kiện.

Commit đợt 8: `b0d36ca` (đã push main).

## Đợt 9 — Giữ timing TTS theo đoạn và lấy word boundary (AS-07)

- Edge TTS bật wordBoundary, đọc metadata stream theo cấu trúc SDK đang cài; gom offset đúng vị trí từng dòng. Metadata thiếu/sai/không bao phủ đầy đủ lời đã đọc chuyển sang ước lượng theo chính thời lượng audio của dòng đó.
- Stage 4 giữ word timestamps đã lưu ở stage 3, kể cả khi mở lại app; không chia đều lại toàn video. Khi không có metadata, dùng duration từng dòng, bỏ ép audio ngắn thành tối thiểu 1 giây/ép dòng thành tối thiểu 1,5 giây.
- Timing chỉ dùng văn bản đã sanitize để đọc; chặn dòng chỉ chứa emoji/ký hiệu. Lưu và hiển thị nguồn timing: metadata, ước lượng theo đoạn, hoặc hỗn hợp; legacy chưa có nguồn được đánh dấu rõ.
- `tests/test_ai_studio_tts_alignment.ts`: pass với metadata/provider/audio probe giả lập; kiểm tra audio 400ms, hai dòng 600ms/5400ms, metadata thiếu, loại emoji, timeline không vượt audio và stage 4 không ghi đè mốc từ. Snapshot/invalidation regression và TypeScript: pass.
- Chưa đo word boundary qua Edge/TikTok live hoặc nghiệm thu karaoke trực quan; ước lượng vẫn có sai số trong nội bộ từng dòng khi provider không có metadata.

Commit đợt 9: `e3c2791` (đã push main).

## Đợt 10 — Tôn trọng chế độ shot và thời lượng storyboard (AS-14)

- Pipeline không ép enableClustering=true. Service bảo vệ chế độ single/multi tường minh kể cả khi caller gửi clustering=true: single giữ 1:1, multi phân rã trong từng câu thay vì gộp câu.
- Thời lượng playback của shot giữ toàn bộ narration; thời lượng clip yêu cầu provider là ràng buộc riêng. Không cắt timeline 14 giây thành 8 giây hoặc kéo đoạn dưới 2 giây thành 2 giây. Clip ngắn được assembler lặp theo timeline từ đợt 2.
- `tests/test_ai_studio_storyboard_modes.ts`: pass trên storage thật, không gọi LLM; kiểm tra 4 câu/4 shot ở cả ba granularity, single dài 14 giây, multi và tổng duration. TypeScript main và diff kiểm tra trước commit.
- Chỉ dẫn hình ảnh/camera bị mất khi đổi dạng script (AS-15) xử lý đợt tiếp theo. Chưa nghiệm thu visual provider live.

Commit đợt 10: `9ef7aa7` (đã push main).

## Đợt 11 — Giữ chỉ dẫn hình ảnh/camera qua storyboard (AS-15, phần ánh xạ)

- Dùng cùng adapter script ở bước 2 và 5; lưu visualAction/visualNote, cameraAngle/cameraMovement, suggestedMediaType và voiceDirection. Chỉ dẫn hình ảnh vừa sửa được ưu tiên hơn visualPromptEn cũ.
- Storyboard single/multi giữ các field khi dựng processedScenes; tôn trọng media và camera người dùng chọn. Mô tả tĩnh có chỉ dẫn camera không bị nhánh tối ưu đổi về góc toàn/static.
- Visual note tường minh được giữ nguyên ngữ nghĩa/ngôn ngữ, không bị dictionary thay Tokyo hiện đại thành Nhật thế kỷ 19. Prompt có thể chứa chỉ dẫn tiếng Việt; không giả vờ đã dịch toàn bộ sang tiếng Anh.
- `tests/test_ai_studio_visual_directions.ts`: pass qua script.json và storyboard thật, kiểm tra chỉ dẫn mới thay prompt cũ, camera, media và voiceDirection được lưu. Storyboard-mode regression và TypeScript kiểm tra trước commit.
- Chưa áp dụng văn bản voiceDirection tự do thành prosody TTS; preset rate/pitch/volume vẫn là cấu hình thực thi. Quy tắc hợp nhất các chỉ dẫn xung đột trong clustering legacy và chất lượng visual provider live còn cần nghiệm thu riêng.

Commit đợt 11: `84cb13e` (đã push main).

## Đợt 12 — Nhập media hợp lệ và bỏ sản phẩm dựng cũ (AS-17)

- Manual import kiểm tra scene thuộc session, ID an toàn và giải mã media thật trước cập nhật index/checkpoint. Kiểm tra cả ảnh nhỏ dưới 512 byte. File sai/hỏng/sai loại bị từ chối; chỉ dọn bản copy mới lỗi, không sửa file nguồn hoặc các phiên bản trước.
- Thay ảnh xóa video pointer của shot trong session/index và chuyển playback về Ken Burns. Thay video giữ keyframe ảnh. Import/regenerate thành công đều xóa pointer video/sub/metadata cuối và reset bước dựng/SEO; quay về cổng duyệt media nếu các cảnh đã sẵn sàng.
- UI lấy canonical checkpoint sau import/regenerate, không merge videoPath cũ; bỏ fallback chỉ gắn đường dẫn khi backend không tồn tại. Capture owner/session, không để response muộn đổi UI/loading của project mới.
- Version scanner/current lookup hỗ trợ đúng extension thực (JPEG/WebP/GIF/WebM), đường dẫn theo customMediaDir; không mặc định current version luôn PNG/MP4.
- `tests/test_ai_studio_media_import.ts`: pass với PNG/JPEG/MP4 sinh và giải mã bằng FFmpeg thật, file hỏng/sai loại/scene lạ, source bất biến, thay ảnh/video, invalidation, custom media và giữ lịch sử. Session isolation regression/TypeScript: pass.
- Validator hiện nhận các định dạng ảnh phổ biến và video nhận diện MP4/WebM; container khác không được coi đã hỗ trợ chỉ dựa vào extension. AS-09 RPC cache/scope vẫn cần đợt riêng.

Commit đợt 12: `1d8e5d0` (đã push main).

## Đợt 13 — RPC chạy đúng shot và tạo sản phẩm mới (AS-09)

- Chọn job theo missing/selected/all; validate selected và yêu cầu tạo lại bắt đầu từ bước 6 trước khi invalidation. Pipeline chỉ dispatch subset và merge lại vào toàn bộ scenes; không mất/đổi shot ngoài lựa chọn. UI regenerate không bị redirect sang approve/currentStage khác.
- Dispatch và single regeneration dùng tên file có shot ID + UUID; không đè file cũ hoặc đánh số lại selected thành scene_01. Cache key có workspace scope; explicit regenerate có nonce mới, cố định trong vòng retry. Hai tập dùng chung Flow project/prompt không nhận lại asset của workspace khác.
- Mode both dùng I2V tạo keyframe và video, trả cả hai path; mode image tường minh ưu tiên hơn outputMode chung. RPC giữ media_type của storyboard, không biến tất cả shot ảnh thành video vì defaults.
- Chặn hoàn tất bước 6 nếu còn shot thiếu file, kể cả khi selected subset đã thành công. No-op missing không gọi provider.
- `tests/test_ai_studio_visual_jobs.ts`: pass qua pipeline loop/router/service với provider và bridge giả lập; kiểm tra subset merge, cache retry/regenerate, workspace, tên file không đè, both/image và missing gate. Session operations/config và TypeScript: pass.
- Không gọi Google Flow live. Cache theo nội dung reference file và các khác biệt model/provider đầy đủ còn cần kiểm tra cùng AS-16; đợt này không tuyên bố đã nghiệm thu toàn bộ Flow.

Commit đợt 13: `f1ad24f` (đã push main).

## Đợt 14 — Nhạc nền có tác dụng đúng khi render (AS-20)

- 0% tắt BGM thật; không fallback thành 12% hoặc làm nhỏ giọng đọc. Nhạc ngắn được loop/trim đúng thời lượng voice; file đã cấu hình nhưng mất hoặc volume sai báo lỗi.
- Sửa channel-layout khiến ducking fail trên FFmpeg 4.x đi kèm app. Bù normalization của amix theo cách tương thích FFmpeg cũ; pad SFX để level không thay đổi khi effect ngắn kết thúc. Limiter bảo vệ peak của audio đã trộn, không tự nâng gain.
- Settings có chọn/bỏ file nhạc và slider tới 0%; dialog qua preload/IPC. Kết quả dialog merge vào form hiện hành để không ghi đè edit khác khi đang chọn file. Config vẫn theo snapshot tập như đợt 4.
- `tests/test_ai_studio_bgm_audio.ts`: pass với render/giải mã FFmpeg thật; đo phổ 400Hz voice/1000Hz BGM, kiểm tra 0%, loop track 0,3s tại 1,5s, mức voice, ducking, SFX ngắn và lỗi config. TypeScript main/renderer kiểm tra trước commit.
- Chưa nghiệm thu dialog/UI Electron trực quan và loudness mục tiêu LUFS cho nhiều loại nguồn âm thanh; limiter không thay thế loudness normalization.
