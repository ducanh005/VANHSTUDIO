# VANHSUB — Worktree Merge Audit, 20/10/2026

> Báo cáo này chốt đợt tích hợp ở `3d0948e`. Phần rà soát ứng dụng sau đó có bản vá `80d19c0` về TTS regeneration/export; xem [báo cáo tiếp nối](docs/VANHSUB_APP_REVIEW_FOLLOWUP_20261020.md). Các số liệu integration dưới đây giữ phạm vi lịch sử của đợt đó.

## Kết quả và nhánh review

Đã kiểm tra toàn bộ branch/worktree Git đã đăng ký, đối chiếu nội dung và tích hợp chọn lọc phần còn thiếu. Không merge vào main, không push, không xóa branch/worktree/stash/file người dùng. Các thay đổi ở worktree cũ được giữ nguyên.

- Nhánh đích xác minh: `codex/integration-stabilization-20261015`, baseline **`226885583a3b9f8eedce4be02235629fb7ec750b`**; trùng remote-tracking tương ứng sau fetch.
- `origin/main`: **`a99b7d7`**, đã là tổ tiên của baseline. Local `main` **`df9d768`** là lịch sử phân kỳ cũ, không dùng làm baseline và không thay đổi nó.
- Nhánh review mới: **`codex/worktree-merge-audit-20261020`**, trong worktree mới `%USERPROFILE%/.codex/worktrees/worktree-merge-audit-20261020/DEAN/VANHSUB`.
- Commit mã nguồn/build cuối: **`d2e509ec70d665d17068597bd984f4826097e35e`**. Sau commit này chỉ thêm báo cáo này; tip cuối cùng bao gồm commit báo cáo, xác định chính xác bằng `git log -1 --format="%H %s" codex/worktree-merge-audit-20261020`.
- **Đủ điều kiện review kỹ thuật; UAT Electron của nhánh mới còn chờ.** Không nâng trạng thái Public Release hoặc gắn các PASS Beta cũ thành nghiệm thu runtime mới.

## Repository và bảo vệ dữ liệu

Git root lúc bắt đầu: `%USERPROFILE%/.codex/worktrees/e9b1/DEAN`; ứng dụng nằm trong `VANHSUB/`. Common Git directory: `D:/DEAN/DEAN/.git`.

Kiểm kê trước thay đổi: **8 worktree, 10 local branch, 6 remote-tracking branch**, cộng symbolic alias `origin/HEAD`; **0 stash**. Fetch không prune và không phát hiện ref remote thay đổi trong đợt này. Nhánh review/worktree mới được tạo thêm, không chuyển nhánh ở checkout cũ.

Lưu local: hash SHA-256 và tên/status/kích thước của toàn bộ file modified/untracked không bị ignore; binary diff unstaged/staged; HEAD từng worktree và hash các ref. Bản chụp nằm trong `temp/worktree-audit/snapshot-before/`, kết quả đối chiếu ở `temp/worktree-audit/preservation-final.json`. Đây là evidence local, không đưa vào commit.

Đối chiếu cuối: **466 file ban đầu giữ nguyên hash**, gồm 26 tracked modified và 440 untracked; HEAD cả 8 worktree cũ, toàn bộ 10 local branch/6 remote-tracking branch và stash giữ nguyên. Không commit thay file chưa commit của người dùng. Ignored dependencies, build/cache/media không được coi là mã nguồn chờ merge; không sao chép chúng vào Git. Các HAR, metadata tài khoản/project và bằng chứng runtime thô chỉ giữ nguyên tại chỗ.

## Worktree đã kiểm tra

Prefix C dưới đây là `%USERPROFILE%/.codex/worktrees/`; số M/U là tracked modified / untracked không bị ignore ở thời điểm chụp.

| Worktree | Branch/HEAD ban đầu | M/U | Quyết định |
|---|---|---:|---|
| `D:/DEAN/DEAN` | `codex/douyin-media-inspection` / `96da0ca` | 0/180 | Tính năng đã có bản tích hợp mới hơn; giữ script thử nghiệm, media và HAR ngoài nhánh review |
| `C:4a03/DEAN` | `codex/vanhsub-main-integration` / `c7a6a49` | 0/0 | Tổ tiên của baseline; không thiếu commit |
| `C:73dc/DEAN` | `codex/ai-studio-web-audit` / `347907d` | 0/0 | Đọc cả 11 commit riêng; port phần còn thiếu, giữ implementation mới hơn |
| `C:8668/DEAN` | detached `162f57c` | 0/0 | Đã có bằng ancestry, không cần tạo merge |
| `C:abd8/DEAN` | detached `447a41d` | 0/0 | Đã có bằng ancestry, không cần tạo merge |
| `C:c89f/DEAN` | `codex/flow-v2-m1` / `adc50a7` | 18/28 | Giữ nguyên toàn bộ; hoãn tích hợp migration Flow v2, lý do bên dưới |
| `C:douyin-main-integration/DEAN` | `codex/douyin-main-integration` / `a99b7d7` | 0/35 | Đã có bằng ancestry; phần còn lại là evidence kiểm thử |
| `C:e9b1/DEAN` | `codex/integration-stabilization-20261015` / `2268855` | 8/197 | Baseline; giữ 8 báo cáo local và toàn bộ evidence chưa commit |

Worktree thứ 9 tạo trong đợt này chỉ dành cho nhánh review. Không archive/remove worktree nào.

## Branch và đối chiếu trùng lặp

| Local branch | Tip | Kết quả so với baseline |
|---|---|---|
| `main` | `df9d768` | 5 commit lịch sử khác SHA; đã tích hợp nguyên trạng hoặc có bản port giữ logic mới hơn |
| `codex/audit-fixes-20261013` | `899088f` | Đã có qua ancestry |
| `codex/vanhsub-phase2-sync-validation` | `64ae429` | Đã có qua ancestry |
| `codex/vanhsub-main-integration` | `c7a6a49` | Đã có qua ancestry |
| `codex/douyin-main-integration` | `a99b7d7` | Đã có qua ancestry |
| `codex/douyin-media-inspection` | `96da0ca` | Có bản tích hợp `a99b7d7` + bản sửa tiến độ `bf9984c`; không replay bản cũ |
| `codex/full-audit-20261015` | `f164e0f` | Các bản vá cần thiết đã được đối chiếu/port ở đợt integration trước, không merge toàn nhánh |
| `codex/ai-studio-web-audit` | `347907d` | Có phần còn thiếu thực sự; quyết định chi tiết bên dưới |
| `codex/flow-v2-m1` | `adc50a7` | M1 chưa có ở baseline; schema/module chưa commit đã phát triển xa hơn M1, không đưa bản M1 cũ vào app hiện tại |
| `codex/integration-stabilization-20261015` | `2268855` | Baseline của review, giữ nguyên ref |

Remote-tracking đã kiểm tra: `origin/main`, `origin/codex/ai-studio-web-audit`, `origin/codex/douyin-media-inspection`, `origin/codex/full-audit-20261015`, `origin/codex/integration-stabilization-20261015`, `origin/codex/vanhsub-phase2-sync-validation`. Chúng trùng các tip local tương ứng, ngoại trừ local main phân kỳ. Không có remote-only tip mới.

Dùng ancestry, `git cherry -v`/patch equivalence, diff theo file và đọc code cuối cùng; không lấy riêng kết quả `--merged` để quyết định. Ví dụ các patch `5402ea6`, `df9d768`, `97479c0`, `f164e0f` tương đương patch đã có. Các patch khác đổi SHA/hunk khi tích hợp cần đối chiếu hành vi:

| Commit cũ | Đã được giữ/thay thế bởi |
|---|---|
| `39beaa6` | `78fc559`: freeze/fill mode, giữ workspace/snapshot/session lease mới |
| `070c919` | `2f2bcdd`: I2V identity/provenance và CDP, giữ revision/invalidation mới |
| `ea1b716` | `f1fd533`: 20–30 giây/3 scene và collector; giữ kiểm tra ownership |
| `5402ea6`, `df9d768` | `0024011`, `6f08080`: composer/duplicate send và chống reload loop |
| `9efb10b`, `31204ba`, `b12aaa0` | `aec87c6`, `365b9e9` và các bản hardening sau: IPC/lease, atomic write, duration/parser; không thay bằng allocator hoặc lock registry cũ |
| `97479c0`, `f164e0f` | `73c0b1e`, `b60cf89`; Extension hiện giữ bản 1.0.9 |
| `96da0ca` | `a99b7d7` + `bf9984c`: có thêm validation IPC, report directory, lease/cancel và tiến độ đúng |

Các mapping này được kiểm tra cùng source/báo cáo integration đã commit, không coi thông điệp commit “E2E PASS” cũ là bằng chứng nghiệm thu hiện tại.

## 11 commit từ nhánh audit cũ: quyết định cụ thể

| Commit | Phân loại / quyết định |
|---|---|
| `a9907b2` | Legacy Electron turn tracker đã được thay bằng facade/Playwright CDP, collector và selector mới (`162f57c`, `4adee2c`, `0024011`). Không đưa implementation cũ trở lại; không khẳng định mọi lỗi web cũ đã có Live PASS |
| `6d2be0f` | **Port chọn lọc → `8117951`**: tách key/model/base URL khi đổi provider; không tạo API client cho web provider; Master Prompt lỗi/thiếu key/thiếu contract phải thất bại rõ; UI ghi đúng provider. Không thay outline expansion/pacing/parser mới bằng logic cũ |
| `4d744b3` | Giữ các bản stage/lease/checkpoint ownership mạnh hơn đã có ở `5d6e81e`, `e27fd6a`, `365b9e9` và source hiện tại; không replay engine cũ |
| `5cae806` | Giữ làm lịch sử; test cũ phụ thuộc turn tracker/session-dir contract đã thay đổi. Không copy rồi sửa assertion để tạo PASS; chỉ port regression cần thiết cho phần thực sự tích hợp |
| `4228288` | Báo cáo/audit probe lịch sử, không phải feature app còn thiếu. Không thay báo cáo nghiệm thu mới bằng kết luận năm/ngày cũ |
| `c88a844` | Project isolation, artifact invalidation, task exclusion đã có implementation hiện tại. Không thêm registry thứ hai, không thay allocator/collision guard bằng hash/path logic cũ |
| `e7b6fa0` | **Port phần stem/cancellation cần thiết → `41fd9e8`**. Giữ TTS grouping/timing, task lease, ASR/OCR/translation và pipeline hiện tại. Hoãn các refactor toàn runner, `TaskExecution`/pipeline replacement và tối ưu fusion chưa tương thích nguyên trạng |
| `51c6f64` | Không replay full core suite/CI/package setup cũ: phụ thuộc module và contract cũ. Các regression còn phù hợp đã được port thành bài kiểm tra có mục đích; không coi toàn suite cũ đã được nghiệm thu trên nhánh mới |
| `5363067` | **Port → `53c5f08`, `41fd9e8`**: seed master trong manifest, một decode DSP, probe Demucs một lần. Không dùng hard link: engine hiện tại có thể ghi lại master, nên phải giữ copy độc lập |
| `582607c` | Voice/speed/engine/voiceOverrides IPC đã có bản mới hơn. **Phần UI còn thiếu → `03672a3`**: đọc lại SRT và bỏ kết quả đến muộn khi đổi task/revision |
| `347907d` | **Port build check → `d2e509e`**, thêm shared types, dùng staging mới cùng ổ đĩa dependencies, giữ evidence và phát hiện webpack lỗi dù CLI trả 0. Không replay package/dependency/CI cũ hoặc toàn core suite cũ |

Không merge/cherry-pick nguyên các commit cross-cutting có implementation lỗi thời. Commit mới có trailer `Ported-from` để truy vết nguồn, với phạm vi chọn lọc ghi rõ; việc này không làm nhánh cũ trở thành ancestor hay giả rằng toàn bộ nhánh đã merge.

## Flow v2 và file chưa commit: phần hoãn có chủ đích

Worktree `c89f` có M1 commit (3 file) và **18 tracked modified + 28 untracked** cho queue/runner/provider/bridge/extension/UI/IPC, launcher và test M2–M7. Đã đọc mục đích, contract, validation notes, IPC và các hook vào app. Không coi chúng chỉ là file rác, cũng không coi tất cả là feature production hoàn tất.

- `flow-contract.v1.json` vẫn `verificationStatus: partial`, các capability generation/status/reference đều `false`; prompt selectors và nhiều artifact/error mapping còn null. Tài liệu ghi 73 bài fixture và smoke lịch sử, đồng thời nói chưa có Flow live. Đợt này không chạy lại hoặc nâng các kết quả lịch sử thành PASS mới.
- Tích hợp đòi chọn mode lúc startup, nối lại main/preload/navigation/storyboard/workflow và bảo đảm legacy bridge không chạy song song. Các hook dựa trên baseline cũ, trong khi Beta đã có protocol 2/Extension 1.0.9, security/media grants, task/session ownership và shutdown khác. Đây là migration rộng cần review riêng, không phải một cherry-pick không xung đột đã xác minh.
- Không đưa M1 cũ riêng lẻ vào nhánh đích khi working copy đã có schema/logic mới hơn nhưng chưa commit; cũng không chụp cả WIP thành commit “hoàn tất”. **Hoãn toàn nhóm, giữ nguyên source/test/tài liệu tại c89f.** Không cần xóa nó để hoàn tất đợt review này.

Ở D checkout, các script inspect/launch/test UI riêng lẻ gắn CDP/đường dẫn fixture cụ thể; probe concat là đo thử, không phải module app. Media/session/evidence/HAR không phải feature cần merge và có thể chứa runtime metadata riêng tư. Ở e9b1, 8 báo cáo đã sửa cùng evidence thô là dữ liệu local từ các đợt nghiệm thu; báo cáo công khai đã được tổng hợp ở baseline. Không đưa các file này vào nhánh review.

## Conflict và giới hạn còn lại

Không có conflict text/index đang mở; không dùng ours/theirs, reset hoặc abort để ghi đè file người dùng. Các chồng lấn kiến trúc Flow v2, core-runner replacement, outline/fallback/collector cũ được **hoãn**, không đoán phiên bản đúng bằng cách merge toàn nhánh.

Những điểm không được tuyên bố đã giải quyết: Google Flow unusual activity/CDP target cũ, dịch/official API live thiếu quyền, clean Windows/NSIS và UAT Electron mới. Tại mốc tích hợp ban đầu, phần trích WAV trước stem chỉ hủy sau extraction; bản sửa tiếp nối `93b6111` đã nối hủy vào worker ở phase này, xem phần cập nhật bên dưới. DSP chỉ là lọc kênh/tần số, không được quảng bá thành chất lượng Demucs AI. Cải thiện cache không chứng minh giải quyết mọi tình huống crash giữa regeneration.

## Build và bằng chứng kiểm thử đợt này

| Nhóm | Kết quả |
|---|---|
| TypeScript main + renderer | **PASS**, `tsc --noEmit --incremental false -p tsconfig.json`; renderer riêng cũng PASS |
| Production renderer | **PASS**, 32.268 ms, Next 16.3.8 trong staging mới trên D |
| Main/preload webpack | **PASS**, 7.866 ms; có `main.js`, `preload.js`, `home/index.html` |
| Manifest build | 268 file production source khớp hash sau tích hợp; không thay dependency hoặc source cũ |
| Negative controls | Baseline TTS panel FAIL khi mở lại SRT đã sửa; source mới PASS. Web provider cũ dựng API client từ retained key bị test bắt FAIL. Webpack thiếu entry thực tế trả exit 1 qua guard |
| Regression liên quan | **14/14 entrypoint PASS**, danh sách bên dưới; không phải full suite hoặc provider live |
| Native media fixture | Mono/stereo DSP tạo hai WAV giải mã được, FFmpeg đang chạy hủy đúng; stem cancel/rerun và output project isolation PASS. Audio fixture tổng hợp, không phải speech/provider live |
| React UI fixture | TTSPage thật được mount trong Chrome headless: mở lại đọc SRT mới, late task-A result không đi vào task B. IPC giả cho fixture; **không phải Electron UI E2E** |
| Runtime Beta đang dùng | Giữ nguyên app.asar hash so với Beta cũ, không thay EXE/app.asar của phiên đang chạy; 1 main window/4 process. Không chạy đồng thời phiên Beta dùng chung dữ liệu |
| Installer/live/UAT | **NOT TESTED trong đợt merge này**: không packaging/NSIS mới, không Windows sạch, không generation/call provider thật, không xác nhận UAT Electron mới |

Dependencies build lấy từ bộ dependency đã cài riêng của Beta, đọc qua junction ở staging mới; không `npm install`/`npm ci` vào shared node_modules. Shared dependency của checkout khác phiên bản Next với lock hiện tại, nên không dùng nó để khẳng định production build đúng phiên bản. Evidence build giữ tại `D:/DEAN/DEAN/VANHSUB/temp/vanhsub-build-check-AYrkZW/build-check-result.json`; không ghi đè artifact đang chạy. Raw regression/log/negative controls ở `temp/worktree-audit/`, không commit.

14 entrypoint đã chạy:

1. `test_channel_provider_isolation.ts`
2. `test_tts_cache_seed.ts`
3. `test_pending_stems_integration.ts`
4. `test_tts_panel_refresh.cjs`
5. `test_tts_group_regeneration.ts`
6. `test_rc_tts_cancel_retry.ts`
7. `test_ai_studio_script_evaluation.ts`
8. `test_ai_studio_script_refinement.ts`
9. `test_ai_studio_channel_settings.ts`
10. `test_rc_ipc_payload.ts`
11. `test_task_operation_exclusion.ts`
12. `test_shared_dubbing_preferences.ts`
13. `test_dubbed_subtitle_export.ts`
14. `test_rc_extension_pairing.ts`

Đối chiếu source xác nhận Extension 1.0.9, security modules, workflow, ASR/OCR/translation và storage của Studio không bị thay bởi các phiên bản branch cũ. Không xóa test hiện tại. Các correction fixture trong quá trình viết test mới (filePath/project directory và nhãn model được chuẩn hóa) sửa giả định của harness, không nới điều kiện thành công của sản phẩm; negative control xác minh test panel bắt được lỗi baseline.

## Review và UAT tiếp theo

Review diff `2268855..codex/worktree-merge-audit-20261020`, đặc biệt provider isolation, fresh SRT panel, cache copy và stem cancel/output location. Khi UAT dùng profile test riêng: mở lại bảng giọng sau sửa SRT; tạo lại audio và kiểm tra output cũ; hủy/chạy lại stem; chọn provider khác và xác nhận thiếu key được báo đúng, không gọi provider cũ. Không dùng profile production để chạy song song.

Kết quả được giữ local trên nhánh review. Flow v2 và các phần refactor hoãn cần một đợt tích hợp riêng trên revision đã chốt, giữ các gate provider/ownership/security hiện tại. Chỉ merge main hoặc push khi người dùng yêu cầu ở bước sau.

## Bản sửa tiếp nối sau integration

- `80d19c0`: bảo toàn run TTS đã hoàn thành khi tạo lại thất bại/hủy; chặn dùng dub stale khi export. Báo cáo và regression bổ sung ở `f5c00e5`.
- `93b6111`: dừng worker FFmpeg khi hủy giữa full-quality audio extraction ở stem và dubbing. Negative control khoảng 5,8 giây chờ hết input; sau sửa 61/60 ms trên fixture 6 giây. Ba entrypoint liên quan, main TypeScript và main/preload build PASS; không được tính thành UI E2E hoặc provider live.

Chi tiết và giới hạn nghiệm thu nằm trong `docs/VANHSUB_APP_REVIEW_FOLLOWUP_20261020.md`. Không có thay đổi quyết định hoãn Flow v2 hoặc refactor runner cũ. Nhánh kết quả vẫn là `codex/worktree-merge-audit-20261020`; revision cuối review bằng HEAD của nhánh local này. Không push/merge main; các worktree và thay đổi gốc của người dùng được giữ nguyên.
