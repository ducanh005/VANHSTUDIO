# Robust, State-Based, Self-Healing Browser Automation Engine cho Google Flow
> **Tài liệu theo dõi tiến độ, kiến trúc và quy chuẩn tái cấu trúc toàn diện.**
> **Bắt buộc đọc trước mỗi phiên làm việc để xác định chính xác Phase hiện tại và các nguyên tắc bất di bất dịch.**

---

## 📌 BẢNG ĐIỀU KHIỂN TIẾN ĐỘ (CURRENT STATUS)

| Hạng mục | Trạng thái | Ghi chú / Chi tiết |
| :--- | :--- | :--- |
| **Phase hiện tại** | **PHASE 4: Self-Healing Element Finder (Cơ bản)** | Đang ở khâu nghiệm thu thực tế |
| **Trạng thái Code Phase 4** | 🟢 **HOÀN THÀNH 100%** | Đã tích hợp Container-Scoped Search & Short-Text Confidence Cap |
| **Test Phòng Vệ Phase 4** | 🟢 **ĐÃ CHẠY THẬT & ĐẠT 100%** | Test 1: Container Scope, Test 2: Low-conf rejection, Test 3: Fallback Aspect Ratio |
| **Test Live Sinh Ảnh Phase 4** | 🟡 **ĐANG CHỜ PHIÊN GOOGLE** | Đã chuẩn bị sẵn `run_phase4_live.bundle.js`; chờ User đăng nhập Google Sảnh để chạy Live |
| **Phase tiếp theo** | **PHASE 5: Recovery Manager** | ⛔ **CẤM TỰ ĐỘNG CHUYỂN KHI CHƯA ĐƯỢC DUYỆT PHASE 4** |

---

## ⚖️ CÁC NGUYÊN TẮC BẤT DI BẤT DỊCH (CORE PRINCIPLES)

1. **DỪNG LẠI SAU MỖI PHASE**: Tuyệt đối không tự ý chuyển sang Phase tiếp theo dù việc code có vẻ thuận lợi. Phải dừng lại, báo cáo kết quả và chờ User phê duyệt chính thức.
2. **CHỨNG MINH BẰNG CHẠY THẬT (NO MOCK)**:
   - Không suy luận trên lý thuyết hay dựa vào việc "code không throw lỗi".
   - Bắt buộc chạy thật trên Electron và Google Flow (chấp nhận tốn credit tối thiểu để kiểm chứng).
   - Phải cung cấp Log Thật đầy đủ thể hiện rõ ràng các state, toạ độ, confidence score, duration và verify data.
3. **BÁO CÁO TRUNG THỰC**: Khi chạy thử gặp lỗi (timeout, crash, redirect, session expired...), phải báo cáo trung thực nguyên nhân gốc rễ, không che giấu hoặc coi là đạt.
4. **THAY ĐỔI TỐI THIỂU (MINIMAL REGRESSION RISK)**:
   - Thay đổi ít file nhất có thể trong mỗi Phase.
   - Đối chiếu kỹ với kiến trúc đã có (`GoogleFlowBrowserMutex`, `ensureCleanCanvasReady`, `sendInputEvent`, snapshot baseline + time gate), không đập đi xây lại cái đang chạy tốt.
5. **ZERO FALSE-CLICK**:
   - **Container-Scoped Search**: Tier 3 (`CONTEXTUAL`) và Tier 4 (`TEXT_MATCH`) bắt buộc phải có `containerSelector`, cấm tuyệt đối quét toàn trang (`document-wide`).
   - **Short-Text Confidence Cap**: Tất cả các text match ngắn $\le 2$ ký tự (`text:1`, `text:2`, `text:x1`, `text:Tune`...) phải hạ `baseConfidence: 55` (< 65 Threshold an toàn) để hệ thống từ chối click (`low_confidence`) thay vì click bừa.

---

## 🗺️ LỘ TRÌNH 10 PHASE CHI TIẾT & TRẠNG THÁI

### ✅ Phase 1: Audit Kiến Trúc & Luồng Hiện Tại
- **Trạng thái**: **ĐÃ HOÀN THÀNH**
- **Nội dung**: Phân tích hiện trạng codebase, đối chiếu các điểm yếu: Coordinate drift, fixed sleep, single selectors, thiếu verify sau action, rủi ro duplicate generation khi crash. Chốt lộ trình chuẩn 10 Phase.

### ✅ Phase 2: State Machine + Verify-After-Action + Idempotency
- **Trạng thái**: **ĐÃ HOÀN THÀNH & ĐÃ ĐƯỢC DUYỆT**
- **Nội dung**:
  - Triển khai State Machine 18 states tường minh (`OPEN_FLOW` $\rightarrow$ `COMPLETE`).
  - Mọi state đều có `enter()`, `execute()`, `verify()` (log dữ liệu thực tế đọc được, không chỉ in tick).
  - Tích hợp Idempotency check (`CHECK_IDEMPOTENCY_BEFORE_GENERATE`) ngăn chặn 100% duplicate click khi retry.
  - Tính toán lại toạ độ `getBoundingClientRect()` ngay trước thời điểm gửi `sendInputEvent` (chống coordinate drift).
  - Bằng chứng thực tế: Đã chạy sinh ảnh thật 51s, log xác nhận đầy đủ 18/18 state.

### ✅ Phase 3: Smart Wait + Element Stability Check
- **Trạng thái**: **ĐÃ HOÀN THÀNH & ĐÃ ĐƯỢC DUYỆT**
- **Nội dung**:
  - Loại bỏ hoàn toàn các `sleep(Nms)` cố định, thay bằng chờ theo điều kiện adaptive polling (500ms $\rightarrow$ 750ms $\rightarrow$ 1s).
  - Kiểm tra 5 lớp trước khi click: Tồn tại, Visible, Enabled, Unobscured (không bị che), Bounding box ổn định (sai số $\le 1$px qua 2 frame).
  - Bằng chứng thực tế: Adversarial test 5 kịch bản (17/17 candidates tried, rơi tầng chuẩn xác), sửa lỗi cold-start cookie restoration RFC 6265 chống redirect `/about`.

### 🟡 Phase 4: Self-Healing Element Finder (Cơ Bản)
- **Trạng thái**: **ĐANG THỰC HIỆN (Code & Unit Test đã xong, Chờ Live Run)**
- **Nội dung**:
  - Chuẩn hoá bộ quy tắc tìm kiếm 4 Tiers (`ACCESSIBILITY` $\rightarrow$ `STRICT_COMPONENT` $\rightarrow$ `CONTEXTUAL` $\rightarrow$ `TEXT_MATCH`) có Confidence Scoring cho các tương tác còn lại:
    - Aspect Ratio (16:9, 9:16, 1:1, 4:3, 3:4)
    - Output Count (x1, x2, x4)
    - Mode Tab (Image / Video)
    - Settings Trigger Button
    - New Project Button
    - Clear Canvas Button & Close Overlay Button
  - **2 Điều chỉnh kiến trúc mới nhất**: Container-Scoped Search và Short-Text Confidence Cap (55 < 65).
  - Bằng chứng thực tế: Bộ 3 bài test xác minh toàn diện đã chạy thành công trên Electron:
    1. Container Scoping: Bỏ qua mồi nhử ngoài container, bắt đúng trong container.
    2. Short-Text Cap: Từ chối click `text:1` khi score = 62 < 65 (`error: low_confidence`).
    3. Adversarial Fallback: Ép hỏng Tier 1 Aspect Ratio, rơi xuống Tier 2 (`STRICT_COMPONENT`) an toàn (conf: 95/100).
  - **Việc cần hoàn tất**: Chạy 1 Live Run sinh ảnh thật trên Google Flow với tài khoản Google đã đăng nhập.

### ⏳ Phase 5: Recovery Manager + Overlay Detector + Page State Detector
- **Trạng thái**: **CHƯA BẮT ĐẦU (Chờ duyệt Phase 4)**
- **Nội dung**:
  - `PageStateDetector`: `FLOW_HOME`, `FLOW_EDITOR`, `LOGIN_PAGE`, `UNKNOWN_PAGE`...
  - `RecoveryManager`: Tự động đóng overlay chắn, xử lý panel Tác nhân, pause an toàn khi gặp popup lạ.
  - Bằng chứng yêu cầu: Test phục hồi từ overlay chặn hoặc popup lỗi.

### ⏳ Phase 6: Retry Manager + Error Classification
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Phân loại lỗi tập trung (`RETRYABLE` vs `NON_RETRYABLE`), exponential backoff kết hợp idempotency context.

### ⏳ Phase 7: Task Queue + Checkpoints Resume
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Lưu checkpoint sau các state quan trọng (`GENERATION_STARTED`, `GENERATION_COMPLETED`), cho phép khôi phục luồng sau crash mà không tạo trùng lặp ảnh.

### ⏳ Phase 8: Debugging / Observability + Download Verification
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Tự động xuất debug bundle (screenshot, DOM snapshot, action-log) khi fail mà không làm lộ cookie/token. Verify tính toàn vẹn của file tải về.

### ⏳ Phase 9 (Tuỳ chọn): Element Memory / Learning + Visual Fallback
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Chỉ triển khai nếu qua các phase trước đã thấy rõ nhu cầu thực sự. Element Memory lưu metadata tỉ lệ thành công/thất bại theo selector. Visual fallback chỉ dùng khi DOM/accessibility đều thất bại.

### ⏳ Phase 10: Stress Test Toàn Bộ
- **Trạng thái**: **CHƯA BẮT ĐẦU**
- **Nội dung**: Chạy workflow dài nhiều node nối tiếp thật trên Google Flow để kiểm chứng tính bền bỉ tổng thể.

---

## 📂 DANH MỤC FILE TRỌNG TÂM CỦA BROWSER ENGINE

```
VANHSUB/
├── FLOW_ENGINE_README.md                    <-- FILE NÀY (Bản đồ tiến độ & quy chuẩn)
├── main/
│   ├── veo/
│   │   └── GoogleVeoSessionManager.ts       <-- Quản lý Session, Mutex, Browser Window, Cookie
│   └── workflow/
│       └── flow-engine/
│           ├── FlowStateMachine.ts          <-- Engine State Machine lõi (18 States)
│           ├── FlowElementFinder.ts         <-- Bộ tìm kiếm phần tử đa tầng (4 Tiers, Confidence Scoring)
│           ├── types.ts                     <-- Khai báo Type, Search Spec, Candidate, State Context
│           ├── states/
│           │   └── FlowImageGenerationStates.ts <-- Hiện thực chi tiết từng State (enter, execute, verify)
│           └── checkpoints/                 <-- Lưu trữ checkpoint State Machine (Phase 7)
└── scratch/                                 <-- Các kịch bản test runner và file kiểm chứng
    ├── test_phase4_verified.ts              <-- Bộ 3 test kiểm chứng Container Scoping & Confidence Cap
    ├── open_lobby_for_login.ts              <-- Script mở Sảnh hỗ trợ người dùng đăng nhập & bắt cookie
    └── run_phase4_live.ts                   <-- Kịch bản chạy thật sinh ảnh Phase 4 trên Google Flow
```

---

## 🛠️ HƯỚNG DẪN CHO AGENT / DEVELOPER TRƯỚC MỖI PHIÊN CODE

1. Mở file `FLOW_ENGINE_README.md` này để xác định Phase hiện tại.
2. Kiểm tra phần **BẢNG ĐIỀU KHIỂN TIẾN ĐỘ**: Tuyệt đối không nhảy cóc sang Phase tiếp theo nếu Phase hiện tại chưa có xác nhận duyệt bằng văn bản từ User.
3. Bất kỳ thay đổi nào liên quan đến tìm kiếm selector mới phải tuân theo 2 quy tắc: **Container-Scoped** và **Short-Text Confidence Cap < 65**.
4. Mọi bằng chứng nghiệm thu bắt buộc phải là log thật xuất ra từ tiến trình Electron.
