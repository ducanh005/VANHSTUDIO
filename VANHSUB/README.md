# VanhStudio

**VanhStudio** — Ứng dụng desktop sản xuất video, chuyển giọng nói & hình ảnh thành phụ đề, dịch thuật ngữ cảnh và lồng tiếng AI, tối ưu cho nội dung tiếng Việt.

---

## 🛠 Công nghệ

- **Framework**: [Electron](https://www.electronjs.org/) + [Next.js](https://nextjs.org/) (thông qua [Nextron](https://github.com/saltyshiomix/nextron))
- **Giao diện**: React 19, Tailwind CSS, Lucide Icons, Radix UI, XYFlow & Zustand
- **Ngôn ngữ**: TypeScript
- **Xử lý âm thanh/video**: `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`, `whisper.cpp` (`nodejs-whisper`), `faster-whisper`, `demucs`
- **OCR Engine**: RapidOCR (PaddleOCR PP-OCRv5 ONNX) & `tesseract.js`
- **AI & TTS**: Google Gemini API, Microsoft Edge Neural TTS, TikTok TTS, VietTTS

---

## 📁 Cấu trúc thư mục dự án

```text
VANHSUB/
├── main/              # Mã nguồn Electron Main process (IPC, sidecar, flow engine, ASR/OCR)
├── renderer/          # Giao diện Next.js / React 19 (Editor, Studio, Components)
├── docs/              # Tài liệu dự án
│   ├── specs/         # Đặc tả kỹ thuật các module (Flow Engine, RPC specs...)
│   ├── archive/       # Tài liệu lưu trữ lịch sử, sprint PRD và work logs
│   └── *-evidence/    # Dữ liệu bằng chứng kiểm thử phục vụ đóng gói VM/Release
├── tests/             # Bộ kiểm thử tự động (Unit test, Downloader, RPC test)
├── scripts/           # Script tiện ích hỗ trợ build-check, release kit, local TTS
├── patches/           # Patch tuỳ chỉnh thư viện
└── extension/         # Extension trình duyệt phụ trợ
```

---

## 💻 Hướng dẫn phát triển & Kiểm thử

### 1. Cài đặt phụ thuộc

```bash
npm install
```

### 2. Chạy môi trường phát triển (Dev)

Khởi chạy đồng thời Next.js dev server và cửa sổ Electron desktop với cơ chế Hot Reload:

```bash
npm run dev
```

### 3. Kiểm tra kiểu & Bộ kiểm thử (Testing)

```bash
# Kiểm tra TypeScript cho Electron Main process
npm run build:main

# Kiểm tra build Next.js renderer & main-preload trong thư mục tạm
npm run build:check

# Chạy toàn bộ test suites chính (38 tests)
npm run test

# Chạy riêng bộ kiểm thử video downloader (16 tests)
npm run test:downloader
```

### 4. Đóng gói sản phẩm (Production Build)

```bash
# Đóng gói bản chạy thử không nén installer (unpacked directory)
npx electron-builder --dir

# Đóng gói bộ cài đặt hoàn chỉnh trên Windows (.exe)
npm run build
```

Bộ cài đặt sẽ được tạo tại thư mục `VANHSUB/dist/VanhStudio Setup 1.0.0.exe`.

---

## 📚 Tài liệu tham khảo

- **Tài liệu tổng quan dự án**: [`../README.md`](../README.md)
- **Lộ trình phát triển & Nhật ký**: [`../ROADMAP.md`](../ROADMAP.md)
- **Kiến trúc Flow Browser Automation Engine**: [`docs/specs/FLOW_ENGINE_README.md`](docs/specs/FLOW_ENGINE_README.md)
- **Tài liệu đặc tả các Phase**: [`docs/specs/`](docs/specs/)
- **Tài liệu lưu trữ lịch sử**: [`docs/archive/`](docs/archive/)
