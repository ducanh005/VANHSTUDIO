# VanhStudio — Studio Phụ Đề, Lồng Tiếng & Sản Xuất Video AI

**VanhStudio** (trước đây là *VANHSUB*) là ứng dụng desktop trên Windows dành cho việc tự động tạo phụ đề từ giọng nói (ASR) và hình ảnh (OCR), hiệu đính phụ đề theo thời gian thực, dịch thuật ngữ cảnh bằng AI (Gemini), lồng tiếng đa giọng đọc (TTS & Dubbing), tách nhạc nền AI (Demucs) và xuất bản video chuyên nghiệp (Hardsub / Softsub / Kinetic ASS). Dự án được thiết kế & phát triển tối ưu cho tiếng Việt, phục vụ cho đồ án tốt nghiệp / đề án nghiên cứu.

---

## 🚀 Tính năng chính

1. **Tải & Nhập Video Đa Nguồn (Media Ingestion)**
   - Hỗ trợ kéo thả video/audio trực tiếp hoặc nhập từ đường dẫn URL (YouTube, TikTok, Douyin, Bilibili...) thông qua `yt-dlp` và trình phân tích luồng media tích hợp.
   - Quản lý tiến trình tải ngầm xuyên suốt các tab làm việc.

2. **Nhận dạng giọng nói (ASR) & Chế độ Lai (Hybrid ASR + OCR)**
   - Kết hợp **Faster-Whisper** (Python sidecar tốc độ cao, căn chỉnh word-level) và **Whisper.cpp** (`nodejs-whisper` chạy offline bằng C++).
   - Tự động phát hiện cấu hình phần cứng (RAM/CPU) để gợi ý model phù hợp (`tiny`, `base`, `small`, `medium`, `large`).
   - Hỗ trợ chia chunk thông minh cho audio thời lượng dài và chế độ **Hybrid Fusion** đối chiếu mốc âm thanh ASR với chữ hiển thị OCR.

3. **Quét phụ đề cứng bằng Dual-Engine OCR**
   - Kết hợp **PaddleOCR (RapidOCR PP-OCRv5)** qua ONNX Runtime và **Tesseract.js** chạy đa luồng.
   - Tuỳ chỉnh vùng quét (crop khung hình trực quan), tần suất lấy mẫu FPS, tự động khử nhiễu và gom dòng phụ đề trùng lặp.

4. **Màn hình hiệu đính phụ đề (Subtitle Editor)**
   - Xem trước video đồng bộ thời gian thực qua giao thức tuỳ chỉnh `vanhmedia://` (hỗ trợ HTTP 206 Range request & seek mượt mà).
   - Chỉnh sửa văn bản, tách/gộp câu (`Split` / `Merge`), hoàn tác (`Undo` / `Redo`), lọc dòng rác OCR và tinh chỉnh mốc thời gian nhanh (`±0.1s`, `±1s`, gán theo thời điểm phát).
   - **Tích hợp Gemini AI**: Đánh bóng câu văn, sửa lỗi chính tả/ngữ pháp và chuẩn hoá độ dài dòng (CPS).

5. **Dịch thuật Ngữ cảnh với Gemini AI**
   - Dịch toàn bộ phụ đề sang tiếng Việt hoặc đa ngôn ngữ qua Google Gemini API.
   - Cơ chế dịch theo batch kèm cửa sổ ngữ cảnh trượt (sliding window context), hỗ trợ **Từ điển thuật ngữ (Glossary)** và **Văn phong/Xưng hô** tuỳ chỉnh, lưu checkpoint tự động chống mất tiến trình.

6. **Lồng tiếng AI (TTS) & Đồng bộ Âm thanh (Dubbing)**
   - Tích hợp **Microsoft Edge Neural TTS**, **TikTok TTS** và **VietTTS** (Local Docker).
   - Cho phép gán giọng đọc riêng cho từng câu thoại, nghe thử trực tiếp và cache manifest thông minh.
   - **Đồng bộ Dubbing đa chế độ**: Nén tốc độ giọng đọc khớp timeline (`strict`), giãn khoảng lặng (`flexible`), hoặc kéo giãn khung hình video (`video-stretch`).
   - **Tách giọng & Giữ nhạc nền (Demucs AI)**: Tự động tách vocal gốc và giữ lại nhạc nền/hiệu ứng âm thanh dưới lời lồng tiếng mới.

7. **Xuất Video Chuyên Nghiệp (Video Render & Muxing)**
   - **Hardsub & Kinetic ASS**: Ghi cứng phụ đề vào khung hình với bộ tuỳ chỉnh kiểu chữ, màu sắc, hiệu ứng chuyển động kiểu CapCut, phụ đề song ngữ (Dual Subtitles), dải che mờ phụ đề cũ (`Mask / Blur Region`) và đóng dấu Watermark (Text/Logo).
   - **Softsub**: Đóng gói phụ đề mềm vào container MP4 (`mov_text`) tốc độ cao.

8. **AI Studio & Workflow AI (Mở rộng)**
   - Không gian sản xuất video tự động hoá theo kịch bản (Storyboard, Visual Generation, CapCut Draft Exporter) và trình thiết kế luồng xử lý dạng Node Graph.

---

## 🛠 Cấu trúc công nghệ (Tech Stack)

- **Framework**: [Electron](https://www.electronjs.org/) + [Next.js](https://nextjs.org/) (thông qua [nextron](https://github.com/saltyshiomix/nextron))
- **Language**: TypeScript
- **UI**: React 19, Tailwind CSS, Lucide Icons, Radix UI, XYFlow & Zustand
- **Audio/Video Processing**: `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`, `whisper.cpp`, `faster-whisper`, `demucs`
- **OCR Engine**: RapidOCR (PaddleOCR PP-OCRv5 ONNX) & `tesseract.js`
- **AI & TTS**: Google Gemini API, `msedge-tts`, TikTok TTS, VietTTS
- **Data Persistence & Security**: `electron-store`, Windows DPAPI (`safeStorage`)

---

## 📦 Hướng dẫn cài đặt & Khởi chạy

### Yêu cầu môi trường
- **Node.js**: `>= 18.x` (khuyến nghị Node 20/22 LTS)
- **Hệ điều hành**: Windows 10 / 11 (64-bit)
- **Python** *(tuỳ chọn)*: Python 3.10+ nếu sử dụng các sidecar nâng cao như Faster-Whisper, RapidOCR hoặc Demucs.

### Các bước khởi chạy môi trường Dev:

```bash
# 1. Di chuyển vào thư mục mã nguồn ứng dụng
cd VANHSUB

# 2. Cài đặt các thư viện phụ thuộc
npm install

# 3. Chạy ứng dụng ở chế độ phát triển (Development)
npm run dev
```

### Kiểm tra kiểu dữ liệu & Đóng gói ứng dụng (Production Build):

```bash
cd VANHSUB

# Kiểm tra TypeScript (Main & Renderer)
npm run build:main

# Đóng gói bộ cài đặt Windows (.exe)
npm run build
```
Bộ cài đặt Windows (`.exe`) sẽ được sinh ra tại thư mục `VANHSUB/dist/VanhStudio Setup 1.0.0.exe`.

---

## 📜 Nguồn tham khảo & Bản quyền

- Dự án được xây dựng mới hoàn toàn (không fork trực tiếp) dựa trên kiến trúc tham khảo luồng nghiệp vụ từ dự án mã nguồn mở **[SmartSub](https://github.com/buxuku/SmartSub)** (phát hành dưới giấy phép **MIT License**).
- **VanhStudio** tự triển khai độc lập toàn bộ các module xử lý data model, giao diện UI/UX riêng, bộ xử lý parser/serializer SRT/ASS, protocol handler custom `vanhmedia://`, hệ thống OCR kép, đồng bộ lồng tiếng và tích hợp Gemini API.
