# KẾ HOẠCH KHẮC PHỤC & TÁI CẤU TRÚC HỆ THỐNG (FIX PLAN) — VANHSUB
**Dự án:** VANHSUB — Studio Phụ Đề, Dịch Thuật & Lồng Tiếng AI  
**Tài liệu đi kèm:** `docs/AUDIT_REPORT.md`  
**Ngày lập kế hoạch:** 2026-09-29  
**Người lập:** Senior Technical Lead & QA Architect  
**Mục tiêu:** Cung cấp lộ trình kỹ thuật chi tiết, có thể kiểm chứng độc lập cho toàn bộ 33 vấn đề đã phát hiện trong báo cáo kiểm toán, phân chia theo 5 giai đoạn ưu tiên từ nghiêm trọng nhất (Critical) đến tối ưu hóa (Enhancement).

---

## MỤC LỤC
1. [Quy Ước Mã Định Danh & Cấu Trúc Task](#1-quy-ước-mã-định-danh--cấu-trúc-task)
2. [Lộ Trình Triển Khai 5 Phase Ưu Tiên](#2-lộ-trình-triển-khai-5-phase-ưu-tiên)
   - [Phase 1: Lỗi Chặn / Lỗi Dữ Liệu / Rò Rỉ Tiến Trình (Critical)](#phase-1-lỗi-chặn--lỗi-dữ-liệu--rò-rỉ-tiến-trình-critical)
   - [Phase 2: Nút Bấm & Luồng Hỏng (High)](#phase-2-nút-bấm--luồng-hỏng-high)
   - [Phase 3: Xung Đột State / Race Condition / Invalidation (Medium)](#phase-3-xung-đột-state--race-condition--invalidation-medium)
   - [Phase 4: Dọn Dẹp Mã Thừa & Dependency (Low)](#phase-4-dọn-dẹp-mã-thừa--dependency-low)
   - [Phase 5: Tối Ưu UI/UX & Hiệu Năng (Enhancement)](#phase-5-tối-ưu-uiux--hiệu-năng-enhancement)
3. [Các Câu Hỏi & Quyết Định Cần Người Dùng Phê Duyệt](#3-các-câu-hỏi--quyết-định-cần-người-dùng-phê-duyệt)
4. [Kế Hoạch Kiểm Thử Tích Hợp Sau Khắc Phục (Regression Test Plan)](#4-kế-hoạch-kiểm-thử-tích-hợp-sau-khắc-phục-regression-test-plan)

---

## 1. QUY ƯỚC MÃ ĐỊNH DANH & CẤU TRÚC TASK

### 1.1. Bảng Tiền Tố Mã Định Danh (Issue ID)
- `F-EXP-*`: Lỗi thuộc module Export Video & Dubbing
- `F-TTS-*`: Lỗi thuộc module Text-to-Speech & Lồng tiếng
- `F-DL-*`: Lỗi thuộc module Tải video & Ingestion
- `F-OCR-*`: Lỗi thuộc module Nhận diện chữ video OCR
- `F-SUB-*`: Lỗi thuộc module Biên tập phụ đề SubtitleEditor
- `F-ASR-*`: Lỗi thuộc module Nhận diện giọng nói Whisper
- `F-SET-*`: Lỗi thuộc module Cài đặt hệ thống SettingsPage
- `F-TERM-*`: Lỗi thuộc module Quản lý log TerminalPanel
- `F-STATE-*`: Lỗi bất đồng bộ trạng thái, vòng đời dữ liệu & state invalidation
- `F-CONC-*`: Lỗi xung đột đa tiến trình, rò rỉ tài nguyên CPU/RAM
- `F-IPC-*`: Lỗi giao tiếp liên tiến trình IPC & Preload ContextBridge
- `F-DEAD-*`: Mã nguồn rác, dead code, dependency không sử dụng

### 1.2. Thang Đo Đánh Giá
- **Mức độ nghiêm trọng**:
  - `Critical`: Gây sập ứng dụng, mất dữ liệu, sai lệch nghiêm trọng giữa phụ đề và âm thanh, hoặc rò rỉ tiến trình hệ điều hành không thể dừng.
  - `High`: Nút bấm hỏng, chức năng cốt lõi không thể sử dụng trên môi trường người dùng, hoặc thao tác biên tập không thể phục hồi.
  - `Medium`: Race condition, lệch pha giao diện giữa các tab, thiếu hàng đợi hoặc thiết kế UI gây nhầm lẫn.
  - `Low / Enhancement`: Dọn dẹp mã nguồn thừa, tối ưu trải nghiệm cuộn, debounce input.
- **Công sức ước tính (Effort)**:
  - `S` (Small): < 2 giờ làm việc, chỉnh sửa cục bộ tại 1-2 vị trí.
  - `M` (Medium): 2 - 6 giờ làm việc, cần viết thêm module phụ trợ hoặc tái cấu trúc luồng dữ liệu.
  - `L` (Large): > 6 giờ làm việc, cần tích hợp thư viện mới hoặc đại tu kiến trúc component.
- **Rủi ro hồi quy (Regression Risk)**:
  - `Thấp`: Không ảnh hưởng tới các module khác.
  - `Trung bình`: Có thể tác động tới luồng lưu trữ file hoặc trạng thái IPC giữa Main và Renderer.
  - `Cao`: Tác động trực tiếp tới tiến trình render FFmpeg hoặc quản lý vòng đời Task trong TaskStore.

---

## 2. LỘ TRÌNH TRIỂN KHAI 5 PHASE ƯU TIÊN

---

### PHASE 1: LỖI CHẶN / LỖI DỮ LIỆU / RÒ RỈ TIẾN TRÌNH (CRITICAL)

#### Task 1.1: [F-EXP-01] Bổ sung cơ chế Cancel và tiêu diệt sạch Process Tree cho ExportRunner và DubbingRunner
- **Mức độ**: `Critical` | **Công sức**: `M` | **Rủi ro hồi quy**: `Trung bình`
- **Tập tin cần sửa**:
  - `main/render/exportRunner.ts` (dòng 35-262)
  - `main/render/videoRenderer.ts` (dòng 636, 715)
  - `main/render/dubbingRunner.ts` (dòng 17-116)
  - `main/render/dubbingEngine.ts` (dòng 433)
  - `main/main.ts` (dòng 487-503)
- **Nguyên nhân gốc rễ**: Lệnh `command = ffmpeg(...)` được gọi cục bộ trong Promise, không lưu tham chiếu lệnh (Command instance) vào Map quản lý; `cancelTaskExecution` trong `main.ts` không gọi phương thức cancel của ExportRunner và DubbingRunner.
- **Giải pháp kỹ thuật cụ thể**:
  1. Trong `main/render/exportRunner.ts`, tạo cấu trúc lưu trữ lệnh đang chạy: `private static runningCommands = new Map<string, ffmpeg.FfmpegCommand>();`
  2. Bổ sung phương thức `static cancel(taskId: string): boolean`:
     ```typescript
     static cancel(taskId: string): boolean {
       const cmd = this.runningCommands.get(taskId);
       if (cmd) {
         try {
           cmd.kill('SIGKILL');
         } catch {}
         this.runningCommands.delete(taskId);
         return true;
       }
       return false;
     }
     ```
  3. Áp dụng tương tự cho `main/render/dubbingRunner.ts`.
  4. Trong `main/main.ts:cancelTaskExecution(id)`: Thêm lệnh gọi huỷ:
     ```typescript
     const exportCancelled = ExportRunner.cancel(id);
     const dubbingCancelled = DubbingRunner.cancel(id);
     ```
- **Tiêu chí nghiệm thu (Acceptance Criteria)**:
  - Khởi chạy Export video trong ứng dụng. Mở Windows Task Manager thấy `ffmpeg.exe` hoạt động.
  - Bấm nút Cancel tác vụ trên giao diện: Quá trình xuất dừng ngay lập tức, tiến trình `ffmpeg.exe` biến mất hoàn toàn khỏi Task Manager.
  - File `.mp4` dang dở trong thư mục temp hoặc đích được dọn dẹp an toàn.

---

#### Task 1.2: [F-EXP-02] Ngăn chặn lỗi "Hồi sinh tác vụ" (Task Resurrection Bug) trong ExportRunner
- **Mức độ**: `Critical` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/render/exportRunner.ts` (dòng 233-241)
  - `main/render/dubbingRunner.ts` (dòng 95-108)
- **Nguyên nhân gốc rễ**: Callback `on('end')` của FFmpeg không kiểm tra trạng thái hiện thời của Task trong `TaskStore`. Dù task đã bị huỷ chuyển sang `'cancelled'`, callback vẫn chạy và cập nhật đè trạng thái thành `'done'`.
- **Giải pháp kỹ thuật cụ thể**:
  1. Trước khi thực thi `TaskStore.update(...)` trong callback `on('end')`, kiểm tra trạng thái mới nhất:
     ```typescript
     const currentTask = TaskStore.get(taskId);
     if (currentTask && currentTask.status === 'cancelled') {
       logger.info(`[ExportRunner] Tác vụ ${taskId} đã bị huỷ trước đó. Bỏ qua cập nhật 'done'.`);
       return;
     }
     ```
  2. Xoá file output dở dang nếu task mang trạng thái `cancelled`.
- **Tiêu chí nghiệm thu**:
  - Bấm xuất video rồi lập tức bấm Cancel.
  - Đợi thời gian đủ để FFmpeg kết thúc (nếu có độ trễ kill): Trạng thái của task vẫn giữ nguyên là `cancelled`, tuyệt đối không tự nhảy sang `done`.

---

#### Task 1.3: [F-STATE-02] Tự động Invalidate và dọn dẹp Audio TTS khi chạy lại Dịch thuật (Re-translate)
- **Mức độ**: `Critical` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/translate/translateRunner.ts` (dòng 45-51)
- **Nguyên nhân gốc rễ**: Khi bấm dịch lại, `translateRunner` chỉ reset `status = 'translating'` mà không xoá các trường `ttsAudioDir`, `ttsMergedAudioPath`, `outputPath` và thư mục audio tương ứng.
- **Giải pháp kỹ thuật cụ thể**:
  1. Trong `TranslateRunner.runTask(taskId, targetLang)`, trước khi dịch:
     ```typescript
     const task = TaskStore.get(taskId);
     if (task?.ttsAudioDir && fs.existsSync(task.ttsAudioDir)) {
       try {
         fs.rmSync(task.ttsAudioDir, { recursive: true, force: true });
       } catch (err) {
         logger.warn(`[TranslateRunner] Không thể xoá thư mục TTS cũ: ${err}`);
       }
     }
     if (task?.ttsMergedAudioPath && fs.existsSync(task.ttsMergedAudioPath)) {
       try {
         fs.unlinkSync(task.ttsMergedAudioPath);
       } catch {}
     }
     TaskStore.update(taskId, {
       status: 'translating',
       progress: 0,
       targetLanguage: targetLang,
       stageDescription: 'Đang khởi tạo dịch thuật AI...',
       ttsAudioDir: undefined,
       ttsMergedAudioPath: undefined,
       ttsOverruns: undefined,
       outputPath: undefined,
     });
     ```
- **Tiêu chí nghiệm thu**:
  - Tạo 1 video có đầy đủ phụ đề gốc -> dịch -> TTS.
  - Quay lại `SubtitleEditor`, đổi ngôn ngữ dịch và bấm dịch lại.
  - Quan sát tab `TTSPage`: Trạng thái audio lồng tiếng chuyển về trạng thái ban đầu ("Chưa tạo audio"), không còn phát lại file âm thanh của bản dịch cũ.

---

#### Task 1.4: [F-DL-01] Bổ sung nút Huỷ tải video & Kênh IPC huỷ tải trong DownloadModal
- **Mức độ**: `Critical` | **Công sức**: `M` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/main.ts` (dòng 340-369)
  - `main/preload.ts` (dòng 135-144)
  - `main/helpers/videoDownloader.ts` (dòng 998-1165)
  - `renderer/types/electron.d.ts` (dòng 135-145)
  - `renderer/lib/downloadManager.ts` (dòng 78-169)
  - `renderer/components/download/DownloadModal.tsx` (dòng 621-645)
- **Nguyên nhân gốc rễ**: Lớp IPC chỉ có `downloader:download` mà không có `downloader:cancel`. `videoDownloader.ts` không lưu con trỏ tiến trình `child = spawn(ytDlp, ...)`.
- **Giải pháp kỹ thuật cụ thể**:
  1. Trong `videoDownloader.ts`, quản lý bản đồ tiến trình tải: `const activeDownloads = new Map<string, { child?: ChildProcess; abortController?: AbortController }>();`.
  2. Bổ sung hàm `cancelDownload(downloadId: string): boolean`:
     - Nếu là `yt-dlp`: Thực thi `spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])`.
     - Nếu là Axios stream: Gọi `abortController.abort()`.
  3. Đăng ký kênh IPC `ipcMain.handle('downloader:cancel', (_, downloadId) => cancelDownload(downloadId))`.
  4. Trên giao diện `DownloadModal.tsx`: Khi trạng thái là `downloading`, thay thế nút "Đóng & Chạy nền" bằng nút "Huỷ tải video" (màu đỏ) kèm `onClick={handleCancelDownload}`.
- **Tiêu chí nghiệm thu**:
  - Dán link video YouTube/TikTok dung lượng lớn và bấm "Tải video".
  - Bấm nút "Huỷ tải video": Quá trình tải dừng ngay lập tức, tiến trình `yt-dlp.exe` bị đóng sạch trong Task Manager, file tải dở `.part` được xoá.

---

#### Task 1.5: [F-CONC-02] Triệt để dọn dẹp Process Tree cho PaddleOCR và Demucs qua `taskkill /F /T`
- **Mức độ**: `Critical` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/ocr/paddleEngine.ts` (dòng 153-162)
  - `main/audio/vocalSeparation.ts` (dòng 156-165)
- **Nguyên nhân gốc rễ**: Code sử dụng `child.kill()`. Trên Windows, lệnh này chỉ gửi tín hiệu tới process cha, toàn bộ các tiến trình con (worker processes của Python, PyTorch, ONNXRuntime) bị rò rỉ thành tiến trình mồ côi (orphan).
- **Giải pháp kỹ thuật cụ thể**:
  1. Tạo hàm tiện ích dùng chung `main/lib/processTree.ts`:
     ```typescript
     import { spawn, ChildProcess } from 'child_process';
     export function killProcessTree(child: ChildProcess): void {
       try {
         if (process.platform === 'win32' && child.pid) {
           spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
         } else {
           child.kill('SIGKILL');
         }
       } catch {}
     }
     ```
  2. Thay thế toàn bộ các lệnh `child.kill()` trong `paddleEngine.ts` và `vocalSeparation.ts` bằng `killProcessTree(child)`.
  3. Bổ sung `setInterval` polling kiểm tra `shouldStop` trong `paddleEngine.ts` (chu kỳ 300ms) để ngắt ngay cả khi Python bị nghẽn không nhả stdout.
- **Tiêu chí nghiệm thu**:
  - Chạy tính năng "Tách lời bằng AI (Demucs)" hoặc "Quét chữ OCR". Mở Resource Monitor thấy cụm tiến trình `python.exe`.
  - Bấm nút Huỷ: Toàn bộ cụm tiến trình con `python.exe` bị tắt ngay lập tức, dung lượng RAM giảm trở lại.

---

### PHASE 2: NÚT BẤM & LUỒNG HỎNG (HIGH)

#### Task 2.1: [F-TTS-01] Sửa nút Dubbing trong TTSPage (Disable khi đang export/dubbing)
- **Mức độ**: `High` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/TTSPage.tsx` (dòng 1149-1153)
- **Nguyên nhân gốc rễ**: Nút bấm chỉ kiểm tra `disabled={startingDubbing}`. Vì `startingDubbing` chỉ bật `true` trong vài mili-giây lúc gửi IPC, nên khi tiến trình FFmpeg đang chạy nền, nút vẫn sáng, cho phép người dùng click liên tục.
- **Giải pháp kỹ thuật cụ thể**:
  1. Kiểm tra trạng thái đang chạy thực tế của tác vụ:
     ```tsx
     const isDubbingRunning = selectedTask?.status === 'exporting' || selectedTask?.status === 'dubbing';
     ```
  2. Cập nhật điều kiện disable trên nút:
     ```tsx
     <button
       type="button"
       onClick={handleStartDubbing}
       disabled={startingDubbing || isDubbingRunning || !hasTtsAudio}
       className={`... ${isDubbingRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
     >
       {isDubbingRunning ? 'Đang ghép lồng tiếng...' : 'Ghép audio vào video (Dubbing)'}
     </button>
     ```
- **Tiêu chí nghiệm thu**:
  - Bấm "Ghép audio vào video (Dubbing)": Nút chuyển xám, hiển thị "Đang ghép lồng tiếng..." và không thể bấm lần thứ hai trong suốt thời gian FFmpeg làm việc.

---

#### Task 2.2: [F-SUB-04] Bổ sung tính năng Hoàn tác / Làm lại (Undo / Redo - `Ctrl+Z` / `Ctrl+Y`) cho SubtitleEditor
- **Mức độ**: `High` | **Công sức**: `M` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/SubtitleEditor.tsx` (dòng 140-200, 528-540, 1000-1110)
- **Nguyên nhân gốc rễ**: Component chỉ có 1 state `lines: SubtitleItem[]`. Bất kỳ thao tác sửa, xoá dòng, chèn dòng hoặc AI format đều ghi đè trực tiếp mà không lưu snapshot.
- **Giải pháp kỹ thuật cụ thể**:
  1. Thêm mảng quản lý lịch sử:
     ```typescript
     const [history, setHistory] = useState<SubtitleItem[][]>([]);
     const [redoStack, setRedoStack] = useState<SubtitleItem[][]>([]);
     ```
  2. Tạo hàm `pushHistory(newLines)`: Giới hạn tối đa 30 bước hoàn tác gần nhất.
  3. Cài đặt hàm `handleUndo` và `handleRedo`.
  4. Lắng nghe sự kiện bàn phím toàn cục trong `useEffect`:
     - Bắt `(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'`: Nếu không có Shift thì gọi `handleUndo()`, nếu có Shift (`Ctrl+Shift+Z`) hoặc `Ctrl+Y` thì gọi `handleRedo()`.
  5. Thêm 2 icon nút bấm Undo / Redo trên thanh công cụ SubtitleEditor bên cạnh nút "Lưu thay đổi".
- **Tiêu chí nghiệm thu**:
  - Người dùng bấm nút xoá 1 câu thoại: Bấm `Ctrl+Z` câu thoại xuất hiện trở lại với đúng mốc thời gian cũ.
  - Bấm `Ctrl+Y`: Câu thoại bị xoá lại.

---

#### Task 2.3: [F-SUB-01 & F-SUB-02] Bổ sung tính năng Tách câu (Split) và Ghép câu (Merge) cho SubtitleEditor
- **Mức độ**: `High` | **Công sức**: `M` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/SubtitleEditor.tsx` (dòng 1080-1110)
- **Nguyên nhân gốc rễ**: Người biên dịch chỉ có thể chèn dòng trống hoặc xoá dòng, không có công cụ chia đôi thời lượng câu hoặc gộp 2 câu liền kề.
- **Giải pháp kỹ thuật cụ thể**:
  1. **Nút Tách câu (Split)**:
     - Bổ sung nút icon `Scissors` trên mỗi card câu thoại.
     - Khi bấm, tách câu thoại thành 2 câu:
       - Câu 1: `startMs = startMs`, `endMs = startMs + Math.round((endMs - startMs) / 2)`, văn bản lấy nửa đầu theo vị trí con trỏ (hoặc 50% độ dài ký tự).
       - Câu 2: `startMs = câu 1 endMs`, `endMs = endMs gốc`, văn bản lấy nửa còn lại.
  2. **Nút Ghép câu dưới (Merge Down)**:
     - Bổ sung nút icon `Merge` (hàng rào kết nối).
     - Khi bấm vào dòng `i`, gộp với dòng `i+1`:
       - Dòng mới: `startMs = line[i].startMs`, `endMs = line[i+1].endMs`, `text = line[i].text + ' ' + line[i+1].text`.
       - Xoá dòng `i+1` khỏi danh sách.
- **Tiêu chí nghiệm thu**:
  - Có 1 câu phụ đề 00:00:01 - 00:00:05 "Xin chào các bạn tôi là Vanhsub":
  - Bấm nút Split tại chữ "các bạn": Sinh ra 2 câu: 00:00:01-00:00:03 "Xin chào các bạn" và 00:00:03-00:00:05 "tôi là Vanhsub".
  - Bấm nút Merge: Hai câu gộp lại như cũ.

---

#### Task 2.4: [F-OCR-01 & F-SET-01] Cho phép cấu hình `pythonPath` trong Settings và truyền vào PaddleOCR & Demucs
- **Mức độ**: `High` | **Công sức**: `M` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/store/settingsStore.ts` (thêm trường `pythonPath`)
  - `main/ocr/paddleEngine.ts` (dòng 84, 146)
  - `main/audio/vocalSeparation.ts` (dòng 156)
  - `renderer/components/SettingsPage.tsx` (thêm khối UI chọn Python)
  - `renderer/types/electron.d.ts` (cập nhật kiểu AppSettings)
- **Nguyên nhân gốc rễ**: Code gọi cứng `'python'` qua PATH của Windows. Người dùng dùng môi trường ảo (.venv, Anaconda) không thể chạy được PaddleOCR và Demucs.
- **Giải pháp kỹ thuật cụ thể**:
  1. Thêm `pythonPath?: string` vào `AppSettings`.
  2. Trên `SettingsPage.tsx`: Thêm mục "Đường dẫn thực thi Python", có nút "Duyệt tìm file" (`python.exe`) và nút "Tự động phát hiện" (kiểm tra `where python` / `which python3`).
  3. Trong `paddleEngine.ts` và `vocalSeparation.ts`:
     ```typescript
     const customPython = SettingsStore.get('pythonPath');
     const pythonExec = customPython && fs.existsSync(customPython) ? customPython : 'python';
     const child = spawn(pythonExec, args, { windowsHide: true });
     ```
- **Tiêu chí nghiệm thu**:
  - Cài Python vào thư mục tuỳ ý (ví dụ: `D:\AI\venv\Scripts\python.exe`).
  - Cấu hình đường dẫn này vào trang Settings: PaddleOCR và Demucs chạy thành công mà không phụ thuộc vào biến môi trường PATH hệ thống.

---

#### Task 2.5: [F-ASR-01 & F-ASR-02] Bổ sung Dropdown chọn ngôn ngữ Whisper và ô nhập Prompt cho ASRWorkspace
- **Mức độ**: `High` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/asr/whisperEngine.ts` (dòng 269)
  - `main/asr/taskRunner.ts` (dòng 100-130)
  - `renderer/components/ASRWorkspace.tsx` (dòng 340-360)
  - `renderer/components/ASRModelSelector.tsx` (thêm dropdown)
- **Nguyên nhân gốc rễ**: `whisperEngine.ts:269` fix cứng cờ `'-l', 'auto'`. Không có chỗ truyền cờ `--prompt`.
- **Giải pháp kỹ thuật cụ thể**:
  1. Bổ sung tham số `language?: string` (vi, en, zh, ja, ko...) và `prompt?: string` vào hàm `transcribe`.
  2. Trong `whisperEngine.ts`:
     ```typescript
     const lang = options?.language || 'auto';
     const args = ['-osrt', '-sow', 'true', '-l', lang, '-m', modelFile, '-f', wavPath];
     if (options?.prompt) {
       args.push('--prompt', options.prompt);
     }
     ```
  3. Bổ sung trên giao diện `ASRWorkspace.tsx` một ô Select "Ngôn ngữ nói trong video" (mặc định Tự động nhận diện) và ô Accordion "Whisper Prompt (Tuỳ chọn)".
- **Tiêu chí nghiệm thu**:
  - Chọn ngôn ngữ "Tiếng Việt (`vi`)": Lệnh whisper thực thi với cờ `-l vi`, loại bỏ triệt để hiện tượng nhận diện nhầm sang tiếng Trung/Anh ở đoạn mở đầu video.

---

### PHASE 3: XUNG ĐỘT STATE / RACE CONDITION / INVALIDATION (MEDIUM)

#### Task 3.1: [F-STATE-01] Đồng bộ hoá `selectedTaskId` toàn cục từ `home.tsx` xuống toàn bộ các tab con
- **Mức độ**: `Medium` | **Công sức**: `M` | **Rủi ro hồi quy**: `Trung bình`
- **Tập tin cần sửa**:
  - `renderer/pages/home.tsx` (dòng 776-805)
  - `renderer/components/ASRWorkspace.tsx` (dòng 48)
  - `renderer/components/TTSPage.tsx` (dòng 49)
  - `renderer/components/ExportPage.tsx` (dòng 139)
- **Nguyên nhân gốc rễ**: Mỗi tab con tự tạo một `useState<string | null>(null)` nội bộ, không liên kết với `selectedTaskId` của `home.tsx`.
- **Giải pháp kỹ thuật cụ thể**:
  1. Nâng state `selectedTaskId` lên thành single source of truth tại `home.tsx`.
  2. Truyền `selectedTaskId` và callback `onSelectTaskId` xuống cả 4 tab:
     ```tsx
     <ASRWorkspace tasks={tasks} selectedTaskId={selectedTaskId} onSelectTaskId={setSelectedTaskId} />
     <SubtitleEditor tasks={tasks} selectedTaskId={selectedTaskId} onSelectTaskId={setSelectedTaskId} />
     <TTSPage tasks={tasks} selectedTaskId={selectedTaskId} onSelectTaskId={setSelectedTaskId} />
     <ExportPage tasks={tasks} selectedTaskId={selectedTaskId} onSelectTaskId={setSelectedTaskId} />
     ```
  3. Trong các tab con: Sử dụng `controlledTaskId` từ props nếu được cung cấp.
- **Tiêu chí nghiệm thu**:
  - Bấm chọn video A ở Dashboard -> Chuyển sang tab Subtitles: Video A được chọn.
  - Chuyển sang tab Lồng tiếng (TTS): Video A được chọn.
  - Chuyển sang tab Xuất video: Video A được chọn. Hoàn toàn đồng nhất.

---

#### Task 3.2: [F-ASR-03] Disable thẻ chọn Model trong `ASRModelSelector` khi đang phiên âm
- **Mức độ**: `Medium` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/ASRModelSelector.tsx` (dòng 136-151)
  - `renderer/components/ASRWorkspace.tsx` (dòng 345)
- **Nguyên nhân gốc rễ**: Thẻ `<select>` chọn model thiếu prop `disabled={isBusy}`.
- **Giải pháp kỹ thuật cụ thể**:
  1. Thêm prop `disabled?: boolean` vào interface của `ASRModelSelector`.
  2. Gán `disabled={disabled}` cho thẻ `<select>` ở dòng 136.
  3. Tại `ASRWorkspace.tsx:345`, truyền `disabled={isBusy}` vào component `ASRModelSelector`.
- **Tiêu chí nghiệm thu**:
  - Khi bấm phiên âm (task đang `transcribing`), dropdown model chuyển sang màu xám và không thể click đổi model.

---

#### Task 3.3: [F-CONC-01] Thiết lập Hàng đợi & Giới hạn tài nguyên tập trung (Global Concurrency Limiter)
- **Mức độ**: `Medium` | **Công sức**: `M` | **Rủi ro hồi quy**: `Trung bình`
- **Tập tin cần sửa**:
  - Tạo mới `main/lib/concurrencyManager.ts`
  - `main/ocr/ocrRunner.ts` (dòng 76)
  - `main/render/exportRunner.ts` (dòng 40)
  - `main/render/dubbingRunner.ts` (dòng 30)
- **Nguyên nhân gốc rễ**: `OcrRunner`, `ExportRunner`, `DubbingRunner` không có cơ chế giới hạn số lượng tác vụ song song, gây quá tải CPU/RAM khi người dùng xuất hàng loạt.
- **Giải pháp kỹ thuật cụ thể**:
  1. Xây dựng Semaphore limiter `ConcurrencyManager`:
     - Giới hạn tối đa: 1 tác vụ Export, 1 tác vụ OCR, 2 tác vụ ASR chạy song song.
     - Các tác vụ vượt quá sẽ được đưa vào hàng đợi trạng thái `queued`.
  2. Khi một tác vụ render kết thúc, tự động dequeuer và kích hoạt tác vụ tiếp theo.
- **Tiêu chí nghiệm thu**:
  - Bấm xuất video cho 3 tác vụ cùng lúc: Tác vụ 1 chạy render (status `exporting`), tác vụ 2 và 3 chuyển sang `queued`. Khi tác vụ 1 xong, tác vụ 2 tự động bắt đầu. CPU không bị quá tải đột ngột.

---

#### Task 3.4: [F-TTS-05] Khắc phục lỗi Index Mismatch trong `regenerateTtsLine`
- **Mức độ**: `Medium` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/render/ttsEngine.ts` (dòng 276, 291)
  - `renderer/components/TTSPage.tsx` (dòng 863-876)
- **Nguyên nhân gốc rễ**: Khi tạo lại một câu thoại, mã nguồn dùng `sub.index` không nhất quán giữa số thứ tự mảng và thuộc tính `index` của SRT, khiến file audio ghi ra một tên nhưng engine dubbing lại tìm tên khác.
- **Giải pháp kỹ thuật cụ thể**:
  1. Chuẩn hoá tên file audio: Luôn định danh bằng `sub.index` thực tế của SRT:
     ```typescript
     const targetIndex = sub.index;
     const audioPath = path.join(ttsAudioDir, `subtitle_${String(targetIndex).padStart(4, '0')}.mp3`);
     ```
  2. Sau khi tạo lại dòng đơn lẻ thành công, tự động gọi một hàm ngầm cập nhật lại file MP3 tổng hợp `ttsMergedAudioPath`.
- **Tiêu chí nghiệm thu**:
  - Bấm icon "Tạo lại giọng câu này" tại câu số 3: File audio mới được sinh đúng vị trí và file MP3 phát thử cập nhật ngay lập tức giọng mới của câu số 3.

---

#### Task 3.5: [F-ASR-04] Khắc phục trạng thái Flapping trong HybridRunner
- **Mức độ**: `Medium` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/asr/hybridRunner.ts` (dòng 145-180)
  - `main/ocr/ocrRunner.ts` (dòng 334)
- **Nguyên nhân gốc rễ**: Khi gọi `OcrRunner` bên trong `HybridRunner`, lúc OCR xong nó cập nhật task thành `done`, ngay sau đó HybridRunner lại cập nhật thành `ocr`, khiến UI bị giật trạng thái hoàn tất giả.
- **Giải pháp kỹ thuật cụ thể**:
  1. Thêm tham số `isSubTask: true` khi `HybridRunner` gọi `OcrRunner.runOcr`.
  2. Trong `OcrRunner`: Nếu `isSubTask === true`, bỏ qua việc cập nhật `status: 'done'` cho task.
- **Tiêu chí nghiệm thu**:
  - Chạy chế độ "Whisper + OCR": Tiến trình chuyển mượt từ `transcribing` -> `ocr` -> `done`, không bị giật trạng thái.

---

### PHASE 4: DỌN DẸP MÃ THỪA & DEPENDENCY (LOW)

#### Task 4.1: [F-DEAD-02] Xoá file Dead Code `main/render/timelineRunner.ts`
- **Mức độ**: `Low` | **Công sức**: `S` | **Rủi ro hồi quy**: `Không có`
- **Tập tin cần sửa**:
  - Xoá tệp: `main/render/timelineRunner.ts` (194 dòng)
- **Nguyên nhân gốc rễ**: File thừa tồn đọng từ giai đoạn thử nghiệm đầu tiên, không có bất kỳ import nào trong toàn bộ dự án.
- **Tiêu chí nghiệm thu**: Xoá file, chạy `npx tsc --noEmit` và `npm run build` vẫn pass exit 0.

---

#### Task 4.2: [F-DEAD-03] Gỡ bỏ hơn 30 Package không sử dụng trong `package.json`
- **Mức độ**: `Low` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `package.json`
- **Danh sách gỡ bỏ**:
  - 14 package `@radix-ui/*`: alert-dialog, collapsible, dropdown-menu, hover-card, label, popover, progress, scroll-area, select, separator, slider, slot, switch, tabs, tooltip.
  - Các package UI/form thừa: `react-hook-form`, `@hookform/resolvers`, `cmdk`, `vaul`, `class-variance-authority`, `react-player`, `next-themes`, `zod`.
  - Các tiện ích không dùng: `decompress`, `srt-webvtt`, `really-relaxed-json`, `jassub`, `http-proxy-agent`, `https-proxy-agent`, `node-addon-api`, `node-loader`.
  - **Lưu ý an toàn tuyệt đối**: GIỮ LẠI `nodejs-whisper` (dùng nhị phân C++) và `@radix-ui/react-dialog` (modal đang dùng).
- **Tiêu chí nghiệm thu**:
  - Chạy `npm uninstall ...` thành công.
  - Chạy `npm run build` thành công xuất sắc, kích thước thư mục `node_modules` và file installer giảm đáng kể.

---

#### Task 4.3: [F-DEAD-04] Gom hàm `killProcessTree` vào `main/lib/processTree.ts`
- **Mức độ**: `Low` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - Xoá code sao chép tại: `main/asr/whisperEngine.ts:101`, `main/helpers/voiceFromUrl.ts:33`, `main/helpers/videoDownloader.ts:333`.
  - Import hàm chung từ `main/lib/processTree.ts`.
- **Tiêu chí nghiệm thu**: Code ngắn gọn, DRY, tập trung 1 nơi duy nhất.

---

#### Task 4.4: [F-IPC-01 & F-IPC-02] Dọn dẹp dead channel `tasks.addFromUrl` và bổ sung types cho `startHybrid`/`cancelHybrid`
- **Mức độ**: `Low` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `main/preload.ts` (dòng 12-16)
  - `renderer/types/electron.d.ts` (dòng 180-210)
  - `renderer/components/ASRWorkspace.tsx` (dòng 201, 220)
- **Giải pháp kỹ thuật cụ thể**:
  1. Xoá dòng `addFromUrl` khỏi `preload.ts` và `electron.d.ts`.
  2. Bổ sung định nghĩa kiểu cho `startHybrid(id: string): Promise<boolean>` và `cancelHybrid(id: string): Promise<boolean>` vào `electron.d.ts`.
  3. Xoá bỏ ép kiểu `(window as any).vanhsub` trong `ASRWorkspace.tsx`, chuyển về gọi kiểu an toàn `window.vanhsub.tasks.startHybrid`.
- **Tiêu chí nghiệm thu**: Không còn cảnh báo ép kiểu any trong code TypeScript.

---

### PHASE 5: TỐI ƯU UI/UX & HIỆU NĂNG (ENHANCEMENT)

#### Task 5.1: [F-TERM-02] Sửa lỗi Auto-scroll cưỡng bức trong TerminalPanel
- **Mức độ**: `Low` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/TerminalPanel.tsx` (dòng 197-212)
- **Nguyên nhân gốc rễ**: `useEffect` luôn gán `scrollTop = scrollHeight` bất kể người dùng có đang chủ động cuộn lên xem log lỗi hay không.
- **Giải pháp kỹ thuật cụ thể**:
  1. Tạo state `userScrolledUp = useRef(false)`.
  2. Trong sự kiện `onScroll` của container: Nếu khoảng cách từ đáy `scrollHeight - scrollTop - clientHeight > 40px`, đánh dấu `userScrolledUp.current = true`. Ngược lại đánh dấu `false`.
  3. Chỉ tự động cuộn xuống đáy khi `userScrolledUp.current === false`.
- **Tiêu chí nghiệm thu**: Người dùng cuộn chuột lên để copy dòng log lỗi, khi log mới đổ về thì màn hình không bị giật xuống đáy.

---

#### Task 5.2: [F-SET-04] Bổ sung Debounce cho ô nhập custom Gemini model
- **Mức độ**: `Low` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/SettingsPage.tsx` (dòng 619-631)
- **Giải pháp kỹ thuật cụ thể**: Sử dụng `lodash.debounce` hoặc timer 500ms trước khi gọi `autoSaveSetting('geminiModel', value)`.
- **Tiêu chí nghiệm thu**: Gõ liên tục tên model không bắn IPC liên tục từng ký tự.

---

#### Task 5.3: [F-SUB-03] Tích hợp thư viện Waveform sóng âm thanh cho SubtitleEditor
- **Mức độ**: `Low / Enhancement` | **Công sức**: `M` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/SubtitleEditor.tsx` (dòng 1228-1270)
- **Giải pháp kỹ thuật cụ thể**: Sử dụng `wavesurfer.js` kết nối với audio track trích xuất từ video để hiển thị phổ sóng âm dạng peaks trực quan dưới timeline.
- **Tiêu chí nghiệm thu**: Người dùng nhìn thấy rõ các đoạn im lặng và đoạn có tiếng nói để căn chỉnh phụ đề chính xác đến từng mili-giây.

---

#### Task 5.4: [F-TTS-03] Bổ sung cơ chế In-Memory Cache cho tính năng Full Preview TTS
- **Mức độ**: `Low / Enhancement` | **Công sức**: `S` | **Rủi ro hồi quy**: `Thấp`
- **Tập tin cần sửa**:
  - `renderer/components/TTSPage.tsx` (dòng 733-743)
- **Giải pháp kỹ thuật cụ thể**: Lưu trữ kết quả audio base64 của từng câu vào `Map<string, string>` (key là hash của text + voice + speed). Khi nghe lại, nạp trực tiếp từ RAM không bắn request ra cloud.
- **Tiêu chí nghiệm thu**: Tốc độ phản hồi nghe thử tức thì, tiết kiệm băng thông và hạn chế rate-limit.

---

## 3. CÁC CÂU HỎI & QUYẾT ĐỊNH CẦN NGƯỜI DÙNG PHÊ DUYỆT

Trước khi đội ngũ kỹ sư bắt tay vào thực hiện mã hoá ở giai đoạn tiếp theo, kính đề nghị Người Dùng / Product Owner xem xét và phê duyệt 3 quyết định định hướng sau:

### Quyết định 1: Định hướng đối với F5-TTS và Pitch Control (Cao độ giọng nói)
- **Thực tế hiện tại**: Mã nguồn hiện tại hoàn toàn **KHÔNG CÓ** F5-TTS và Pitch control. Hệ thống đang sử dụng rất tốt 2 nhà cung cấp là **Microsoft Edge Neural TTS** (miễn phí, chất lượng cao, có chỉnh tốc độ) và **TikTok TTS** (giọng đọc mạng xã hội phong phú).
- **Lựa chọn A (Khuyến nghị)**: Chuẩn hoá tài liệu và giao diện theo thực tế Edge TTS + TikTok TTS. Bỏ qua F5-TTS vì F5-TTS đòi hỏi môi trường Python PyTorch rất nặng (~4GB model checkpoints) và yêu cầu card đồ hoạ NVIDIA VRAM lớn, không phù hợp với đại đa số người dùng phổ thông.
- **Lựa chọn B**: Yêu cầu nhóm kỹ sư xây dựng thêm backend sidecar cho F5-TTS và bổ sung tham số pitch cho Edge-TTS (cần thêm thời gian nghiên cứu và đóng gói).

---

### Quyết định 2: Hợp nhất tính năng Dubbing giữa TTSPage và ExportPage
- **Thực tế hiện tại**: Khối điều khiển "Ghép audio vào video (Dubbing)" đang xuất hiện trùng lặp 100% ở cả 2 màn hình `TTSPage` và `ExportPage`.
- **Lựa chọn A (Khuyến nghị UX)**: Tách bạch rõ ràng chức năng theo từng bước trong quy trình:
  - `TTSPage`: Chỉ tập trung vào việc **Sinh file âm thanh** (nghe thử giọng, gán giọng từng câu, tổng hợp file MP3 giọng đọc hoàn chỉnh).
  - `ExportPage`: Là nơi duy nhất thực hiện việc **Ghép video** (mux audio dubbed vào video, tách nhạc nền Demucs, căn chỉnh đồng bộ và xuất file MP4 cuối cùng). Loại bỏ hoàn toàn nút xuất Dubbing trong `TTSPage`.
- **Lựa chọn B**: Tiếp tục giữ nguyên nút Dubbing nhanh ở cả 2 trang, nhưng gom chung 1 component UI tái sử dụng để tránh trùng lặp code.

---

### Quyết định 3: Phê duyệt danh sách gỡ bỏ 30+ Packages không sử dụng trong `package.json`
- **Thực tế hiện tại**: Dự án có 14 gói `@radix-ui/*` không hề được import, cùng với nhiều thư viện như `react-hook-form`, `cmdk`, `vaul`, `zod`, `jassub`...
- **Khuyến nghị**: Cho phép gỡ bỏ toàn bộ danh sách 30+ package này khỏi `package.json` để tăng tốc độ cài đặt `npm install` và giảm dung lượng gói build installer từ ~250MB xuống mức tối ưu hơn.

---

## 4. KẾ HOẠCH KIỂM THỬ TÍCH HỢP SAU KHẮC PHỤC (REGRESSION TEST PLAN)

Sau khi hoàn thành từng Phase, kiểm toán viên sẽ thực thi quy trình kiểm chứng chuẩn hoá:
1. **Kiểm tra biên dịch tĩnh**:
   - `npx tsc --noEmit` -> Bắt buộc exit code 0.
   - `npm run build` -> Bắt buộc build thành công không lỗi.
2. **Kiểm thử huỷ tác vụ động (Dynamic Cancel Test)**:
   - Khởi chạy Export video -> Bấm Huỷ -> Kiểm tra `Get-Process ffmpeg` trên PowerShell phải rỗng.
   - Bấm Tải video URL -> Bấm Huỷ -> Kiểm tra `Get-Process yt-dlp` phải rỗng.
3. **Kiểm thử toàn vẹn dữ liệu (Data Integrity Test)**:
   - Dịch lại video -> Kiểm tra thư mục `tts_audio` cũ đã bị dọn dẹp, không còn tồn đọng file audio của ngôn ngữ trước.
4. **Kiểm tra trạng thái Git**:
   - Chỉ các file trong kế hoạch được phép thay đổi, không có code thừa hay debug logs vương vãi.
