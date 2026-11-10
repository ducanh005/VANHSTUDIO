# Spec: Pipeline Tự Động Sản Xuất Video (Browser Automation qua AI Studio Flow)

## 0. Mục tiêu

Xây dựng agent tự động hoá toàn bộ quy trình sản xuất video ngắn, từ dữ kiện đầu vào đến khi ra ảnh/video thành phần, thao tác trực tiếp trên trình duyệt (tab AI Studio → Flow) một cách **ổn định, không xung đột trạng thái DOM, có thể retry và log lại từng bước**.

Pipeline gồm 6 giai đoạn nối tiếp:

```
Dữ kiện → Kịch bản → Lồng tiếng → Trích xuất time → Storyboard → Ảnh/Vid
```

Mỗi giai đoạn có input/output rõ ràng, ghi ra file trung gian, để giai đoạn sau không phụ thuộc vào việc giữ trạng thái trong RAM của agent — tránh mất dữ liệu khi có lỗi giữa chừng và cho phép resume từ bất kỳ bước nào.

---

## 1. Nguyên tắc thiết kế chung (áp dụng cho toàn bộ pipeline)

### 1.1. Source of truth luôn là local disk, không phải DOM

Trình duyệt/Flow chỉ là "công cụ thực thi", không phải nơi lưu trạng thái. Sau mỗi bước sinh ra dữ liệu (text, audio, ảnh, video), agent phải:
1. Trích xuất/tải kết quả về local ngay lập tức.
2. Ghi vào cấu trúc thư mục + file index (metadata) có ID nhất quán xuyên suốt pipeline.
3. Không bao giờ dựa vào việc "phần tử thứ N trong danh sách trên web vẫn còn đúng vị trí" ở bước sau — vì Flow có thể re-render, phân trang, hoặc đổi thứ tự.

### 1.2. Cấu trúc thư mục & ID xuyên suốt

```
/project/{project_id}/
  00_facts/facts.json
  01_script/script.json
  02_voice/
    scene_01.mp3
    scene_02.mp3
    ...
  03_timing/timing.json
  04_storyboard/storyboard.json
  05_media/
    scene_01_img_v1.png
    scene_01_vid_v1.mp4
    scene_02_img_v1.png
    ...
  index.json   <-- metadata tổng, map scene_id -> trạng thái + đường dẫn từng loại asset
```

`scene_id` được sinh từ bước Kịch bản/Trích xuất time và giữ nguyên xuyên suốt. Mọi file, mọi bước upload lại, mọi log đều tham chiếu qua `scene_id`, không qua tên hiển thị trên UI.

### 1.3. Cơ chế click an toàn (Visual Settle + Highlight)

Trước khi agent bấm bất kỳ phần tử nào trên Flow:

1. Xác định bounding box của element (qua selector DOM hoặc toạ độ nếu dùng computer-vision).
2. Vẽ overlay hình vuông/khung highlight đè lên đúng vị trí đó trong ~200–400ms.
3. Trong lúc chờ, kiểm tra lại bounding box lần 2 — nếu lệch so với lần 1 (trang đang re-render/animate) thì **không click**, chờ ổn định rồi đo lại.
4. Khi vị trí đã ổn định 2 lần đo liên tiếp → dispatch click thật.
5. Xoá overlay, ghi log: `{action, selector/coords, scene_id, timestamp, retry_count}`.

Đây là kỹ thuật "confirm-before-act" giúp tránh trường hợp bấm nhầm khi trang đang loading/animate — nguyên nhân chính gây "giật, xung đột" mà bạn thấy ở app hiện tại.

### 1.4. Cơ chế chờ kết quả generate (Polling, không đoán thời gian)

Không dùng `sleep(x giây)` cố định. Thay vào đó:
- Theo dõi network response (nếu bắt được API call của Flow) HOẶC
- Poll DOM để tìm dấu hiệu hoàn tất (nút "Download" xuất hiện, spinner biến mất, thumbnail đổi từ placeholder sang ảnh thật)
- Timeout tối đa (vd 90s cho ảnh, 300s cho video) → nếu quá thời gian, log lỗi và retry toàn bộ step đó tối đa N lần trước khi báo fail lên user.

### 1.5. Idempotency & Resume

Mỗi lần chạy lại step nào đó, agent kiểm tra `index.json` trước:
- Nếu asset của `scene_id` này đã tồn tại và hợp lệ (checksum/size > 0) → skip, không generate lại.
- Nếu user chủ động yêu cầu regenerate → tạo version mới (`_v2`, `_v3`...) thay vì ghi đè, để giữ lịch sử và cho phép rollback.

---

## 2. Chi tiết từng giai đoạn

### Giai đoạn 1 — Dữ kiện (Facts)

**Input:** Chủ đề/nội dung do user cung cấp (text, link, file).
**Xử lý:** Trích xuất, chuẩn hoá thành danh sách sự kiện/ý chính có cấu trúc.
**Output:** `00_facts/facts.json`

```json
{
  "project_id": "proj_2026_0918_01",
  "topic": "...",
  "facts": [
    {"id": "f1", "content": "..."},
    {"id": "f2", "content": "..."}
  ]
}
```

Không có thao tác browser ở bước này (thường xử lý qua text model trực tiếp).

---

### Giai đoạn 2 — Kịch bản (Script)

**Input:** `facts.json`
**Xử lý:** Sinh kịch bản chia theo scene, mỗi scene có `scene_id`, lời thoại, mô tả hình ảnh sơ bộ (visual note).
**Output:** `01_script/script.json`

```json
{
  "scenes": [
    {
      "scene_id": "scene_01",
      "narration": "...",
      "visual_note": "..."
    }
  ]
}
```

`scene_id` sinh ra ở đây sẽ được dùng lại cho MỌI bước sau — đây là khoá chính của cả pipeline.

---

### Giai đoạn 3 — Lồng tiếng (Voice)

**Input:** `script.json` (trường `narration` từng scene)
**Xử lý qua browser (nếu TTS chạy trên web):**
1. Với mỗi scene: click ô nhập text → dùng cơ chế highlight (mục 1.3) → paste narration → bấm generate.
2. Poll cho tới khi audio sẵn sàng (mục 1.4).
3. Tải file audio về `02_voice/{scene_id}.mp3`.
4. Cập nhật `index.json`: `{scene_id: {voice_path, voice_duration_sec}}`.

**Lưu ý quan trọng:** `voice_duration_sec` đo được ở bước này chính là input bắt buộc cho bước Trích xuất time tiếp theo — không được bỏ qua việc đo lại duration thật của file audio (không dùng ước lượng theo số ký tự).

---

### Giai đoạn 4 — Trích xuất time (Timing Extraction)

**Input:** Các file audio trong `02_voice/` + `script.json`
**Xử lý:** Với mỗi scene, lấy duration thật (bằng cách đọc metadata file audio local, không phải từ UI web), tính mốc thời gian bắt đầu/kết thúc để ghép timeline tổng.

**Output:** `03_timing/timing.json`

```json
{
  "scenes": [
    {
      "scene_id": "scene_01",
      "start_sec": 0.0,
      "end_sec": 4.8,
      "duration_sec": 4.8
    }
  ],
  "total_duration_sec": 42.3
}
```

Bước này thuần xử lý local (đọc file audio bằng thư viện xử lý media), không cần thao tác browser.

---

### Giai đoạn 5 — Storyboard

**Input:** `script.json` + `timing.json`
**Xử lý:** Với mỗi scene, sinh mô tả hình ảnh chi tiết (prompt cho bước tạo ảnh/vid): bố cục, phong cách, nhân vật, camera angle, đồng bộ với `duration_sec` của scene đó (scene dài hơn có thể cần nhiều shot/ảnh hơn).

**Output:** `04_storyboard/storyboard.json`

```json
{
  "scenes": [
    {
      "scene_id": "scene_01",
      "duration_sec": 4.8,
      "shots": [
        {
          "shot_id": "scene_01_shot_1",
          "image_prompt": "...",
          "motion_note": "camera zoom in nhẹ, 3s"
        }
      ]
    }
  ]
}
```

Nếu 1 scene cần nhiều shot (ảnh/video con), `shot_id` = `{scene_id}_shot_{n}` — vẫn giữ nguyên tắc ID phân cấp rõ ràng, không trùng lặp.

---

### Giai đoạn 6 — Ảnh/Vid (Media Generation) ★ trọng tâm bạn hỏi

**Input:** `storyboard.json` (từng `shot_id` với `image_prompt`)
**Output:** File ảnh/video local trong `05_media/`, sẵn sàng cho bước dựng phim (ngoài phạm vi spec này).

#### 6.1. Luồng tạo ảnh

Với mỗi `shot_id`:

1. **Điều hướng đến khu vực tạo ảnh trên Flow** — dùng cơ chế highlight-before-click (1.3).
2. **Nhập prompt:**
   - Click vào ô input → highlight xác nhận đúng ô → clear nội dung cũ (nếu có) → paste `image_prompt`.
   - Verify: đọc lại giá trị trong ô input, so khớp với prompt đã gửi, tránh trường hợp paste vào nhầm ô do trang chưa kịp render.
3. **Bấm Generate** → poll trạng thái (1.4) tới khi ảnh xuất hiện.
4. **Tải ảnh về local:**
   - `05_media/{shot_id}_img_v1.png`
   - Ghi vào `index.json`: `{shot_id: {image_path, image_prompt_used, generated_at}}`
5. **Không thao tác tiếp trên ảnh này qua DOM.** Mọi bước sau (vd dùng ảnh này làm input để tạo video) đều load lại từ `image_path` local.

#### 6.2. Luồng tạo video từ ảnh (image-to-video)

Với mỗi `shot_id` đã có ảnh:

1. Điều hướng tới khu vực "tạo video từ ảnh" trên Flow.
2. **Upload ảnh:** mở dialog upload → **gõ thẳng đường dẫn file local** (`05_media/{shot_id}_img_v1.png`) vào ô đường dẫn của file picker, KHÔNG click chọn qua thumbnail trên trang web.
   - Đây chính là điểm bạn quan sát thấy ở app kia: tránh hoàn toàn rủi ro chọn nhầm ảnh do danh sách ảnh trên web bị lệch thứ tự/pagination.
3. Verify sau upload: so khớp tên file hiển thị trên UI (nếu có) hoặc file size với file local đã gửi, để chắc chắn đúng ảnh đã được nhận.
4. Nhập `motion_note` (nếu Flow hỗ trợ điều khiển chuyển động) → highlight-before-click cho từng option.
5. Bấm Generate video → poll trạng thái (thời gian chờ dài hơn ảnh, timeout đề xuất 300s).
6. Tải video về `05_media/{shot_id}_vid_v1.mp4`.
7. Cập nhật `index.json`: `{shot_id: {video_path, source_image_path, generated_at, duration_sec}}`.

#### 6.3. Kiểm tra chất lượng & đồng bộ thời lượng

- So sánh `video duration` thực tế (đọc metadata file mp4 local) với `duration_sec` yêu cầu từ storyboard/timing.
- Nếu lệch quá ngưỡng cho phép (vd ±15%) → đánh dấu `needs_review: true` trong index, KHÔNG tự ý loại bỏ hay cắt ghép — để bước dựng phim sau xử lý.

#### 6.4. Xử lý lỗi riêng cho giai đoạn Ảnh/Vid

| Tình huống lỗi | Cách xử lý |
|---|---|
| Element di chuyển giữa lúc đo và lúc click | Không click, đo lại, tối đa 3 lần rồi mới báo lỗi |
| Generate quá timeout | Retry lại toàn bộ shot đó tối đa 2 lần, sau đó dừng và báo user |
| Upload ảnh local thất bại (path sai/không tồn tại) | Kiểm tra `image_path` trong index trước khi upload; nếu file không tồn tại, quay lại bước 6.1 để tạo lại ảnh |
| Video generate ra nhưng duration lệch nhiều | Đánh dấu `needs_review`, không tự động retry vô hạn |
| Hai shot dùng trùng `shot_id` do lỗi sinh storyboard | Validate tính duy nhất của `shot_id` ngay khi đọc `storyboard.json`, dừng pipeline nếu phát hiện trùng |

---

## 3. Logging & Observability

Mỗi action thao tác trên browser (click, input, upload) ghi 1 dòng log dạng:

```json
{"ts": "2026-09-18T10:22:31Z", "scene_id": "scene_01", "shot_id": "scene_01_shot_1", "action": "click", "target": "generate_button", "retry": 0, "status": "ok"}
```

Log này giúp debug khi pipeline fail giữa chừng — biết chính xác bước nào, shot nào, click nào bị lỗi, không phải chạy lại từ đầu để tìm nguyên nhân.

---

## 4. Tóm tắt điểm khác biệt cốt lõi so với cách làm hiện tại của bạn

1. **Xác nhận vị trí trước khi click** (highlight + đo 2 lần) thay vì click thẳng theo selector tĩnh.
2. **Local disk là nguồn sự thật**, mọi bước sau load lại từ đường dẫn local, không dựa vào DOM đã render trước đó.
3. **Upload lại bằng đường dẫn file, không click chọn trên UI** — loại bỏ hoàn toàn rủi ro chọn nhầm ảnh khi danh sách trên web thay đổi thứ tự.
4. **Poll trạng thái thay vì sleep cố định.**
5. **ID xuyên suốt (`scene_id` → `shot_id`)** giữ nguyên từ Kịch bản đến Ảnh/Vid, mọi file/metadata đều tham chiếu qua ID này.
6. **Idempotent & resumable** — chạy lại không tạo trùng, có thể tiếp tục từ bất kỳ bước nào nếu bị gián đoạn.
