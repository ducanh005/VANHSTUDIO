# VANHSUB — Hướng dẫn nghiệm thu sử dụng thực tế

Cập nhật: 16/10/2026. Nhánh: `codex/integration-stabilization-20261015`. Bản app đang dùng chứa code 884591d; các commit sau đó là hướng dẫn/harness/báo cáo. Đây là Internal Beta trên máy Windows hiện tại, chưa phải bản phát hành công khai.

## 1. Phiên đã chuẩn bị cho bạn

Cửa sổ **VANHSUB — Studio Phụ Đề & Lồng Tiếng AI** đã được mở từ bản Electron tích hợp. Chỉ giữ một cửa sổ/phiên VANHSUB sử dụng cùng thư mục dữ liệu. Nếu cửa sổ còn mở, không chạy shortcut lần nữa. Nếu có màn hình giới thiệu, hoàn tất hoặc bỏ qua theo lựa chọn có sẵn trước khi mở phần Kết nối Chrome.

Thư mục riêng của đợt Beta:

```text
C:\Users\MTLS\AppData\Local\VANHSUB-InternalBeta-20261016
```

Trong thư mục có:

- `1 - Mo VANHSUB Beta.cmd`: dùng mở lại sau khi đã thoát app.
- `2 - Mo Chrome Flow Test.cmd`: mở Chrome với profile test riêng và cổng 9224.
- `Flow Bridge 1.0.8`: Extension được chép nguyên từ bản đóng gói, đã đối chiếu hash.
- `User Data`, `Settings`, `Tasks`, `AI Studio`, `Bible`: dữ liệu riêng của Beta.
- `Projects`: nơi đề nghị lưu các dự án thử nghiệm.
- `Chrome Flow Profile`: profile trình duyệt test; không phải profile Chrome cá nhân.

Chưa chép dự án, API key, cookie hoặc cấu hình cũ sang đây. Các chức năng cần provider phải được cấu hình hợp lệ trong giao diện; chưa có key/session thì ghi **CHƯA KIỂM THỬ**, không chọn Mock/Simulation để thay cho provider thật. Không cần cài bộ NSIS hoặc Windows VM để tham gia đợt Internal Beta này. App hiện chạy từ thư mục build riêng, chưa cài vào Program Files; giữ nguyên thư mục build. Nếu cần build/cập nhật tiếp, thoát app trước. Dữ liệu Beta được lưu riêng tại LocalAppData như trên.

## 2. Việc bạn cần làm ngay: Chrome → Extension → đăng nhập → ghép đôi

1. Mở thư mục Beta trên, chạy `2 - Mo Chrome Flow Test.cmd`. Chỉ dùng cửa sổ Chrome vừa mở cho đợt test. Shortcut sử dụng profile riêng, CDP 9224, không thêm cờ né anti-bot.
2. Trong cửa sổ đó, mở `chrome://version`. Kiểm tra **Profile Path** nằm trong `VANHSUB-InternalBeta-20261016\Chrome Flow Profile` (thường có thư mục con `Default`). Nếu thấy đường dẫn profile cá nhân, dừng lại. Không gửi nội dung cookie hoặc trang tài khoản.
3. Mở `chrome://extensions`, bật **Developer mode / Chế độ dành cho nhà phát triển**, chọn **Load unpacked / Tải tiện ích đã giải nén**, chọn thư mục dưới đây. Kiểm tra tên **VanhSub Flow Bridge**, phiên bản **1.0.8**. Nếu đã có bản test cũ, tải lại đúng bản rồi tải lại trang Flow. Cách nạp/reload này theo [hướng dẫn Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-an-unpacked-extension).

```text
C:\Users\MTLS\AppData\Local\VANHSUB-InternalBeta-20261016\Flow Bridge 1.0.8
```

4. Mở [Google Flow](https://labs.google/fx/tools/flow) trong chính cửa sổ test; tự đăng nhập tài khoản có quyền truy cập và credits. Hoàn tất xác minh trực tiếp nếu Google yêu cầu. Không cần bật đồng bộ Chrome hoặc chép cookie. Nếu bị chặn tài khoản/CAPTCHA/anti-bot, dừng và báo nguyên thông báo đã che thông tin riêng tư.
5. Quay lại VANHSUB, bấm **Kết Nối Chrome (Khuyên Dùng)** → **Tạo mã ghép đôi**. Sao chép mã; mã chỉ có hạn 2 phút và dùng một lần.
6. Trong Chrome test, mở biểu tượng **VanhSub Flow Bridge**, dán mã, bấm **Ghép đôi**. Chờ popup báo **Đã ghép đôi và xác thực với VANHSUB.** Trong app, bấm **Kiểm tra lại kết nối** và đối chiếu thông báo Extension đã xác thực. Không gửi mã/token vào chat hoặc log.
7. Giữ cả app và Chrome test mở. Nhắn: **“Đã mở Flow test, Extension 1.0.8 đã ghép đôi”**, hoặc báo chính xác bước đang bị lỗi. **Dừng tại đây để tôi kiểm tra CDP/profile/pairing thật trước khi generation.**

Hiện các nút **Mở Google Flow trên Chrome** và **Mở Trang chrome://extensions** trong app chưa truyền profile test vào lệnh mở Chrome. Trong đợt nghiệm thu, dùng shortcut 2 và tự nhập địa chỉ trong cửa sổ test. Không dùng các nút đó để chọn profile.

Chrome yêu cầu thư mục dữ liệu riêng khi dùng remote debugging với profile thông thường; đây cũng là lý do không gắn cổng test vào Chrome cá nhân. [Tài liệu Chrome về remote debugging](https://developer.chrome.com/blog/remote-debugging-port).

Nếu ghép đôi lại: tải lại đúng Extension, mở lại popup, tạo mã mới rồi ghép đôi. Chỉ chọn **Thu hồi ghép đôi** khi muốn vô hiệu kết nối đang dùng. Trạng thái bridge đã kết nối chưa chứng minh Flow đã đăng nhập, có credits hoặc tạo media thành công. Extension không bảo đảm loại bỏ mọi chặn bot của Google.

## 3. Bài nghiệm thu ảnh/video sau khi thiết lập xong

Không cần thực hiện phần này ngay. Tôi sẽ kiểm tra kết nối trước, rồi điều khiển đúng dự án/tab test. Bạn chỉ cần thao tác thêm nếu Google yêu cầu đăng nhập/xác minh hoặc cần cấu hình provider thuộc tài khoản của bạn.

- Tạo một dự án mới, tên `BETA-FLOW-20261016`, thư mục nằm trong `Projects` của Beta. Dùng một scene và batch/output count 1. Chọn engine **Google Flow**, không dùng **Synthetic Studio Mock** hoặc **Simulation**.
- Nếu cần sinh script/storyboard, cấu hình LLM hợp lệ trong AI Studio trước. Không có key/provider hợp lệ thì dừng ở bước đó; không coi storyboard giả lập là nghiệm thu thật.
- Ghi credits và lựa chọn model trước/sau từng bài. Khởi đầu tối đa ba generation được Google tiếp nhận: một T2I, một T2V và một I2V; ưu tiên lựa chọn Fast/Lite thực sự được tài khoản cung cấp. Không tự chuyển sang model đắt hơn, không chạy batch lớn. Không retry khi chưa rõ request trước đã được Google nhận hay chưa; gặp chặn thì dừng.

**T2I — một ảnh thật:** Trong storyboard, chọn đúng scene, dùng prompt đơn giản như “Một chiếc cốc gốm xanh trên bàn gỗ, ánh sáng cửa sổ, không chữ”. Nút của scene là **Tạo lại Ảnh**. Chờ hoàn tất, mở preview và thư mục output. PASS cần có request/output mới từ Flow, file ảnh tải về đọc được và scene trỏ đúng file đó; ảnh cũ giữ lại hoặc file mock không được tính.

**T2V — một video từ chữ:** Dùng đường Workflow AI có node **Google Flow / Veo Video**, chỉ truyền prompt, không truyền **Khung hình đầu (Init Frame)** hoặc ảnh tham chiếu. Ví dụ: “Máy quay di chuyển chậm quanh một chiếc cốc gốm xanh trên bàn gỗ”. Phải xác minh app thực sự gửi yêu cầu T2V qua phiên Flow test. Không đếm nút **Tạo lại Video** trong storyboard là T2V: luồng đó có thể sinh/dùng keyframe rồi chạy I2V. Nếu route/provider không cho chọn đúng T2V, ghi NOT TESTED/BLOCKED và báo rõ, không thay bằng I2V.

**I2V — một video từ đúng ảnh:** Chọn một ảnh dễ nhận biết, ghi tên/đường dẫn, gán vào scene bằng **Chọn ảnh** rồi dùng **Tạo lại Video**. Tôi sẽ đối chiếu hash file/asset identity, request, project và scene. PASS cần đúng ảnh đầu vào được gửi và video mới giải mã được. Chỉ nhìn clip giống ảnh hoặc nhận một ảnh động Ken Burns chưa đủ chứng minh I2V/provenance.

Để kiểm tra không chạm tab thủ công, tôi sẽ dùng một tab đối chiếu riêng trong Chrome test. Không dùng dữ liệu/tab cá nhân làm vật thử. PASS cần tab đối chiếu giữ nguyên và generation nằm trong tab/project mà job sở hữu.

Nếu có `TIMEOUT_WAITING_RPC`: giữ lại thời điểm, scene/job và trạng thái thực tế trong Flow; không bấm tạo lại liên tục. Có file video không tự chứng minh logic chờ đã đúng. Cần đối chiếu request, response/completion và file tải về mới kết luận. Google báo chặn thì ghi **BLOCKED**, không vòng qua CAPTCHA/anti-bot.

## 4. Kiểm tra thư mục output

1. Trong dự án/scene, dùng nút mở thư mục nếu có; đối chiếu với đường dẫn output bạn đã chọn khi tạo dự án.
2. AI Studio thường lưu workspace có `01_script`, `02_voice`, `05_media`, `style_refs`; nếu đã chọn thư mục media riêng thì kiểm tra thư mục đó. Không suy đường dẫn chỉ từ tên project.
3. Kiểm tra file có dung lượng lớn hơn 0, mở được, đúng scene và mới tạo trong lần chạy này. Video cần có thời lượng hợp lệ, có hình chuyển động và giải mã được bằng FFmpeg/FFprobe; tôi sẽ thực hiện phần kiểm định kỹ thuật này khi chạy live.
4. Đóng/mở lại dự án: preview vẫn trỏ đúng output; không nhặt media của scene/project khác.

## 5. Video → ASR/OCR → SRT

1. Dùng bản sao video thử ngắn 10–30 giây, lưu trong một thư mục project mới. Video có giọng rõ để kiểm ASR; video có phụ đề cứng rõ để kiểm OCR. Video chỉ có tiếng beep không chứng minh nhận diện giọng nói.
2. Vào **Phụ đề & ASR**, thêm video bằng trình chọn file. Chọn đúng task và ngôn ngữ. Với Whisper.cpp, cần model đã tải; Faster-Whisper/OCR cần Python, package và model phù hợp trên máy.
3. Chạy phiên âm hoặc OCR, theo dõi tiến trình đến kết quả cuối. Nếu thiếu model/provider thì ghi BLOCKED, không đổi tên file trống thành output để vượt bước.
4. Vào **Hiệu đính phụ đề**, kiểm nội dung/timing, sửa một dòng, lưu, đóng/mở lại. Mở file SRT từ output để đối chiếu.
5. Trên bản sao project, thử hủy một job rồi chạy lại. File đã hoàn thành trước đó phải còn nguyên. Lỗi hoặc job chưa kết thúc không được tính PASS.

## 6. SRT → dịch → TTS → lồng tiếng → xuất video

1. Chọn một SRT ngắn 2–3 dòng. Trong **Cài đặt**, nhập key/provider hợp lệ trực tiếp vào app và lưu. Không gửi key cho tôi qua chat. Với TTS local, server phải thực sự đang chạy; với TTS online, dùng giọng/engine mà tài khoản truy cập được.
2. Dịch sang tiếng Việt. So sánh số dòng, ý nghĩa và mốc thời gian; giữ nguyên bản gốc. Có HTTP thành công nhưng nội dung rỗng/sai ngôn ngữ thì FAIL.
3. Vào **Lồng tiếng TTS**, chọn giọng, tạo audio, nghe thử. Kiểm câu bị thiếu, bị cắt đuôi, lệch khoảng nghỉ và đoạn dài hơn slot phụ đề. Có WAV/MP3 không chứng minh đọc đúng nội dung hoặc vừa timing.
4. Tạo bản lồng tiếng; kiểm giọng gốc được giữ/thay đúng lựa chọn. Nghe ít nhất đầu, giữa và cuối clip. Không dùng tone tổng hợp thay giọng nói thật để ghi TTS live PASS.
5. Vào **Xuất video**, chọn đúng task, nguồn video và hardsub/softsub, xuất ra tên mới. Mở file cuối, kiểm hình/tiếng/sub, thời lượng và lựa chọn độ phân giải. Đối với softsub, dùng player hỗ trợ track phụ đề.
6. Lưu project, đóng/mở app, kiểm đường dẫn và kết quả còn đúng. Không ghi PASS cho toàn pipeline nếu một bước vẫn cần mock hoặc chưa chạy provider thật.

## 7. AI Studio và Workflow AI

- AI Studio: dự án mới → LLM/script thật → giọng đọc → storyboard → từng media scene → export. Đối chiếu từng scene/narration và file cuối, không chỉ badge xanh. Chưa có LLM/TTS/Flow hợp lệ thì ghi bước còn thiếu.
- Workflow AI: tạo workflow nhỏ từ node có trong app, lưu tên riêng, chạy một lần, xem output từng node. Lưu lại, mở lại rồi xác minh node/config/kết quả.
- Resume: dùng project/workflow test có checkpoint thật, ghi job đang ở bước nào, đóng/mở rồi tiếp tục. Kiểm phần hoàn thành không bị chạy lại/gán nhầm output. Không xóa checkpoint hoặc “Chạy toàn bộ” để giả thành resume thành công.
- Các bước provider thật/AI Studio export/Workflow resume chưa được chứng minh chỉ từ unit test, fixture hoặc việc điều hướng được tới trang UI.

## 8. Thu thập thông tin khi lỗi

Mở **Terminal Log** ở đáy app, ghi lại thao tác vừa làm, thời điểm, tên project/scene/task và thông báo lỗi. Log của phiên Beta nằm tại:

```text
C:\Users\MTLS\AppData\Local\VANHSUB-InternalBeta-20261016\User Data\logs
```

Chọn file `vanhsub-YYYY-MM-DD.log` đúng thời điểm; ngày trong tên log dùng UTC nên có thể khác ngày Việt Nam quanh nửa đêm. Trên máy này, thường bạn chỉ cần báo thao tác và thời điểm; tôi có thể tự đọc log local. Chỉ gửi đoạn log/ảnh đã che thông tin riêng tư khi tôi không truy cập được môi trường. Không gửi cookie, Authorization header, API key, token pairing, file profile Chrome, HAR hoặc toàn bộ thư mục Settings. Log có redaction nhưng vẫn cần kiểm tra trước khi chia sẻ. Với lỗi Extension, trang `chrome://extensions` có mục lỗi/service worker; chỉ gửi phần thông báo cần thiết, không dump storage.

## 9. Khi nào ghi PASS/FAIL/BLOCKED?

| Trạng thái | Cách ghi |
|---|---|
| PASS | Bạn thực hiện đúng luồng, có output mới, kiểm nội dung/timing/đường dẫn và mở lại được; nêu app/model/provider đã dùng |
| FAIL | Tái hiện sai hành vi mong đợi: mất file, nhầm scene, job trùng, audio sai/cắt, output hỏng hoặc timeout khi job thực tế đã hoàn tất |
| BLOCKED | Thiếu quyền, đăng nhập, quota, model/provider, CAPTCHA hoặc Google chặn; nêu lý do, không đổi thành PASS |
| NOT TESTED | Chưa thực hiện; không suy từ test tự động hoặc chức năng gần giống |

Ghi riêng: **Automated Test**, **Real Runtime**, **UI E2E**, **Live Provider**. Một chức năng có thể có Automated PASS nhưng Live Provider NOT TESTED. Lưu tên/đường dẫn file và credits trước/sau để đối chiếu; không cần gửi secret.

## 10. Cập nhật từ bản cũ mà giữ dữ liệu

Phiên hiện tại dùng dữ liệu mới, chưa migrate dự án/cấu hình cũ. Để chuyển dần:

1. Hoàn tất/lưu job, thoát app cũ. Không chạy hai phiên cùng một thư mục dữ liệu hoặc chỉnh cùng một project song song.
2. Sao lưu toàn bộ thư mục user data cũ và các thư mục project/media thực tế nằm ngoài đó. Giữ nguyên bản gốc; backup chỉ JSON không bảo vệ video/audio nằm ở chỗ khác. Không xóa profile cũ, không reset settings.
3. Thử trước bằng **bản sao** video/SRT trong `Projects` của Beta, tạo task/project mới qua UI. Không chép tay `tasks.json`, catalog/checkpoint hoặc đổi ID để ép app nhận project: các file này có đường dẫn tuyệt đối, owner và revision.
4. Với project AI Studio/Workflow cũ, chỉ chuyển qua luồng mở/nhập mà UI hỗ trợ sau khi kiểm tra trên bản sao. Trước khi chạy, đối chiếu output thực tế phải thuộc bản sao, không trỏ về thư mục gốc. Nếu chưa xác minh được, giữ project đó ở bản cũ và báo để kiểm tra riêng.
5. Nhập lại key trực tiếp trong UI khi cần. Secret mã hóa gắn với tài khoản Windows; không bảo đảm chép sang máy/tài khoản khác sẽ giải mã được. Không sao chép Chrome profile/cookie để chuyển phiên Flow.
6. Giữ backup và bản cũ tới khi đã kiểm nội dung, timing, output và mở lại được. Nếu cần quay lại, đóng Beta và dùng dữ liệu cũ chưa sửa; đừng cho bản cũ đọc cấu hình mới đã migrate mà chưa thử tương thích.

Chuyển toàn bộ dự án cũ/downgrade chưa được chứng nhận chỉ từ các bài migration synthetic. Clean Windows, cài–gỡ NSIS, chữ ký và khả năng phân phối rộng vẫn là cổng riêng của Public Release.
