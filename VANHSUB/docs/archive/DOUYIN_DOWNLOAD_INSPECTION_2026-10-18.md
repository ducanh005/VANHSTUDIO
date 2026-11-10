# Nâng cấp tải Douyin và kiểm tra media — 18/10/2026

Phạm vi đã triển khai: mục 1–4 theo yêu cầu; không bổ sung quản lý giấy phép/quyền sử dụng.

## Hành vi

- Luồng tải Douyin chuẩn hóa URL `/playwm/` sang `/play/`, loại URL có cờ watermark rõ ràng và chặn redirect sang endpoint có watermark. Không fallback về URL watermark gốc. Việc chọn endpoint không chứng minh hình ảnh sạch logo.
- Bật mặc định tùy chọn tạo bản `_edit` riêng cho Douyin. Giữ nguyên file tải gốc, không ghi đè dự án/bản biên tập cũ.
- Remux bằng stream copy, loại có chọn lọc `comment=vid:...` và trường `information` ByteDance rỗng. Giữ tên tác giả, copyright và thông tin nguồn/AI có nội dung. Báo cáo chỉ liệt kê các trường thực tế đã kiểm tra; không khẳng định xóa mọi ID hay watermark ẩn.
- FFprobe đọc thông số và metadata trước/sau; FFmpeg giải mã toàn bộ file. Lỗi media ngăn trạng thái hoàn tất. Nếu kiểm tra tải thất bại, thông báo kèm đường dẫn bản tải gốc.
- Lấy tối đa 24 khung hình phân bố từ đầu đến gần cuối, OCR Trung/Anh bằng dữ liệu Tesseract đã cài trong `userData/tessdata`. Thiếu model/timeout/lỗi OCR được báo rõ, vẫn giữ khung hình để xem thủ công. Logo đồ họa cần xem bằng mắt; OCR chỉ đánh dấu chữ/ID và tên logo nghi vấn.
- Báo cáo lưu JSON và ảnh trong thư mục `media-check-*` cạnh video; khi kiểm tra lại tác vụ, lưu trong thư mục dự án đã cấp quyền; nguồn URL lưu cục bộ trong báo cáo.
- Giao diện tải hiển thị kết quả độc lập cho tải file, metadata và hình ảnh. Có ảnh theo thời điểm và chữ OCR, không còn lời bảo đảm “Không watermark ✓” cho Douyin.
- Tác vụ lưu báo cáo, đường dẫn gốc và lựa chọn làm sạch. Xuất hardsub, softsub và lồng tiếng đều kiểm tra file cuối trước khi `done`. Tab Xuất video có báo cáo và nút kiểm tra lại đầu vào/đầu ra, hỗ trợ hủy.
- Hủy trong các bước FFprobe/FFmpeg/OCR không được chuyển thành hoàn tất. Chỉ xóa bản biên tập đang tạo của lượt kiểm tra bị lỗi/hủy; giữ nguyên đầu vào.

## Kiểm thử

Chạy `npm run test:downloader`. Đặt `VANHSUB_TEST_OCR_CACHE` tới thư mục đã có `chi_sim.traineddata` để chạy thêm bài OCR thực, không tải model trong test.

Bộ kiểm thử dùng FFmpeg thật, máy chủ HTTP nội bộ với lỗi/redirect có kiểm soát, xuất hardsub/softsub/lồng tiếng thật, xác minh hash bản gốc và decoded frame/audio hashes. Kiểm tra renderer bằng React server rendering và IPC giả lập để xác minh trạng thái/nhãn; chưa thay thế kiểm tra tương tác toàn cửa sổ Electron.

Mẫu thực tế: video Douyin `7694614404276428264` đã tải ở lượt kiểm tra trước. Chạy bộ xử lý mới trên file đó xác nhận bỏ hai trường metadata kỹ thuật, giữ nguyên SHA-256 bản gốc, giải mã thành công, OCR đủ 24 khung và đưa về trạng thái cần xem lại. Bằng chứng trong `audit-output/douyin-7694614404276428264/update-result.json`.

## Giới hạn

Không có điểm “an toàn bản quyền”, không truy cập cơ sở dữ liệu Content ID, không khẳng định làm sạch metadata giúp tránh nhận diện. OCR lấy mẫu có thể bỏ sót/nhận nhầm chữ và không phát hiện mọi logo đồ họa. Khi thiếu dữ liệu OCR Trung/Anh, chạy OCR tiếng Trung trong app để cài dữ liệu, sau đó bấm kiểm tra lại.

Thay đổi nằm trong mã nguồn. Cần khởi động lại phiên phát triển để nạp main/preload mới; bản cài đặt đóng gói cần được build/cài lại. Chưa tạo bộ cài mới trong lượt cập nhật này.

## Tích hợp main — 19/10/2026

Áp dụng riêng thay đổi Douyin lên main ae2d09a, giữ các cập nhật dependency và bảo vệ hiện có. Các IPC kiểm tra/hủy dùng handleRendererIpc và kiểm tra payload; kiểm tra media dùng khóa tác vụ chung và hỗ trợ hủy tác vụ. Thư mục tải vẫn được cấp nguyên tử để tránh trùng dự án. dubbedVideoPath trỏ tới đúng bản đã kiểm tra để lần xuất phụ đề tiếp theo giữ âm thanh lồng tiếng.

Đã chạy trên bản tích hợp với dependency theo lockfile main:
- TypeScript main và renderer: đạt.
- test:downloader: 17 bài FFmpeg/HTTP/OCR thật và 2 nhóm kiểm tra renderer/IPC giả lập đạt; kiểm tra ảnh báo cáo trong thư mục dự án được cấp quyền.
- Hồi quy main: test_rc_ipc_payload, test_rc_media_capabilities, test_task_operation_exclusion, test_standard_project_directory_isolation, test_dubbed_subtitle_export, test_export_resolution_and_silent_softsub, test_shared_dubbing_preferences, test_merged_mp3_and_background_download đều đạt.

Chưa build bộ cài hoặc kiểm tra tương tác toàn cửa sổ Electron trong lượt tích hợp này.
