# VANHSUB — Rà soát tiếp luồng TTS và xuất video, 20/10/2026

Tiếp nối worktree audit ở `3d0948e`, trên nhánh local `codex/worktree-merge-audit-20261020`. Bản sửa mã nguồn: **`80d19c0`**. Không audit lại toàn bộ ứng dụng, không retry Flow RPC, không gọi provider trả phí, không push/merge main hoặc thay bản Beta đang chạy.

## Hai lỗi P1 đã tái hiện và sửa

### 1. Tạo lại TTS thất bại sau nhóm đầu có thể sửa kết quả đã hoàn thành

`TTSRunner.regenerateLine` trước đây chạy ngay trong `task.ttsAudioDir`. Nếu nhóm đầu tạo lại thành công nhưng nhóm sau không đạt timing, tác vụ báo lỗi trong khi MP3 master và manifest của lần hoàn thành trước đã bị ghi lại. Test trước sửa xác nhận hash thay đổi; đây không chỉ là nhận định từ source. Các bài cũ chỉ làm lỗi ở nhóm đầu nên chưa phát hiện trường hợp này.

Đã đổi sang run riêng, seed cache bằng bản sao độc lập, lưu snapshot SRT rồi tạo lại và ghép MP3 trong run mới. Chỉ một lần cập nhật task sau thành công mới chuyển audio directory, MP3, cấu hình giọng/tốc độ và timing report sang kết quả mới. Hủy/lỗi giữ nguyên pointer và bytes của run hoàn thành trước; `ttsNeedsRegeneration=true` tiếp tục chặn dùng audio cũ cho nội dung mới. Nếu SRT nguồn bị sửa bên ngoài giữa lúc chạy, từ chối publish kết quả của snapshot cũ.

Sau thành công, downstream video/inspection bị vô hiệu hóa đúng cách nhưng file cũ không bị xóa. Lần tạo lại thành công có MP3 nằm trong thư mục run riêng dưới project. Candidate của lần thất bại không được gắn vào task và được giữ local; chưa thêm cơ chế tự dọn lịch sử/cache.

### 2. Export có thể dùng dub cũ khi TTS đang stale

Export Auto hoặc chọn Video đã lồng tiếng trước đây không kiểm tra `ttsNeedsRegeneration`. Negative control chạy code baseline với media fixture hợp lệ xác nhận Auto vẫn tới `done` dù audio cần tạo lại. Dubbing runner đã có guard tương ứng, nhưng export chưa có.

Đã chặn nguồn dubbed khi flag này còn bật, với lỗi hướng dẫn tạo lại TTS/ghép dub hoặc chọn Video gốc. Guard này cần thiết khi giữ output hoàn thành trước để phục hồi. Chọn Video gốc vẫn xuất được phụ đề; file video cũ giữ nguyên.

## Kiểm chứng đợt này

| Bài kiểm tra | Kết quả / phân loại |
|---|---|
| Baseline nhiều nhóm TTS | **FAIL tái hiện được**: nhóm đầu đã tạo candidate hợp lệ, nhóm sau thất bại; hash audio/manifest cũ thay đổi |
| Transaction sau sửa | **Automated PASS**: lỗi ở nhóm sau, hủy sau candidate trước, SRT sửa ngoài app; toàn bộ bytes/pointer của run hoàn thành trước được giữ; chạy lại thành công nhận directory/MP3 mới |
| Tạo lại → dubbing | **Real native processing PASS với fixture**: run mới được DubbingRunner sử dụng, FFmpeg ghép video và inspection decode PASS. Tone tổng hợp chỉ làm fixture, không được tính TTS giọng thật/provider live |
| Baseline export stale | **FAIL tái hiện được**: nguồn Auto với stale audio vẫn hoàn thành export |
| Export sau sửa | **Automated/native fixture PASS**: Auto và explicit dubbed bị từ chối; explicit original softsub thành công; video cũ không đổi bytes |
| Hồi quy | **6/6 entrypoint PASS**: transaction mới, group regeneration, RC TTS cancel/retry, stale-dub export mới, dubbed subtitle export, timing adaptation. Test transaction được bổ sung bước dubbing thật rồi chạy lại PASS |
| Main TypeScript | **PASS**, khoảng 6,018 s |
| Main/preload production build | **PASS**, khoảng 14,757 s; staging riêng, dependencies đọc từ bộ Beta đã chuẩn bị |
| Renderer/full suite/NSIS | Không chạy lại: không sửa frontend/dependency; không có packaging hoặc installer mới |
| UI Electron / live speech | **NOT TESTED cho bản sửa này**; không dùng fixture để nâng thành Live Provider hoặc UI E2E PASS |

Test group-regeneration cũ được cập nhật theo contract mới: đọc directory đang được task chọn, giữ pointer MP3 trước khi lỗi và kiểm tra stale guard. Không xóa assertion bảo toàn bytes, timing, giọng/speed, concurrency hay lỗi. Negative control trên baseline độc lập xác nhận lỗi thực trước khi sửa.

Evidence thô giữ local trong `temp/worktree-audit/`: `regeneration-before.log`, `regeneration-after.log`, `regeneration-with-real-dubbing.log`, `stale-export-before.log`, `followup-results.json`, `main-followup-build.json`. Staging main riêng ở `D:/DEAN/DEAN/VANHSUB/temp/vanhsub-main-followup-VoaNzo`; không ghi đè executable/app.asar đang chạy. Không commit các log hoặc runtime metadata này.

## Phạm vi và việc chưa đóng

Đây là sửa và nghiệm thu giới hạn cho vòng đời artifact TTS/export, không phải chứng nhận toàn app. Các gate cũ còn mở: UAT Electron của nhánh review; shutdown/crash giữa job và soak dài; provider dịch/official visual API thiếu key/quota; Google Flow unusual activity/CDP target cũ; Windows sạch/NSIS. Gate stem cancellation trong bước extraction đã được xử lý riêng ở đợt tiếp theo bên dưới. Không thay kiến trúc để khép các gate này bằng suy đoán.

Bản Beta local đã nghiệm thu trước vẫn giữ nguyên. Trạng thái giới hạn của Internal Beta trước đây không đồng nghĩa nhánh mới đã có UAT; Public Release vẫn NOT READY theo báo cáo RC. Nhánh review tiếp tục giữ local để người dùng review/UAT trước khi yêu cầu push hoặc merge.

## Đợt tiếp theo — hủy extraction của stem và dubbing

Bản sửa: **`93b6111`**, tiếp nối `f5c00e5`, cùng nhánh local. Không thay ASR 16kHz, TTS provider, frontend, Extension hay cơ chế IPC/lease.

Đã tái hiện bằng worker FFmpeg thật: sau khi người dùng hủy stem ở bước trích WAV, worker vẫn chạy đến hết input rồi runner mới trả `cancelled`. Với fixture 6 giây được đọc ở tốc độ thực bằng `-re`, cancel-to-settle trước sửa là **5.806 ms**. Kiểm tra chỗ gọi thứ hai phát hiện dubbing bật tách giọng cũng thiếu tín hiệu hủy; negative control riêng là **5.829 ms**. Không dùng giả lập worker để kết luận lỗi này.

`extractFullQualityAudio` nhận thêm predicate `shouldStop` tùy chọn. Khi đã hủy trước khi bắt đầu, không tạo worker/output. Khi worker đang chạy, polling 150 ms dừng đúng command FFmpeg thuộc tác vụ; promise chỉ kết thúc sau terminal event, timer được dọn khi kết thúc/lỗi. Cả StemExportRunner và bước extraction của dubbing truyền predicate đang có vào helper. Runner vẫn giữ trách nhiệm dọn thư mục tạm và không thay output hoàn thành trước.

| Kiểm chứng đợt extraction | Kết quả |
|---|---|
| Hủy stem giữa extraction | **Real native fixture PASS**: cancel-to-settle **61 ms** ở lần kiểm tra cuối; PID worker đã thoát trước khi runner trả về; partial WAV không còn; pointer/bytes output trước không đổi |
| Hủy dubbing giữa extraction | **Real native fixture PASS**: **60 ms**; worker thoát, WAV tạm được dọn, output trước được giữ và task không hồi sinh thành done |
| Hủy trước extraction | **Automated PASS**, không tạo output |
| Stem/DSP regression | **PASS**, mono/stereo decode, cancel sau extraction, chạy lại thành công và output đúng thư mục project |
| Dubbed subtitle export regression | **PASS**, xuất lặp lại, chọn nguồn, hai track bilingual có đổi tốc độ và phục hồi sau thiếu nguồn |
| Main TypeScript / main-preload build | **PASS**, lần lượt **6.356 ms / 12.576 ms**, staging mới với dependencies Beta đã chuẩn bị |
| Renderer/NSIS/clean Windows/live provider/UI Electron | **NOT TESTED đợt này**; không sửa frontend, không rebuild/ghi đè bản Beta đang chạy |

Ba entrypoint liên quan: `test_stem_extraction_cancel.ts`, `test_pending_stems_integration.ts`, `test_dubbed_subtitle_export.ts`. Harness chỉ thêm `-re` để giữ worker extraction thực hoạt động đủ lâu cho thao tác hủy; audio/video là fixture tổng hợp, không phải nghiệm thu giọng nói, ASR hay provider live. Mốc 61/60 ms là số đo của fixture này, không phải SLA cho mọi máy/file.

Evidence giữ local, không commit: `temp/worktree-audit/stem-extraction-before.log`, `dubbing-extraction-before.log`, `extraction-final.log`, `stems-regression-current.log`, `extraction-dubbed-regression.log`, `extraction-main-build.json`. Staging main/preload: `D:/DEAN/DEAN/VANHSUB/temp/vanhsub-main-followup-Q1IQX0`.

Đối chiếu bảo toàn worktree vẫn PASS: 466 file gốc chưa commit/untracked không đổi hash, HEAD/ref gốc và stash được giữ. Không push remote, merge main hoặc chỉnh profile/project sản xuất. Việc hủy từ runner này **chưa chứng minh đóng/crash toàn app dọn mọi worker**, cũng chưa đóng các gate ASR/translation/TTS khi shutdown, restart recovery và soak dài. Các mục đó tiếp tục cần nghiệm thu riêng; không nâng trạng thái Public Release.
