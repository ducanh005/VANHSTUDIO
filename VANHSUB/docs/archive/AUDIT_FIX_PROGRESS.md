# Tiến độ sửa lỗi từ audit VANHSUB

Cập nhật: 14/10/2026 (Asia/Saigon). Phạm vi: luồng nhập media, ASR/OCR, dịch/hiệu đính, TTS, ghép lồng tiếng, xuất và settings. Không sửa các module riêng của AI Studio/Workflow AI.

## Các đợt đã commit và push main

| Đợt | Commit | Nội dung |
|---|---|---|
| 1 | de1fce8 | Áp dụng độ phân giải xuất; Softsub cho video không audio |
| 2 | c090454 | Cấp thư mục riêng cho task/tải video trùng tên |
| 3 | 7907511 | Giữ nguồn video đã lồng tiếng và hai track song ngữ khi xuất |
| 4 | 9dc5c36 | Đồng bộ video, audio và phụ đề khi kéo giãn; mix tương thích FFmpeg đóng gói |
| 5 | 44df0f3 | Tạo lại nhóm câu, đo thời lượng, làm mới MP3, giữ gán giọng |
| 6 | 466d434 | Default ASR/TTS, ghép đúng voice/provider, cập nhật session khi quay lại tab |
| 7 | de2cd90 | Vô hiệu hóa dữ liệu phụ thuộc khi nhập/sửa SRT; refresh preview/style theo task |
| 8 | aed8c03 | Khóa thao tác IPC cho task chạy/chờ; giữ khóa đến khi hủy thực sự kết thúc |
| 9 | 90aa0ef | Đồng bộ settings giữa tab; bỏ tùy chọn và nhãn UI không đúng hành vi |
| 10 | 0166297 | Dùng chung cấu hình ghép lồng tiếng theo task; pipeline đọc cấu hình này |
| 11 | 59ef0f7 | Chặn ghi/xóa dữ liệu legacy bị chia sẻ giữa nhiều task |
| 12 | 13c994c | Rút gọn lời TTS phải bật riêng; không reuse cache đã rút gọn khi tắt; default ASR cho task cũ |

Đợt hoàn tất dọn preset style không sử dụng, khóa nút đổi provider khi đang xử lý và đặt lại gán giọng UI khi chuyển provider. Việc gán giọng lưu trong task chỉ được thay khi người dùng chạy tạo/tạo lại TTS.

## Đối chiếu 14 phát hiện chính

| Mục audit | Xử lý |
|---|---|
| 1. Xuất phụ đề mất TTS | Lưu `dubbedVideoPath`, chọn nguồn tự động/original/dubbed |
| 2. Kéo giãn sai timeline | Đọc nội dung SRT, tính theo nhóm, lưu factor, scale audio nền và subtitle export/preview |
| 3. Tạo lại dòng làm hỏng nhóm | Dùng lại luồng timing/cache đầy đủ, split/rejoin theo gán giọng, ghép lại MP3 |
| 4. Video trùng tên dùng chung folder | Task mới được cấp folder độc lập; dữ liệu legacy mơ hồ bị chặn xử lý |
| 5. Runner xung đột trên cùng task | Khóa tại các IPC khởi chạy, giữ trong hàng đợi và đến khi kết thúc/hủy |
| 6. Resolution không có hiệu lực | Scale frame đã compositing theo short edge 480/720/1080 |
| 7. Flexible không đúng mô tả | Gỡ khỏi UI; backend giữ tương thích cũ với timeline cố định |
| 8. ASR default bị ghi thành base | Task mới snapshot Settings; caller override được ưu tiên |
| 9. Voice và engine không khớp | Voice/provider pairing thống nhất; session không tự đổi provider |
| 10. Session TikTok stale | Refresh khi mở tab và kiểm tra lại trước tạo audio |
| 11. Gán giọng bị mất khi chạy lại | Khôi phục từ task ngay khi đổi task; UI gửi assignments khi regenerate |
| 12. Style/preview lệch giữa task | Reset style từng dòng theo task/revision, đọc lại SRT theo revision |
| 13. SRT mới vẫn dùng dịch/TTS cũ | Clear bản dịch khi original đổi, đánh dấu TTS cần regenerate, giữ cache |
| 14. Softsub không audio thất bại | Audio stream mapping là optional |

## Kiểm tra đạt

- TypeScript: root và renderer, không emit/incremental.
- Lượt hồi quy chung: **15/15 suite đạt**, gồm 10 suite mới và 5 suite có sẵn.
- Các suite mới: export resolution/silent Softsub; project directory isolation; dubbed subtitle export; video stretch timeline; TTS group regeneration; task configuration defaults; subtitle artifact invalidation; task operation exclusion; shared dubbing preferences; legacy collision guard.
- Các suite có sẵn: pipeline timing regressions; TTS timing adaptation; CapCut Mini export (68/68 assertions); subtitle sanitizer (13/13); hybrid fusion (11/11).
- Audio/video xuất dùng FFmpeg thật và fixture tổng hợp. Kiểm tra track, thời lượng, onset, âm lượng/tần số và thời điểm chữ xuất hiện trên frame.
- Test TTS regeneration thay riêng provider mạng bằng audio tổng hợp; timing/cache/manifest/merge là code thật.

## Giới hạn còn lại

- Chưa nghiệm thu trực quan toàn bộ app Electron hoặc build bộ cài phát hành.
- Chưa chạy TTS/dịch qua dịch vụ thật, ASR/OCR bằng model thật hoặc Demucs thật trong lượt nghiệm thu cuối.
- Sync theo nhóm câu chưa phải forced alignment từng từ vào từng block phụ đề nhỏ.
- Dữ liệu legacy đã bị ghi đè không thể tự phục hồi. Không tự di chuyển hoặc xóa dữ liệu mơ hồ: app báo task xung đột, người dùng có thể tạo task mới/nhập lại SRT hoặc gỡ record trùng (gỡ task không xóa media).
- Bản lồng tiếng cũ cần ghép lại để có đường dẫn/factor riêng trong metadata mới.
- Các fix đã push là mã nguồn; chưa xác nhận app/bộ cài đang mở trên máy đã cập nhật tới commit này.
