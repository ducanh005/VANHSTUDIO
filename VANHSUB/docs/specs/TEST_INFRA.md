# E2E Test Infra: VANHSUB AI Studio Comprehensive Upgrade (R1 - R6)

## 1. Test Philosophy & Principles
- **Authoritative Requirement Derivation**: All test inputs, expected behaviors, and assertions are directly derived from `ORIGINAL_REQUEST.md` (header `## 2026-10-04T09:03:50Z`) and `PROJECT.md § Feature Inventory & Interface Contracts`.
- **Zero Mock Facades**: Real business logic, wire payload generation, session management, mathematical audio/video filter graphs, and CapCut desktop timeline schemas are genuinely executed and validated.
- **Progressive Testability & Interface Contract Verification**: During active milestone development (M1 in progress, M2–M6 planned), tests seamlessly bind to live modules (`FlowBatchBuilder`, `GoogleFlowRpcClient`, `GoogleVeoSessionManager`, `BibleStore`, `AiStudioVideoAssembler`, `AiStudioStoryboardService`, etc.) backed by authoritative Specification Reference Oracles for planned milestones.
- **4-Tier Progressive Test Architecture**:
  - **Tier 1: Feature Coverage** (representative happy-path tests across all 18 features F1.1 - F6.2).
  - **Tier 2: Boundary & Corner Cases** (invalid tokens, session expiry redirects, empty prompts, boundary durations 1.9s/8.1s, missing assets, ducking edge cases).
  - **Tier 3: Pairwise Cross-Feature Interactions** (I2V + Character Anchor, AI Cinematographer + Ken Burns, Audio Ducking + SFX, Multi-track + CapCut export, etc.).
  - **Tier 4: Real-World Application Scenarios** (end-to-end production scripts simulating full AI Studio workflow from topic to CapCut draft).

---

## 2. Feature Inventory Test Mapping

| # | Feature | Milestone | Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Cross) | Tier 4 (Real-World) |
|---|---------|:---------:|:------:|:-----------------:|:-----------------:|:--------------:|:-------------------:|
| **F1.1** | Direct RPC Auto-Upload | M1 | R1 Survey | Tested | Tested | Tested (T3.5) | Tested (S4.1) |
| **F1.2** | Two-Step I2V Pipeline | M1 | R1 Survey | Tested | Tested | Tested (T3.1) | Tested (S4.1) |
| **F1.3** | Synthetic Text Card Elimination | M1 | R1 Survey | Tested | Tested | Tested (T3.8) | Tested (S4.3, S4.4) |
| **F1.4** | Session Self-Healing & Auto-Reconnect | M1 | R1 Survey | Tested | Tested | Tested (T3.5) | Tested (S4.2, S4.4) |
| **F2.1** | Contextual AI Cinematographer | M2 | R2 Survey | Tested | Tested | Tested (T3.2) | Tested (S4.1, S4.2) |
| **F2.2** | Camera Angle & Motion Planning | M2 | R2 Survey | Tested | Tested | Tested (T3.2) | Tested (S4.1, S4.2) |
| **F2.3** | Veo Video Duration Optimization | M2 | R2 Survey | Tested | Tested | Tested (T3.6) | Tested (S4.1, S4.3) |
| **F2.4** | Two-Column Audiovisual Script | M2 | R2 Survey | Tested | Tested | Tested (T3.6) | Tested (S4.1, S4.2) |
| **F3.1** | BibleStore Character & Setting Bridge | M3 | R3 Survey | Tested | Tested | Tested (T3.7) | Tested (S4.1, S4.2) |
| **F3.2** | I2V Motion Prompt Enrichment | M3 | R3 Survey | Tested | Tested | Tested (T3.1) | Tested (S4.1) |
| **F4.1** | Dynamic Pan/Zoom Ken Burns | M4 | R4 Survey | Tested | Tested | Tested (T3.2, T3.8) | Tested (S4.1) |
| **F4.2** | Dynamic Audio Ducking | M4 | R4 Survey | Tested | Tested | Tested (T3.3) | Tested (S4.1, S4.3) |
| **F4.3** | Scene Transition SFX | M4 | R4 Survey | Tested | Tested | Tested (T3.3) | Tested (S4.1, S4.3) |
| **F5.1** | CapCut Desktop Draft Generator | M5 | R5 Survey | Tested | Tested | Tested (T3.4) | Tested (S4.1, S4.2) |
| **F5.2** | Multi-Track Timeline Mapping | M5 | R5 Survey | Tested | Tested | Tested (T3.4, T3.6) | Tested (S4.1, S4.2) |
| **F5.3** | Auto-Detect CapCut Draft Path & IPC | M5 | R5 Survey | Tested | Tested | Tested (T3.4) | Tested (S4.1) |
| **F6.1** | AutoPilotView Modularization | M6 | R6 Survey | Tested | Tested | Tested (T3.7) | Tested (S4.1, S4.3) |
| **F6.2** | Advanced Infrastructure Drawer | M6 | R6 Survey | Tested | Tested | Tested (T3.7) | Tested (S4.4) |

---

## 3. Test Architecture & Execution

- **Test Suite Location**: `tests/test_ai_studio_e2e_tiers.ts`
- **Official Test Runner**:
  ```powershell
  .\node_modules\.bin\tsx.cmd tests/test_ai_studio_e2e_tiers.ts
  ```
- **Pass/Fail Semantics**:
  - Exit code `0`: All assertions passed across all 4 Tiers.
  - Non-zero exit code: Any assertion failure aborts with detailed diagnostics.
- **TypeScript Integrity Gate**:
  - `npx tsc --noEmit` (Root Nextron & Main processes) must yield exit code `0`.
  - `npx tsc -p renderer/tsconfig.json --noEmit` (Renderer React processes) must yield exit code `0`.

---

## 4. Tier Definitions & Test Breakdown

### Tier 1: Feature Coverage (Core Happy Path)
18 dedicated test cases validating the canonical happy-path execution of every feature from F1.1 to F6.2:
- **T1.F1.1**: Direct Electron image upload via `maseQ` returning Flow media UUID and constructing `buildGenVideoPayload`.
- **T1.F1.2**: Two-step I2V pipeline generating keyframe via `ogiZ0b`, retrieving media UUID, and passing to Veo `MZZa6b`.
- **T1.F1.3**: Zero synthetic text cards generated on error; authentic keyframe or actionable typed error returned.
- **T1.F1.4**: Session self-healing detecting `/about` redirect, restoring cookies to partition, and refreshing `SNlM0e` CSRF token.
- **T1.F2.1**: Contextual AI Cinematographer semantic decision (Video vs Image) based on scene action and dramatic tension.
- **T1.F2.2**: Camera angle and motion planning dynamically matching narrative context.
- **T1.F2.3**: Duration optimization ensuring video shots are strictly clamped between 2.0s and 8.0s.
- **T1.F2.4**: Two-column audiovisual script data model parsing (Voiceover Audio + Visual Action / Camera Movement).
- **T1.F3.1**: BibleStore integration retrieving CharacterProfile & SceneProfile into AI Studio project state.
- **T1.F3.2**: I2V motion prompt enrichment compositing `[Character Traits] + [Subject Action] + [Camera Motion]`.
- **T1.F4.1**: Dynamic Pan/Zoom Ken Burns applying 6 cinematic camera motion profiles with 1.5x pre-upscaling.
- **T1.F4.2**: Dynamic audio ducking applying `-18dB` BGM attenuation via FFmpeg `sidechaincompress` filter chain.
- **T1.F4.3**: Scene transition SFX inserting Whoosh/Impact sound effects at scene boundaries ($T_k - 0.2\text{s}$) via `adelay` & `amix`.
- **T1.F5.1**: CapCut desktop draft export creating valid `draft_content.json` and `draft_meta_info.json` on microsecond ($\mu\text{s}$) timeline.
- **T1.F5.2**: Multi-track timeline mapping placing video clips, voice audio, BGM, and subtitles on 4 distinct synchronized tracks.
- **T1.F5.3**: Auto-detection of CapCut draft directory (`%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\`) and IPC registration.
- **T1.F6.1**: AutoPilotView modular subcomponent architecture (10 separated components).
- **T1.F6.2**: Advanced infrastructure drawer isolating Chrome Bridge port, Lobby debug view, and Mutex lock indicators.

### Tier 2: Boundary & Corner Cases (Stress & Resilience)
18 boundary and edge test cases covering failure modes, extreme values, and adversarial inputs:
- **T2.B1.1**: 0-byte image file and non-existent local path handling in RPC upload.
- **T2.B1.2**: Empty / null response from keyframe RPC triggering graceful error handling.
- **T2.B1.3**: Fatal upstream failure verifying strict rejection of dummy text cards.
- **T2.B1.4**: Corrupted cookie string, malformed HTML without CSRF token, and watchdog crash limit.
- **T2.B2.1**: Empty narration and visual note fallback in visual director.
- **T2.B2.2**: Unknown camera angle and extreme dramatic tension fallback.
- **T2.B2.3**: Boundary duration clamping: 1.9s clamped to 2.0s, 8.1s clamped to 8.0s, negative durations, NaN.
- **T2.B2.4**: Asymmetrical two-column script rows (empty voiceover or empty visual action).
- **T2.B3.1**: Non-existent character ID or scene profile in BibleStore.
- **T2.B3.2**: Extreme prompt length exceeding Google Flow character limits and sanitization of prompt injection tokens.
- **T2.B4.1**: Extreme aspect ratios (9:16 vertical shorts, 1:1 square, 21:9 ultrawide) and 0.5s duration in Ken Burns filtergraph.
- **T2.B4.2**: Audio ducking without BGM (voiceover only), silent audio input, and zero-gap voiceover.
- **T2.B4.3**: Single-scene project (0 transitions), transition cut timestamp $< 0.2\text{s}$, and missing SFX asset fallback.
- **T2.B5.1**: Non-integer microsecond timestamps, zero-duration clips, and empty scenes array in CapCut draft.
- **T2.B5.2**: CapCut export with missing optional tracks (e.g. no subtitles or no BGM).
- **T2.B5.3**: Missing CapCut installation folder triggering automatic fallback directory creation.
- **T2.B6.1**: AutoPilot modular subcomponents receiving uninitialized / empty project state.
- **T2.B6.2**: Invalid Chrome Bridge port numbers, closed drawer event handling, and rapid toggle stress.

### Tier 3: Pairwise Cross-Feature Interactions
8 pairwise integration test cases verifying contracts across subsystem boundaries:
- **T3.1 (F1.2 + F3.2)**: Two-Step I2V Pipeline + Character Anchor Motion Prompt Enrichment.
- **T3.2 (F2.1 + F4.1)**: Contextual AI Cinematographer + Dynamic Pan/Zoom Ken Burns Profile Assignment.
- **T3.3 (F4.2 + F4.3)**: Dynamic Audio Ducking (-18dB sidechaincompress) + Scene Boundary Transition SFX (adelay & amix).
- **T3.4 (F5.1 + F5.2)**: CapCut Microsecond Timeline + 4-Track Synchronized Timeline Mapping.
- **T3.5 (F1.1 + F1.4)**: Direct RPC Auto-Upload + Session Self-Healing & Auto-Reconnect.
- **T3.6 (F2.3 + F5.2)**: Veo Video Duration Clamping (2s - 8s) + CapCut Video Track Segments Duration Alignment.
- **T3.7 (F3.1 + F6.1)**: BibleStore Character & Setting Bridge + AutoPilot Modular Subcomponents.
- **T3.8 (F1.3 + F4.1)**: Synthetic Card Elimination + Ken Burns Authentic Keyframe Fallback.

### Tier 4: Real-World Production Scenarios
4 comprehensive end-to-end simulation workloads:
- **Scenario 1: "Cyberpunk Detective" Full Production Workflow**:
  - 4-scene narrative using BibleStore Character Anchor ("Điệp viên Vanh").
  - Contextual visual director plans 3 video shots and 1 static image shot.
  - Video durations clamped to [2.0s, 8.0s].
  - I2V motion prompt enrichment compositing traits, action, and camera movement.
  - Audio mixing with -18dB BGM ducking and Whoosh SFX at cuts.
  - 1-Click CapCut Desktop draft exported with 4 synchronized tracks and verified.
- **Scenario 2: "Tech Innovator Documentary" (Dr. Lan Anh Quantum Lab)**:
  - 5-scene documentary script with fast narration.
  - Scene Anchor ("Phòng Thí nghiệm Lượng tử") and Character Anchor ("Tiến sĩ Lan Anh").
  - Camera movements (Push-in Hero, Pan L->R).
  - Session expiry simulated and healed via partition cookie restoration.
  - CapCut draft generated and verified with 0ms track drift.
- **Scenario 3: "Viral TikTok/Shorts Comedy" (Newbie YouTuber Bob)**:
  - Vertical 9:16 aspect ratio (1080x1920).
  - 4 rapid cuts (2.0s each) with high-tempo voiceover.
  - Impact SFX at scene transitions and punchy subtitle styling.
  - Zero synthetic color cards produced.
- **Scenario 4: "Graceful Recovery Under Network Disturbance"**:
  - Offline Bridge and transient upstream RPC errors simulated.
  - System applies exponential backoff, recovers via session refresh, and safely provides actionable diagnostics without crashing or generating dummy cards.

---

## 5. Coverage Thresholds
- **Tier 1**: Exactly 18 / 18 features validated (100% feature coverage).
- **Tier 2**: Exactly 18 / 18 boundary & corner conditions validated.
- **Tier 3**: Exactly 8 / 8 pairwise cross-feature interactions validated.
- **Tier 4**: Exactly 4 / 4 full real-world application scenarios validated.
- **Total Suite**: Minimum 48 dedicated high-fidelity test cases, 150+ assertions.
- **Exit Code**: Strict `0` with 100% pass rate.
