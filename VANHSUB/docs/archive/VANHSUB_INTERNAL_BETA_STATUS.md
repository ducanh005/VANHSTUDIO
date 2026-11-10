# VANHSUB — Internal Beta và Public Release

Ngày: 16/10/2026, Asia/Saigon. Nhánh: `codex/integration-stabilization-20261015`. App thực tế chứa code 884591d, repository bắt đầu phiên này ở ab790d4. Không thay code ứng dụng, không chạy lại bộ 46 suite/build/20 smoke đã PASS, không tạo thêm test để tăng số lượng. Các bằng chứng cũ giữ nguyên phạm vi.

## A. INTERNAL BETA: CONDITIONALLY READY

Chỉ áp dụng cho sử dụng thử có kiểm soát trên máy Windows hiện tại, với project mới hoặc bản sao, từng job ngắn và một instance dùng một thư mục dữ liệu. **Chưa phải nghiệm thu toàn bộ Flow/provider/workflow thực tế.** Windows VM sạch không phải điều kiện bắt buộc của kết luận này.

| Nhóm chức năng | Có thể dùng/điều kiện | Bằng chứng và giới hạn |
|---|---|---|
| Khởi chạy bản tích hợp | Đã mở cửa sổ Beta thật, để nguyên chờ thao tác của người dùng | Main PID 9044, 4 process Electron, window title và bridge listeners 127.0.0.1:9222/8765 được quan sát; không suy thành pairing/provider PASS |
| Import SRT, hiệu đính, lưu/mở, export local | Có thể bắt đầu trên media/project thử | Cùng code đã có UI/runtime và FFmpeg output evidence; setup một số task trước đây qua IPC, chưa chứng nhận mọi bước file picker/form |
| ASR | Có điều kiện engine/model và cache hợp lệ | Whisper.cpp đã nhận diện mẫu speech thật trong profile kiểm thử riêng; chưa xác nhận cache/model đã được thiết lập trong phiên Beta mới |
| OCR | Có điều kiện Python/package/model phù hợp | Cùng code 884591d đã có 5 ca runtime, nhận chữ Latin thật từ cached model; chưa chứng nhận mọi ngôn ngữ, dual-engine, media dài và sidecar shutdown |
| Dịch/TTS/lồng tiếng | Chờ provider được cấu hình và bài dùng thật | Local HTTP/tone/cancel/checkpoint/native audio tests trước đây không phải live-provider hoặc nghe kiểm tra chất lượng |
| AI Studio full pipeline | Chưa nghiệm thu đầy đủ | Script/voice/storyboard/Flow/export cần LLM/TTS/session hợp lệ và output thật |
| Workflow AI full execution/save/resume | Chưa nghiệm thu đầy đủ | Source/offline/checkpoint protections có bằng chứng; không thay thế full UI/provider workflow trên máy đang dùng |
| Google Flow | WAITING FOR USER, chưa cho điểm Live PASS | Chưa có Chrome profile test hoạt động/CDP 9224; chưa nạp Extension thật hoặc đăng nhập trong profile mới |

Các điều kiện/rủi ro còn lại:

- Lỗi P1OCR đã được sửa và push ở 884591d: giữ file/tham chiếu tốt khi fail/cancel, dọn khung, invalidate đúng sau success. Không có lỗi mất dữ liệu mới nào được tái hiện trong phiên chuẩn bị này; điều đó không chứng minh mọi đường recovery an toàn.
- Catalog và checkpoint là hai file atomic riêng, chưa chung transaction; còn khoảng trống interrupted-write/reconcile/all-job crash. Dùng bản sao và lưu/backup trước job dài.
- Chuyển project/config cũ đầy đủ, rollback/downgrade, legacy episode secret/corrupt config chưa được chứng nhận. Phiên Beta mới không sao chép hay ghi đè các dữ liệu cũ.
- Hai nút mở Chrome/extensions trong app chưa truyền profile test. Cách vận hành hiện tại là shortcut profile riêng; tránh hai nút đó trong nghiệm thu. Đây là hạn chế xác minh từ source, không phải Live PASS cho profile/tab isolation.
- Hướng dẫn Extension cũ có câu quảng bá “loại bỏ hoàn toàn” chặn bot; không dùng lời đó làm cam kết. Hướng dẫn mới yêu cầu dừng khi Google chặn.
- Không chạy hai instance cùng một user-data/project. Khả năng chạy hai task đã được kiểm thử trước đây không chứng minh nhiều instance ghi chung dữ liệu an toàn.

## B. PUBLIC RELEASE: NOT READY

Giữ các cổng riêng: clean Windows install/uninstall/upgrade/ACL/native prerequisites vẫn BLOCKED; NSIS chưa ký; Google Flow/live translation/TTS/full Studio/workflow chưa nghiệm thu; toolchain còn 8 High/8 Moderate từ scan 16/10, native FFmpeg/FFprobe có tuổi đời cũ và không nằm trong npm audit; cần bổ sung stability/soak/migration/security acceptance đã ghi trong báo cáo RC. Không đề xuất merge main hoặc phát hành.

## Google Flow: trạng thái 10 mục ưu tiên

| Mục | Trạng thái hiện tại |
|---|---|
| Extension 1.0.8 bản tích hợp | Packaged files/hash/manifest VERIFIED; nạp vào Chrome thật CHƯA KIỂM THỬ |
| Pairing protocol 2 với Extension thật | NOT TESTED; listener mở chưa phải authentication PASS |
| Playwright CDP đúng profile test | NOT TESTED; 9224 chưa mở. Shortcut dùng custom profile và FLOW_PROFILE_DIR khớp app |
| Không can thiệp tab thủ công | NOT TESTED live; sẽ dùng tab đối chiếu trong profile test, không dùng tab cá nhân |
| T2I ảnh thật/download/validation | NOT TESTED |
| T2V video thật/download/validation | NOT TESTED; phải phân biệt route T2V với storyboard tự sinh keyframe/I2V |
| I2V đúng keyframe | NOT TESTED; cần file hash/asset/request/scene correlation |
| Đúng project/scene/output | NOT TESTED cho generation live |
| Không TIMEOUT_WAITING_RPC do chờ sai | NOT TESTED live; không suy từ unit hoặc synthetic peer |
| Dừng đúng khi Google chặn | NOT TESTED live; không cố gây/bypass CAPTCHA để lấy PASS |

Generation/credits đã dùng trong phiên này: 0/0. Khi session hợp lệ, dự kiến ban đầu một T2I, một T2V và một I2V, output count 1; ghi credits trước/sau và dừng khi Google chặn hoặc request trước chưa rõ trạng thái. Không yêu cầu xác nhận lại từng generation trong phạm vi người dùng đã cho phép.

## Đã làm và điểm dừng

- Chuẩn bị `C:\Users\MTLS\AppData\Local\VANHSUB-InternalBeta-20261016`, dữ liệu/Chrome profile riêng và hai shortcut. Chép nguyên 8 file Extension từ artifact, đối chiếu hash và manifest 1.0.8; không sao chép credential/cookie.
- Direct launch đầu tiên không còn process ở thời điểm kiểm tra; chưa xác định nguyên nhân, không kết luận là lỗi app. Lần launch môi trường sạch NODE_OPTIONS/ELECTRON_RUN_AS_NODE đã mở cửa sổ thật và listener cùng PID 9044. Không vá binary để làm bài kiểm tra xanh.
- Để app mở chờ người dùng. Chưa mở Chrome, cài Extension, đăng nhập hoặc gửi provider request thay người dùng.
- Cần người dùng mở shortcut Chrome test, nạp Extension 1.0.8, đăng nhập Flow và ghép đôi. Dừng tại ranh giới quyền/môi trường này; sau đó mới thực hiện UI/live acceptance. Hướng dẫn đầy đủ:[VANHSUB_USER_ACCEPTANCE_GUIDE.md](VANHSUB_USER_ACCEPTANCE_GUIDE.md).

Evidence mới:[session preparation](internal-beta-evidence/2026-10-16/session-preparation.json), [actual runtime observation](internal-beta-evidence/2026-10-16/runtime-preparation.json). Các bằng chứng chức năng trước đó:[RC acceptance](CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md). Không ghi mock thành Live PASS; không thêm regression/build lặp lại khi code chưa đổi.
