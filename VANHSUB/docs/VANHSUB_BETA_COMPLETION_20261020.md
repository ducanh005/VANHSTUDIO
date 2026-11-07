# VANHSUB — Hoàn tất nghiệm thu Beta local, 20/10/2026

Tiếp nối báo cáo Usable Beta, không audit lại. Nhánh `codex/integration-stabilization-20261015`; source ứng dụng đã build và chạy thật: `ab0ef03`. Không merge vào main, không force push, không thử lại Google Flow Web RPC.

## Git và bản vá

Fetch cuối đợt xác nhận `origin/main` ở `a99b7d7`. Commit này đã được tích hợp vào nhánh Beta qua merge `bf9984c`; kiểm tra ancestry xác nhận main là tổ tiên của integration. Tại source `ab0ef03`, integration ahead 15 / behind 0 so với main. Các báo cáo chưa commit được sao lưu trước merge và giữ nguyên hash qua merge; không reset hoặc ghi đè chúng.

| Commit | Nguyên nhân và xử lý |
|---|---|
| `bf9984c` | Tích hợp chức năng kiểm định media từ main. Phát hiện tiến độ softsub lên 100 rồi lùi 98 khi bắt đầu kiểm định; assertion hồi quy tái hiện FAIL trước sửa. Giữ render/dubbing tối đa 97%, kiểm định 98%, hoàn tất 100%; callback FFmpeg không kéo tiến độ lùi. Không tự chọn ours/theirs; không có conflict source. |
| `ab0ef03` | UI chọn audio ngoài các thư mục project trả `MEDIA_FORBIDDEN`: hộp thoại trả đường dẫn nhưng chưa cấp quyền cho file. Sửa `dialog:openAudioFile` dùng cơ chế cấp quyền từng file đã chọn giống các hộp thoại khác. Không cấp quyền toàn bộ thư mục. |

Không nâng dependency, không đổi shared node_modules, không sửa dữ liệu production. Chức năng kiểm định media tạo báo cáo/bản biên tập riêng theo tùy chọn; không kết luận media không còn watermark hoặc quyền tác giả.

## Nghiệm thu mới trên ứng dụng đóng gói

| Luồng | Bằng chứng mới và kết quả |
|---|---|
| SRT + audio qua hộp thoại Windows | **UI E2E / Real Runtime PASS sau ab0ef03.** Chọn SRT tiếng Việt và audio Piper thật ngoài project Studio. Tạo episode mới thành công; trước sửa cùng trường hợp thất bại MEDIA_FORBIDDEN. Không gọi IPC để thay thế thao tác chọn file trong bài này. |
| Nhập media cho scene | **UI E2E / Real Runtime PASS.** Chọn ảnh thật cho scene 1, video thật có đường dẫn Unicode/khoảng trắng cho scene 2 qua hộp thoại native. Hash file, owner project/session/scene đúng; provenance `manual_import`, `automaticGeneration:false`. Không phải Flow generation PASS. |
| Preview → render Studio | **UI E2E / Real Runtime PASS.** Ảnh/video preview giải mã được; nút Xuất video thủ công tạo video 1920×1080 H.264/AAC, 3,467 giây, FFmpeg full decode exit 0. Giọng đọc là Piper thật đã tạo ở đợt trước, không tổng hợp lại hoặc dùng tone giả. |
| Ghép lại dubbing | **UI / Real Runtime PASS.** Dùng audio Piper thật đã có, thao tác ở Xuất video → Lồng tiếng; tạo output mới 640×360 H.264/AAC, 3,520 giây. Hoàn thành khoảng 1,378 giây trên mẫu ngắn. |
| Dubbing → hardsub | **UI / Real Runtime PASS.** Tạo output mới 640×360 H.264/AAC, 3,529 giây; khoảng 0,971 giây trên mẫu ngắn. Tiến độ task nhận qua IPC không lùi; chỉ done mới đạt 100. Giữ riêng đường dẫn dubbed. |
| Kiểm định media sau render | **UI / Real Runtime PASS.** FFprobe và FFmpeg decode thành công, báo cáo xuất cuối hiển thị trong UI. OCR lấy mẫu báo `unavailable` do chưa có dữ liệu Trung/Anh cần cho chức năng này; không tự tải model. Không đánh đồng decoder PASS với OCR/watermark PASS. |
| Hủy kiểm định → chạy lại | **UI / Real Runtime PASS.** Hủy từ nút Hủy kiểm tra; output hoàn thành và báo cáo cũ giữ nguyên. Chạy lại thành công tạo báo cáo mới, hash output không đổi. |
| Đóng → mở lại | **UI / Real Runtime PASS, normal restart.** Episode mới, media, output, giọng/endpoint và task được giữ. Mở lại đúng episode thủ công, preview giải mã được, nút xuất thủ công còn hoạt động. Không phải crash recovery giữa inference. |
| Bảo toàn dữ liệu | Các output hoàn thành trước đợt này được đối chiếu hash và giữ nguyên; các lần chạy mới dùng tên mới. Sau đóng app bình thường: 0 process VANHSUB/FFmpeg/FFprobe/Whisper tại lần lấy mẫu. Piper là service local độc lập, không phải worker orphan của Electron. |

Các artifact mới gồm `sample_dubbed_mono_2.mp4`, `sample.hardsub_1.mp4`, audio `narration.mp3` và `assets/final_video_*.mp4` trong episode mới của project QA. Đường dẫn đầy đủ, định danh và ảnh UI chỉ giữ trong evidence local; không đưa runtime metadata riêng tư lên GitHub.

## Automated và build

Kiểm thử liên quan PASS: 16 trường hợp media inspection/download/render với fixture local, kiểm thử render tĩnh UI inspection, validator IPC (bao gồm default export null và payload sai). Assertion tiến độ áp dụng cả softsub, hardsub và dubbing. Đây là Automated PASS, không phải tải Douyin live hoặc provider live.

Main/renderer TypeScript PASS. Renderer production build 27,592 s; main webpack 29,132 s; Electron unpacked packaging 94,593 s, đều exit 0. 530 file source/build khớp manifest, 8 file Extension đóng gói khớp source, giữ phiên bản 1.0.9. Không rebuild Whisper, NSIS hoặc chạy lại full suite. Không có nghiệm thu Windows sạch trong đợt này.

Đã khởi chạy lại bằng launcher Beta bình thường, không mở CDP debug 9334: 4 process Electron, 1 cửa sổ, 0 worker FFmpeg/FFprobe/Whisper. Sáu mẫu idle trong khoảng 10,13 giây: tổng working set khoảng 478–487 MiB, private memory 296–305 MiB; tổng CPU time tăng 0,0625 giây; tổng kernel handles 2319–2323. Piper health báo active=0. Đây là mẫu ngắn sau startup, không phải soak dài hạn hoặc đo peak; HandleCount không riêng file handles.

## Trạng thái và việc còn mở

**INTERNAL BETA: CONDITIONALLY READY** cho các workflow local đã xác minh: phụ đề đã hiệu đính → Piper → dubbing/export; Studio SRT/audio + media thủ công → preview/render/reopen. Gate chọn file native trước đây đã đóng bằng kiểm thử thật sau bản vá. ASR/OCR giữ kết quả runtime PASS trước đó, vẫn cần người đọc sửa nội dung; không chạy lại vì code liên quan không đổi.

**PUBLIC RELEASE: NOT READY.** Còn các gate clean Windows/NSIS hiện hành, provider live, crash recovery và soak dài hạn/security đã ghi trong RC. Phép lấy mẫu process sau đóng app không chứng minh đã loại hết memory leak.

- Translation: **BLOCKED_NO_KEY**, không có bằng chứng dịch provider mới. Có thể dùng SRT đã dịch/hiệu đính hợp lệ.
- Piper local: giữ **Real Local Provider PASS** trước đó; đợt này dùng artifact audio thật cho các bài tích hợp. Người dùng còn cần nghe đánh giá độ tự nhiên và phát âm.
- Edge TTS: lỗi 403 trước đó chưa được đóng; VietTTS chưa triển khai. Không vượt quyền hoặc đổi handshake để né lỗi.
- Google Flow: **BLOCKED**, không gửi thêm generation RPC sau unusual activity; ảnh nhập tay không được gắn nhãn tự động thành công.
- Official Gemini Image/Veo: adapter/contract đã có, **Live NOT TESTED / BLOCKED_NO_KEY_QUOTA**. Không phát sinh generation trả phí mới.
- CDP timeout trên context có target cũ: chưa có bằng chứng đóng blocker; không đóng tab cá nhân hoặc đổi bảo mật Chrome.
- Chưa chứng minh toàn workflow có dịch/AI generation hoặc Workflow AI tự động hoàn chỉnh. Không đề xuất merge main hoặc phát hành chỉ từ phạm vi local này.

Không còn yêu cầu người dùng mở hộp thoại/cài lại/pairing để hoàn tất bài nhập media local này. Can thiệp tiếp theo chỉ cần nếu muốn cung cấp quyền provider hợp lệ, nghe đánh giá giọng, hoặc bố trí môi trường nghiệm thu phát hành. Các evidence thô nằm local tại `docs/internal-beta-evidence/2026-10-20/completion/`, không commit/push.
