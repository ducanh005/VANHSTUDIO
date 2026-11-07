# VANHSUB — Usable Beta Workflows, 20/10/2026

> **Cập nhật sau đợt này:** xem [Hoàn tất nghiệm thu Beta local](VANHSUB_BETA_COMPLETION_20261020.md). Source `ab0ef03` đã tích hợp main `a99b7d7`, sửa cấp quyền audio và đóng gate chọn file native bằng UI E2E thật. Nội dung bên dưới giữ nguyên kết quả lịch sử ở source `411a85b`.

Tiếp tục từ `60c6582`, trên `codex/integration-stabilization-20261015`. Bản Electron unpacked đã kiểm thử: source `411a85b`. Không merge main, không force push, không chạy lại Google Flow Web RPC.

## Quyết định

**INTERNAL BETA: CONDITIONALLY READY**, giới hạn cho các luồng local có hiệu đính phụ đề: ASR/OCR → SRT, SRT → Piper TTS → dubbing → hardsub; AI Studio nhập media thủ công → render. Đây chưa phải pipeline tự động hoàn chỉnh có dịch và sinh media từ provider.

**PUBLIC RELEASE: NOT READY.** Chưa có nghiệm thu cài Windows sạch; bộ cài NSIS cũ không được coi là bản build mới. Provider live, chất lượng nội dung và các blocker phát hành trước đây vẫn còn.

## Bản vá và nguyên nhân

| Commit | Thay đổi |
|---|---|
| `327dc1d` | Piper CPU chạy trong venv riêng, endpoint speech tương thích OpenAI local, launcher chống chạy trùng server; AbortSignal cho request TTS local |
| `1d99674` | Tạo episode thủ công thật từ SRT/audio được kiểm định; workspace riêng, owner theo project; chặn provider tự động trong phiên thủ công |
| `49f180f` | URL routing không đợi title; giới hạn đọc title 800 ms cho target không phản hồi |
| `c3cb1dd` | Adapter Gemini Image/Veo độc lập, explicit opt-in, reservation trước POST, không tự gửi lại yêu cầu có kết quả chưa rõ |
| `a4a5fff` | Nghe thử trước đây dùng `data:` bị CSP chặn. Chuyển sang Blob URL và thu hồi URL; hiển thị đúng Local TTS, cho chọn Piper làm giọng mặc định |
| `ae61510` | Xuất hardsub mặc định bị IPC từ chối vì UI gửi `formatOptions: null`; validator nay chấp nhận null nhưng vẫn từ chối object/enum sai |
| `411a85b` | Mở lại episode thủ công ở tab Visual; vô hiệu hóa các nút tiếp tục/tạo lại tự động không phù hợp, giữ nút xuất thủ công |

Các bản vá qua từng commit, không thay kiến trúc ổn định. Fetch xác nhận `origin/main` ở `a99b7d7`, có một commit Douyin mới ngoài baseline chung; integration có 12 commit riêng và main có 1 commit riêng. Commit Douyin đó chưa được tích hợp trong đợt nghiệm thu này. Source vẫn chứa `60c6582` và các bản vá trước đó.

## TTS local và tài nguyên

Đã cài Piper 1.8.0 và dependencies khóa hash vào venv Beta riêng; không đổi Python hệ thống hay shared Node dependencies. Voice thật `vi_VN-vais1000-medium`, model ONNX 63.201.294 byte, sample rate gốc 22.050 Hz; CPU provider, intra-op 2 threads, inter-op 1 thread. Engine/model không được nhúng vào installer Electron.

Service chỉ bind `127.0.0.1:6006`, từ chối Origin/Host không phù hợp, một inference mỗi lần, giới hạn request và timeout; khi client hủy thì dừng worker do service tạo. Launcher Beta đã được sao lưu trước khi thêm bước khởi động Piper. Service local tồn tại độc lập với app; không coi service này là orphan FFmpeg/Whisper của Electron.

VietTTS chưa triển khai. Preflight trước đó đo model khoảng 2,31 GB và Docker image nén khoảng 4,26 GB, chưa tính giải nén/cache. Tại lần kiểm tra đó ổ C còn khoảng 18,2 GB; ngày 20/10 còn khoảng 23,5 GB. Chưa có phép đo chứng minh VietTTS chạy ổn trên VRAM 4 GB; không kết luận nó chắc chắn OOM. Đã chọn Piper nhẹ hơn cho nhu cầu local hiện tại, không tải các layer/model VietTTS và không xóa container/volume.

Giữ model card/attribution. [Piper upstream](https://github.com/OHF-Voice/piper1-gpl) dùng GPL-3.0; [model card VAIS1000 tại revision đã pin](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/vi/vi_VN/vais1000/medium/MODEL_CARD) ghi nguồn dữ liệu CC BY 4.0. Đây là cài riêng trên máy test, chưa phải nghiệm thu quyền phân phối trọn gói runtime/model.

## Kết quả thực tế và phân loại

| Hạng mục | Phân loại và kết quả | Giới hạn |
|---|---|---|
| Nghe thử Piper | **UI + Real Local Provider PASS**: phát hết audio 2,670 s, Blob URL, không lỗi decode | Chưa đánh giá giọng bằng người nghe |
| Điều chỉnh tốc độ provider | **Real Runtime PASS**, 16/10: cùng lời tiếng Việt, 1× 3,448 s; 1,25× 3,187 s | Một mẫu ngắn; không suy ra tỷ lệ chính xác cho mọi câu |
| Video → ASR → SRT | **UI ASR / Real Runtime PASS**: Whisper tiny, 1,719 s cho video mẫu; tạo SRT thật | Task được import qua IPC. Còn sai từ, chưa PASS độ chính xác nội dung |
| Hardsub → OCR → SRT | **UI OCR / Real Runtime PASS**: Tesseract tiếng Việt, 7 frame, 2 cue, 11,461 s | Còn sai dấu dù confidence cao, cần hiệu đính. Không chạy Paddle trong bài này |
| SRT → Translation | **BLOCKED_NO_KEY** | Không gắn nhãn SRT viết/hiệu đính thủ công thành kết quả dịch provider |
| SRT đã đối chiếu → TTS | **UI + Real Local Provider PASS**: hai cue, 10,840 s; MP3 tổng hợp có thật | MP3 tổng hợp mặc định dùng flexible timing; không đồng nhất với strict dubbing |
| Timing → Dubbing | **UI / Real Runtime PASS**: câu thứ hai tempo khoảng 1,16684, `truncated:false`; video 3,520 s | Nghiệm thu mẫu ngắn, không chứng nhận mọi video dài |
| Hủy và chạy lại TTS | **UI / Real Local Provider PASS**: hủy inference thật trong khoảng 112 ms, active worker về 0; output cũ giữ nguyên hash; chạy lại thành công | Rerun 1× tái dùng cache audio thật tương thích; không giả nhận là synthesis mới |
| Dubbing → Hardsub | **UI / Real Runtime PASS sau ae61510**: 640×360 H.264/AAC, 3,529 s; giữ đường dẫn dub riêng | Trước bản vá là FAIL IPC, không tính task `done` cũ thành export PASS |
| AI Studio manual import | **Real Runtime IPC PASS**: episode từ SRT/audio thật, hai scene ảnh/video, hash và owner project/session/scene khớp | Native file-picker UI E2E **BLOCKED_BY_AUTOMATION_TOOL**; không dùng mock session/checkpoint |
| Preview và render Studio | **UI preview/render với IPC setup PASS**: ảnh/video giải mã được, render 1920×1080 H.264/AAC, 3,467 s; FFmpeg full decode exit 0 | Media nhập thủ công, `automaticGeneration:false`, không phải Flow Live PASS |
| Save/reopen | Project/episode thật mở lại sau restart; giữ media, video đã render và chế độ manual | Không thay thế toàn bộ bài crash recovery/provider timeout dài hạn |
| Google Flow Web RPC | **BLOCKED** theo kết quả unusual activity trước đây; 0 request generation mới trong đợt này | Không retry, không bypass anti-bot/CAPTCHA |
| Official Image/Veo | **Automated contract PASS; Live Provider NOT TESTED/BLOCKED_NO_KEY** | Adapter được chuẩn bị ở router, chưa bật đường gọi trả phí trong UI |
| CDP toàn context | **Chưa đóng blocker cũ** | Bản vá title chỉ giải quyết khám phá target sau khi kết nối; không chứng minh `connectOverCDP` hết timeout |

Đã nhìn frame hardsub thật, thấy câu “Xin chào Việt Nam.” hiển thị đúng dấu. MP3, video dub, hardsub và video Studio đều qua FFprobe và FFmpeg full decode. File đầu vào và media gốc giữ nguyên hash. Không dùng synthetic tone/mock để xác nhận TTS/provider live.

## Build và phạm vi hồi quy

Renderer TypeScript PASS; renderer production build, main webpack và Electron unpacked packaging PASS. Main webpack còn 5 warning dependency tùy chọn trên platform khác; không đổi chúng trong đợt này. 524 file source/build khớp manifest; 8 file Extension đóng gói khớp source, phiên bản 1.0.9 giữ nguyên.

Chỉ chạy các kiểm tra liên quan: Blob audio lifecycle; IPC default export và payload sai; cùng các contract manual episode, title timeout, official provider ở đợt triển khai trước. Không chạy lại full suite, không rebuild native Whisper hay NSIS. Những PASS cũ không được gắn lại thành provider live mới.

Bộ kiểm thử nghe thử ban đầu timeout do polling dựa vào animation frame khi cửa sổ nằm nền. Kiểm tra trực tiếp HTMLMediaElement xác nhận Blob, readyState 4, ended=true và currentTime=duration. Hộp thoại file Windows hiện đúng nhưng công cụ định vị sai control; không coi lỗi công cụ này là bằng chứng app chọn file thành công hoặc app chọn file hỏng.

## API hình/video chính thức

Adapter chuẩn bị cho `gemini-3.1-flash-image` qua generateContent và `veo-3.1-fast-generate-preview` qua predictLongRunning, GET operation và download được kiểm định. Hỗ trợ reference image đúng bytes, thời lượng video 4/6/8 s, 720p, aspect ratio 16:9 hoặc 9:16. Key chỉ nằm trong header; không ghi response body/key vào log. Download giới hạn host và kích thước, không follow redirect mang key sang host khác. File hoàn thành không bị ghi đè.

Reservation/operation receipt nằm cạnh output: POST timeout là kết quả chưa rõ, cần xem receipt/operation thay vì tự gửi lại. Contract fixtures chứng minh shape, guard, cancellation và bảo toàn output; chưa chứng minh quyền truy cập, chất lượng hay billing thực tế.

Theo [bảng giá Google kiểm tra ngày 20/10/2026](https://ai.google.dev/gemini-api/docs/pricing), Gemini 3.1 Flash Image Standard khoảng $0.067 cho output 1K, chưa tính input/text; Veo 3.1 Fast 720p $0.10/giây, tức khoảng $0.80 cho video 8 s. Không phải route miễn phí; chưa gọi API hoặc phát sinh chi phí trong đợt này. Các model mới hơn có thể có contract/giá khác. [Tài liệu image](https://ai.google.dev/gemini-api/docs/image-generation), [Veo](https://ai.google.dev/gemini-api/docs/veo).

## Vận hành Beta hiện tại

1. Dùng launcher `1 - Mo VANHSUB Beta.cmd` trong thư mục Beta đã chuẩn bị. Launcher tự mở service Piper nếu chưa chạy, rồi mở app; không cần Docker hoặc Chrome cho các bước local.
2. Cài đặt → giọng mặc định chọn **Piper tiếng Việt — CPU local**. Tab Lồng tiếng chọn **Local TTS**; endpoint đang cấu hình là loopback 6006. Chỉ một job Piper mỗi lần.
3. Nhập video, chọn Whisper.cpp/tiny để dùng model đã cache; tạo SRT rồi hiệu đính tên riêng, từ và dấu. OCR Bottom có thể dùng cho phụ đề hardsub nhưng vẫn cần đọc lại.
4. Nếu chưa có key dịch, dùng SRT đã được dịch/hiệu đính hợp lệ, không kỳ vọng app dịch offline. Tạo audio → chọn strict/chặt → ghép Dubbing → Xuất video, nguồn Auto/đã lồng tiếng → Hardsub.
5. Studio: mở project test, **Nhập SRT + audio thủ công**, chọn hai file tương ứng; SRT 1–1000 cue, không chồng lấn, điểm kết thúc audio/SRT lệch không quá 750 ms. Trong Visual chọn ảnh/video cho mỗi scene rồi **Xuất video thủ công**.
6. Output đã nghiệm thu gồm MP3 tổng hợp, `sample_dubbed_mono_1.mp4`, `sample.hardsub.mp4` và video `final_video_*.mp4` trong episode Studio. Dùng thư mục dự án trong app để mở file. Không dùng installer NSIS cũ để thay cho unpacked Beta mới.

Không di chuyển/copy toàn bộ dữ liệu production vào Beta. Nếu cần báo lỗi, giữ log và evidence local, loại bỏ key/cookie/tài khoản/project ID riêng tư trước khi chia sẻ. Raw evidence đợt này ở thư mục local `docs/internal-beta-evidence/2026-10-20/usable-beta/`, không đưa lên GitHub; báo cáo này là bản tổng hợp không kèm định danh runtime riêng tư.

## Việc còn cần hoàn tất

- Đóng nghiệm thu native file picker bằng thao tác chọn SRT/audio thật của người dùng; pipeline xử lý phía sau đã chạy thật qua IPC và UI render.
- Cung cấp key/quota hợp lệ nếu muốn nghiệm thu dịch hoặc official visual API; không cần key cho local TTS/dubbing/export.
- Người dùng nghe và đánh giá giọng Piper; tiếp tục hiệu đính ASR/OCR. Confidence OCR cao không bảo đảm đúng dấu.
- Tách nghiệm thu Google Flow hợp lệ và CDP toàn context; không thử lại RPC bị chặn.
- Tích hợp riêng commit main mới, rồi kiểm thử phần bị ảnh hưởng trước khi đề xuất merge. Không có đề xuất tự merge/main hoặc phát hành trong báo cáo này.
- Public release tiếp tục cần Windows sạch/NSIS cập nhật, kiểm thử dài hạn, provider live và các security/recovery gate còn mở trong báo cáo RC.
