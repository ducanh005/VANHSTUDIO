# AI Video Studio Engine - Kiến Trúc & Quy Chuẩn Kỹ Thuật (Vanhsub)

> **Tài liệu đặc tả kiến trúc, quy chuẩn dữ liệu và lộ trình phát triển cho phân hệ "AI Video Studio" trên ứng dụng Vanhsub.**  
> *Bao gồm 2 chế độ hoạt động: AI Tự Sản Xuất (One-Click Auto Pipeline) và Người Dùng Tự Workflow (Custom Semi-Auto Studio), kèm hệ thống cấu hình độc lập.*

---

## 📌 1. TỔNG QUAN HỆ THỐNG (SYSTEM OVERVIEW)

Tính năng **AI Video Studio** mở rộng Vanhsub từ một công cụ tạo phụ đề/dịch thuật đơn thuần thành một **xưởng sản xuất video tự động toàn diện**. Hệ thống tích hợp trực tiếp 4 công nghệ lõi sẵn có trong Vanhsub:

1. **LLM Engine (OpenAI / DeepSeek SDK)**: Tạo ý tưởng, viết kịch bản, chấm điểm retention và sinh visual prompt.
2. **TTS & Alignment Engine (`msedge-tts` / `nodejs-whisper`)**: Tổng hợp giọng đọc tiếng Việt chất lượng cao và đồng bộ mốc thời gian (timestamp word-boundary).
3. **Google Flow Automation Engine (Playwright/Electron Browser Mutex)**: Tự động hóa sinh ảnh/video theo từng phân cảnh từ Google Flow.
4. **Video Assembly Engine (`fluent-ffmpeg`)**: Ghép giọng đọc, ảnh/video, hiệu ứng chuyển động Ken Burns, nhạc nền (BGM) và phụ đề động.

---

## 🏗️ 2. THIẾT KẾ ĐIỀU HƯỚNG & PHÂN HỆ (UI/UX STRUCTURE)

Tại Sidebar chính của Vanhsub, bổ sung phân hệ **"AI Studio"** (hoặc **"Xưởng Video AI"**), bên trong chia làm 2 chế độ độc lập và 1 tab Cấu hình riêng:

```
Vanhsub Sidebar
 ├── 🎬 Video Subtitle (Tính năng hiện tại)
 ├── 🤖 AI Video Studio (MỚI)
 │    ├── ⚡ AI Tự Sản Xuất (Auto-Pilot Pipeline)
 │    ├── 🎛️ Tự Sản Xuất / Can Thiệp Từng Bước (Custom Workflow Studio)
 │    └── ⚙️ Cấu Hình AI Studio (Dedicated Settings)
 └── 🔀 Workflow Canvas (Graph Node Engine - Sẽ tích hợp ở giai đoạn sau)
```

---

## ⚡ 3. CHẾ ĐỘ 1: AI TỰ SẢN XUẤT (ONE-CLICK AUTO-PILOT)

### 3.1. Mục tiêu
Người dùng chỉ cần nhập một dòng chủ đề (hoặc dán liên kết/dữ kiện nguồn), bấm **"Bắt đầu sản xuất"** và hệ thống tự động thực thi chuỗi 8 bước khép kín cho đến khi ra video thành phẩm.

### 3.2. Bảng Theo Dõi Tiến Độ Sản Xuất (8-Step Pipeline Tracker)

Giao diện hiển thị thanh trạng thái thời gian thực tương tự mô hình sản xuất chuyên nghiệp:

| Bước | Tên Công Đoạn | Công Nghệ Thực Thi | Kết Quả Đầu Ra (Artifact) | Trạng Thái |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Dữ kiện (Source/Idea)** | LLM Prompt Blueprint | Phân tích tệp dữ kiện, xác định góc nhìn & Hook | `pending` $\rightarrow$ `success` |
| **2** | **Kịch bản (Script)** | DeepSeek / OpenAI / **ChatGPT Web** / **Gemini Web** (0₫ API) | Kịch bản cấu trúc theo nhịp (câu ngắn, hook, outro) | `pending` $\rightarrow$ `success` |
| **3** | **Lồng tiếng (Voice)** | `msedge-tts` (Edge TTS) | File audio `voiceover.mp3` | `pending` $\rightarrow$ `success` |
| **4** | **Trích xuất Time** | Word-boundary / Whisper | Mốc thời gian chính xác từng câu/từ (JSON) | `pending` $\rightarrow$ `success` |
| **5** | **Storyboard** | LLM Prompt Splitter | Bảng danh sách phân cảnh kèm Visual Prompt | `pending` $\rightarrow$ `success` |
| **6** | **Ảnh / Video** | **Google Flow Engine** | Thư mục ảnh/clip sinh tự động theo tỷ lệ | `pending` $\rightarrow$ `success` |
| **7** | **Dựng phim (Render)**| `fluent-ffmpeg` | Video hoàn chỉnh ghép audio + visual + sub | `pending` $\rightarrow$ `success` |
| **8** | **SEO & Xuất bản** | LLM Metadata Engine | Tiêu đề giật tít, mô tả, hashtag, thumbnail | `pending` $\rightarrow$ `success` |

### 3.3. Cơ chế Khôi Phục & Phòng Vệ (Fail-Safe)
* Nếu bước sinh ảnh/video qua Google Flow bị gián đoạn (captcha, mạng chập chờn): Hệ thống tự lưu checkpoint, không chạy lại bước Kịch bản hay Lồng tiếng, cho phép người dùng bấm **"Tiếp tục"** tại đúng bước lỗi.

---

## 🎛️ 4. CHẾ ĐỘ 2: NGƯỜI DÙNG TỰ WORKFLOW (CUSTOM WORKFLOW STUDIO)

### 4.1. Mục tiêu
Dành cho người sáng tạo nội dung cần kiểm soát 100% chất lượng sản phẩm. Cho phép can thiệp, chỉnh sửa, nghe thử và tạo lại ở bất kỳ khâu nào trước khi dựng phim.

### 4.2. Các Tab Chức Năng Chi Tiết

#### Tab 1: Kịch bản & Giọng Đọc (Script & Voiceover)
* **Trình soạn thảo kịch bản theo dòng thời gian:**
  * Chia nhỏ kịch bản thành từng câu kèm mốc `0:00`, `0:03`...
  * Cho phép bấm vào từng câu để sửa văn bản trực tiếp.
* **Bộ điều khiển giọng đọc:**
  * Trình phát âm thanh xem trước (`Audio Player`) toàn bộ bản lồng tiếng.
  * Nút **"Tạo lại giọng"** (cho cả bài hoặc cho riêng từng câu đã chỉnh sửa).
  * Nút **"Trích xuất lại Time"** (cập nhật lại alignment khi sửa nội dung câu).
* **Đánh giá kịch bản (Script Quality Audit):**
  * Nút **"Chấm điểm kịch bản"** dựa trên tiêu chí giữ chân khán giả (Hook 5 giây đầu, Retention loop, Call to action).

#### Tab 2: Phân Cảnh Trực Quan (Visual Storyboard)
* **Danh sách Card phân cảnh:** Mỗi card tương ứng một câu thoại trong kịch bản.
  * Hiển thị thời gian bắt đầu - kết thúc của cảnh.
  * Ô soạn thảo **Prompt sinh ảnh (Visual Prompt)** bằng tiếng Anh (AI dịch tự động từ câu thoại tiếng Việt).
  * Nút **"Sinh lại ảnh"** (gọi Google Flow Engine chỉ sinh lại riêng phân cảnh đó).
  * Nút **"Tải ảnh thủ công"** (cho phép người dùng upload ảnh riêng của họ thay thế).
  * Lựa chọn loại phân cảnh: `Ảnh tĩnh + Ken Burns (Zoom/Pan)` hoặc `Video chuyển động`.

#### Tab 3: Dựng Phim & Studio Editor
* **Tùy biến phụ đề động:**
  * Chọn kiểu hiển thị: Phụ đề Karaoke nhảy chữ, phụ đề nổi bật từng từ (Word-by-word highlight), hoặc phụ đề khối tiêu chuẩn.
  * Font chữ, kích thước, màu viền, bóng đổ, vị trí (Top/Center/Bottom).
* **Hiệu ứng chuyển động & Nhạc nền (BGM):**
  * Hiệu ứng chuyển động ảnh: Slow Zoom In, Slow Zoom Out, Pan Left/Right, Cross Dissolve.
  * Thư viện nhạc nền: Chọn file nhạc nền, chỉnh âm lượng BGM (tự động nhỏ tiếng khi có giọng đọc - Audio Ducking).
* **Xem trước thời gian thực (Live Preview Player):**
  * Tích hợp `react-player` kết hợp lớp phụ đề `jassub` để xem trước video trước khi bấm xuất file.

---

## ⚙️ 5. CẤU HÌNH RIÊNG BIỆT (DEDICATED AI STUDIO CONFIGURATION)

Để không làm ảnh hưởng đến cấu hình chung của Vanhsub, phân hệ AI Studio sở hữu một kho dữ liệu cấu hình riêng biệt (`aiStudioSettings` lưu trong `main/store/aiStudioStore.ts`).

### 5.1. Schema TypeScript Chi Tiết

```typescript
export interface AiStudioConfig {
  // 1. LLM Settings (Kịch bản & Phân tích)
  llm: {
    provider: 'deepseek' | 'openai' | 'custom' | 'chatgpt_web' | 'gemini_web';
    apiKey: string;
    model: string;              // vd: 'deepseek-chat', 'gpt-4o', 'chatgpt_web', 'gemini_web'
    baseUrl?: string;           // Hỗ trợ custom endpoint / proxy
    temperature: number;        // 0.2 (chính xác) - 0.7 (sáng tạo)
    systemPromptPreset: string; // 'youtube_story', 'tiktok_short', 'affiliate_sales'
    chatgptWebMode?: 'offscreen' | 'visible'; // Chế độ Tiết kiệm ChatGPT: Chạy ngầm hoặc Xem trực tiếp
    geminiWebMode?: 'offscreen' | 'visible';  // Chế độ Tiết kiệm Gemini: Chạy ngầm hoặc Xem trực tiếp
  };

  // 2. TTS & Voice Settings (Giọng đọc & Lồng tiếng)
  voice: {
    provider: 'edge_tts' | 'local_onnx';
    voiceId: string;            // vd: 'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural'
    rate: string;               // Tốc độ: '-5%', '0%', '+10%'
    pitch: string;              // Cao độ: '+0Hz', '-2Hz'
    volume: string;             // '+0%'
    autoWordAlignment: boolean; // Tự động trích xuất timestamp từng từ
  };

  // 3. Google Flow Engine Settings (Sinh Ảnh & Video)
  flowEngine: {
    aspectRatio: '16:9' | '9:16' | '1:1';
    outputMode: 'image' | 'video';
    stylePromptPrefix: string;  // vd: "Cinematic, 8k, photorealistic, octane render"
    negativePrompt: string;     // vd: "blurry, low quality, deformed, text"
    outputsPerScene: 1 | 2 | 4; // Số lượng biến thể sinh mỗi cảnh
    downloadDir: string;        // Thư mục lưu trữ assets sinh ra
    concurrency: number;        // Số task sinh song song (khuyến nghị: 1)
  };

  // 4. Video Assembly & Rendering (Dựng phim FFmpeg)
  rendering: {
    resolution: '1080p' | '720p' | '4k';
    fps: 30 | 60;
    kenBurnsEffect: boolean;    // Bật/tắt hiệu ứng chuyển động ảnh tĩnh
    kenBurnsScale: number;      // Tỷ lệ zoom (vd: 1.15)
    transitionDuration: number; // Thời gian chuyển cảnh (giây, vd: 0.5)
    defaultBgmPath?: string;    // Đường dẫn nhạc nền mặc định
    bgmVolume: number;          // 0.05 - 0.20 (âm lượng nhạc nền)
    autoAudioDucking: boolean;  // Tự động hạ âm lượng nhạc nền khi có tiếng nói
  };

  // 5. Subtitle Styling (Đặc tính phụ đề gắn liền video)
  subtitles: {
    enabled: boolean;
    preset: 'tiktok_bold' | 'minimalist' | 'classic_bar' | 'karaoke_glow';
    fontSize: number;
    primaryColor: string;
    outlineColor: string;
    outlineWidth: number;
    positionY: number;          // Vị trí theo % chiều cao màn hình (vd: 85%)
  };
}
```

### 5.2. Giá Trị Mặc Định (Default Values)

```json
{
  "llm": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "temperature": 0.6,
    "systemPromptPreset": "youtube_story"
  },
  "voice": {
    "provider": "edge_tts",
    "voiceId": "vi-VN-HoaiMyNeural",
    "rate": "+0%",
    "pitch": "+0Hz",
    "autoWordAlignment": true
  },
  "flowEngine": {
    "aspectRatio": "16:9",
    "outputMode": "image",
    "stylePromptPrefix": "Cinematic lighting, high resolution, detailed photorealistic, 4k",
    "negativePrompt": "watermark, text, blurry, distortion, lowres",
    "outputsPerScene": 1,
    "concurrency": 1
  },
  "rendering": {
    "resolution": "1080p",
    "fps": 30,
    "kenBurnsEffect": true,
    "kenBurnsScale": 1.15,
    "transitionDuration": 0.5,
    "bgmVolume": 0.12,
    "autoAudioDucking": true
  },
  "subtitles": {
    "enabled": true,
    "preset": "tiktok_bold",
    "fontSize": 24,
    "primaryColor": "#FFFFFF",
    "outlineColor": "#000000",
    "outlineWidth": 3,
    "positionY": 80
  }
}
```

---

## 🔀 6. KẾT NỐI VỚI HỆ THỐNG WORKFLOW GRAPH (GIAI ĐOẠN SAU)

Phân hệ AI Studio được thiết kế với kiến trúc mô-đun hóa cao (Modular Architecture). Các công đoạn trong pipeline 8 bước tương ứng trực tiếp với các Node trong hệ thống `@xyflow/react` của Vanhsub:

* `Node_LLM_Script`: Nhận Idea/Source $\rightarrow$ Xuất Script JSON.
* `Node_TTS_Voice`: Nhận Text $\rightarrow$ Xuất Audio + Word Timestamps.
* `Node_Storyboard_Splitter`: Nhận Script + Time $\rightarrow$ Xuất Scene List.
* `Node_GoogleFlow_Batch`: Nhận Scene Prompts $\rightarrow$ Gọi Browser Engine tải ảnh/video.
* `Node_FFmpeg_Assembler`: Nhận Video/Ảnh + Audio + Subtitles $\rightarrow$ Xuất MP4.

*Ghi chú: Khi bước vào giai đoạn xây dựng Canvas kéo thả, toàn bộ logic đã viết cho phân hệ AI Studio sẽ được tái sử dụng 100% dưới dạng các Node execution handlers.*

---

## 📅 7. LỘ TRÌNH TRIỂN KHAI ĐỀ XUẤT

1. **Sprint 1 (Khung Cấu Hình & Store)**:
   - Tạo `aiStudioStore.ts` ở `main/store` và `renderer/lib/store`.
   - Xây dựng giao diện Tab Cấu Hình riêng cho AI Studio.
2. **Sprint 2 (Pipeline Service Backend)**:
   - Xây dựng `AiStudioPipelineService` điều phối lần lượt: LLM $\rightarrow$ EdgeTTS $\rightarrow$ Alignment $\rightarrow$ Google Flow Task $\rightarrow$ FFmpeg.
3. **Sprint 3 (Giao diện AI Tự Sản Xuất - Mode 1)**:
   - Màn hình nhập ý tưởng + Thanh tiến độ 8 bước trực quan.
4. **Sprint 4 (Giao diện Can Thiệp Từng Bước - Mode 2)**:
   - 3 Tab: Kịch bản & Giọng, Phân cảnh Visual, Dựng phim & Xem trước.
5. **Sprint 5 (Tích hợp vào Workflow Canvas chung)**.
