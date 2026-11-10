# Project: VANHSUB AI Studio Comprehensive Upgrade (R1 to R6)

## Architecture
VANHSUB AI Studio comprises an end-to-end automated audiovisual production pipeline:
1. **Flow Engine & Infrastructure (`main/workflow/flow-engine/rpc/`, `main/veo/`)**: Internal Google Flow Web RPC client (`batchexecute`), Chrome Extension Bridge (`FlowBridgeServer` WebSocket), and session manager (`GoogleVeoSessionManager`). Generates authentic Imagen images and Veo videos without external paid APIs.
2. **AI Cinematography & Storyboard Planner (`main/ai-studio/services/AiStudioStoryboardService.ts`, `AiStudioLlmService.ts`)**: Contextual Visual Director determining media types (Video vs Image), optimal duration (2s-8s), camera angles, and camera movements. Structures script into a 2-column Audiovisual Script (Voiceover + Visual Action & Camera Movement).
3. **Consistency Engine (`main/store/bibleStore.ts`, `AiStudioStyleRefsService.ts`, `FlowMediaAutomationEngine.ts`)**: Character & Setting Anchors maintaining identity across images and video clips by propagating facial/attire traits into Imagen and Veo I2V motion prompts.
4. **Video Assembly & Audio Mixing (`main/ai-studio/services/AiStudioVideoAssembler.ts`)**: FFmpeg video rendering with dynamic Pan/Zoom Ken Burns (1/3 framing, 6 motion profiles), Dynamic Audio Ducking (-18dB BGM on speech via `sidechaincompress`), and transition SFX insertion.
5. **CapCut Draft Exporter (`main/ai-studio/services/CapCutDraftExporter.ts`)**: 1-Click native export to CapCut Desktop / JianYing `draft_content.json` multi-track timeline ($\mu\text{s}$ timebase).
6. **AutoPilot Creative UI (`renderer/components/ai-studio/`)**: Modularized interface with separated panels for Script, Storyboard Grid, Scene Cards, Media Lightbox, and an Advanced Infrastructure Drawer.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1.1 | Direct RPC Auto-Upload | Auto-upload local images via `uploadAsset` (`maseQ`) in direct Electron mode before calling `buildGenVideoPayload`. | M1 | R1 Survey |
| F1.2 | Two-Step I2V Pipeline | Generate high-quality Imagen keyframe (`ogiZ0b`), obtain Flow media UUID, pass to Veo I2V (`MZZa6b`) with motion prompt. | M1 | R1 Survey |
| F1.3 | Synthetic Text Card Elimination | Completely eliminate `generateSyntheticSceneCard` and dummy FFmpeg cards. Use authentic keyframe + Ken Burns or actionable error on failure. | M1 | R1 Survey |
| F1.4 | Session Self-Healing & Auto-Reconnect | Handle `/about` redirect, refresh `SNlM0e` CSRF token, auto-restore cookies, and bring Lobby to screen if user re-auth is needed. | M1 | R1 Survey |
| F2.1 | Contextual AI Cinematographer | Replace static keyword regexes (`decideMediaType`) with LLM Visual Director + semantic fallback for intelligent Video vs Image decisions. | M2 | R2 Survey |
| F2.2 | Camera Angle & Motion Planning | Contextual camera angle and motion selection based on scene dramatic tension instead of hardcoded modulo indices. | M2 | R2 Survey |
| F2.3 | Veo Video Duration Optimization | Enforce 2.0s to 8.0s duration clamping for video shots, respecting Veo generation limits. | M2 | R2 Survey |
| F2.4 | Two-Column Audiovisual Script | Restructure script data models and `ScriptWorkspaceView.tsx` into 2 parallel columns: Voiceover (Audio) & Visual Action / Camera Movement. | M2 | R2 Survey |
| F3.1 | BibleStore Character & Setting Bridge | Integrate `bibleStore.ts` (`CharacterProfile`, `SceneProfile`) into AI Studio project setup and AutoPilot state. | M3 | R3 Survey |
| F3.2 | I2V Motion Prompt Enrichment | Enrich Veo prompt in `FlowMediaAutomationEngine` / `AiStudioPipelineEngine` with `[Character Anchor Traits] + [Action] + [Camera Movement]` to prevent facial drift. | M3 | R3 Survey |
| F4.1 | Dynamic Pan/Zoom Ken Burns | 6 Cinematic Camera Motion Profiles (Pan L->R, Pan R->L, Zoom 1/3 Left, Zoom 1/3 Right, Zoom-out Wide, Push-in Hero) with 1.5x pre-upscaling. | M4 | R4 Survey |
| F4.2 | Dynamic Audio Ducking | Duck BGM by -18dB during voiceover speech via FFmpeg `sidechaincompress` filter with smooth attack/release transitions. | M4 | R4 Survey |
| F4.3 | Scene Transition SFX | Automatically insert Whoosh/Impact transition sound effects at scene boundaries ($T_k - 0.2s$) using `adelay` and `amix`. | M4 | R4 Survey |
| F5.1 | CapCut Desktop Draft Generator | Export valid `draft_content.json` and `draft_meta_info.json` using microsecond ($\mu\text{s}$) timeline. | M5 | R5 Survey |
| F5.2 | Multi-Track Timeline Mapping | Export video clips/images, voiceover audio, BGM audio, and subtitles onto separate synchronized tracks. | M5 | R5 Survey |
| F5.3 | Auto-Detect CapCut Draft Path & IPC | Detect `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\` with fallback and expose `aiStudio:export:capcutDraft` IPC. | M5 | R5 Survey |
| F6.1 | AutoPilotView Modularization | Split monolithic 3,348-line component into 10 focused subcomponents in `renderer/components/ai-studio/autopilot/`. | M6 | R6 Survey |
| F6.2 | Advanced Infrastructure Drawer | Slide-over drawer tucking away Chrome Bridge port, Lobby offscreen/debug toggle, and Mutex lock details. | M6 | R6 Survey |
| F7.1 | E2E Dual Track Verification | Automated multi-tier test suite covering Tiers 1-4 for all features with 100% pass rate. | M7 | Dual Track |
| F7.2 | Adversarial Hardening & Forensic Audit | White-box stress testing (Tier 5) and independent forensic audit verification before handoff. | M7 | Dual Track |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Google Flow Engine & I2V Pipeline | F1.1, F1.2, F1.3, F1.4 | none | DONE |
| M2 | Contextual AI Cinematographer & 2-Column Script | F2.1, F2.2, F2.3, F2.4 | none | DONE |
| M3 | Character & Setting Consistency via Anchors | F3.1, F3.2 | M1, M2 | IN_PROGRESS |
| M4 | Video Engine, Ken Burns, Audio Ducking & SFX | F4.1, F4.2, F4.3 | none | IN_PROGRESS |
| M5 | 1-Click CapCut Desktop Draft Export | F5.1, F5.2, F5.3 | M4 | PLANNED |
| M6 | AutoPilotView Modularization & Advanced Drawer | F6.1, F6.2 | M1, M2, M3, M4, M5 | PLANNED |
| M7 | E2E Dual Track Verification & Victory Audit | F7.1, F7.2 | M1, M2, M3, M4, M5, M6 | PLANNED |

---

## Interface Contracts

### 1. `GoogleFlowRpcClient` ↔ `AiStudioVisualService` (M1)
- Method: `generateVideoViaI2V(options: FlowI2VOptions): Promise<FlowMediaResult>`
- Parameters:
  - `keyframePathOrMediaId`: string (local file path or existing Flow UUID)
  - `motionPrompt`: string (enriched camera movement and action)
  - `durationSec`: number (2.0 to 8.0 seconds)
  - `aspectRatio`: '16:9' | '9:16'
- Guarantee:
  - If given a local file path, automatically uploads asset via `uploadAsset` (`maseQ`) and retrieves Flow UUID before invoking `MZZa6b`.
  - Zero synthetic color cards generated on error. On unrecoverable error, returns typed error code (`SESSION_EXPIRED`, `UNUSUAL_ACTIVITY`, `RATE_LIMITED`).

### 2. `AiStudioStoryboardService` ↔ `AiStudioPipelineEngine` (M2)
- Method: `planShotCinematography(scene: ScriptBeatLine, fullContext: ScriptBeatLine[]): Promise<CinematographyPlan>`
- Types:
  - `media_type`: 'video' | 'image'
  - `camera_angle`: 'wide_establishing' | 'medium_shot' | 'close_up' | 'low_angle' | 'high_angle' | 'point_of_view'
  - `camera_motion`: 'pan_left_to_right' | 'pan_right_to_left' | 'dolly_in' | 'dolly_out' | 'pedestal_up' | 'static'
  - `duration_sec`: number (clamped to 2.0s - 8.0s for video)
  - `visual_action_description`: string

### 3. `BibleStore` ↔ `AiStudioStyleRefsService` & `AiStudioPipelineEngine` (M3)
- Interface: `CharacterAnchorConfig` & `SettingAnchorConfig`
- Schema:
  - `characterId`: string
  - `name`: string
  - `visualTraits`: string (invariable hair, eyes, facial features, clothing)
  - `referenceImagePaths`: string[]
- Contract:
  - When constructing prompt for Imagen: composite `[Character Anchor Traits] + [Scene Description] + [Style Prefix]`.
  - When constructing motion prompt for Veo: composite `[Character Name/Traits] + [Subject Action] + [Camera Motion]`.

### 4. `AiStudioVideoAssembler` Ken Burns & Audio Ducking (M4)
- Ken Burns Motion Profiles:
  - Array of 6 profiles: Pan L->R, Pan R->L, Zoom 1/3 Left, Zoom 1/3 Right, Zoom-out Wide, Push-in Hero.
  - Pre-upscaling 1.5x before `zoompan` to eliminate pixel shimmer on Windows FFmpeg.
- Audio Ducking Filter Chain:
  - Voiceover input split: `[voice_in]asplit=2[voice_main][voice_sidechain]`
  - BGM sidechain compress: `[bgm_in][voice_sidechain]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400:knee=2.5[bgm_ducked]`
  - Final mix: `[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`
- SFX Insertion:
  - Chained `adelay` and `amix` at scene cut timestamps $T_k - 0.2s$.

### 5. `CapCutDraftExporter` (M5)
- Interface: `exportToCapCutDraft(project: AiStudioProject, targetDirectory?: string): Promise<{ draftPath: string, trackSummary: object }>`
- Contract:
  - Output files: `draft_content.json`, `draft_meta_info.json`.
  - Time units: Microseconds ($1\text{s} = 1,000,000\,\mu\text{s}$).
  - Tracks: 4 synchronized tracks (`track_video`, `track_audio` voice, `track_audio` bgm, `track_text` subtitle).
  - IPC: `window.vanhsub.aiStudio.exportCapcutDraft(projectId, targetDir)`.

### 6. `AutoPilotView` Subcomponent Modularization (M6)
- Directory: `renderer/components/ai-studio/autopilot/`
- Subcomponents:
  - `AutoPilotHeader.tsx`: Project switcher, actions, status.
  - `IdeaListPanel.tsx`: Topic suggestions and generation.
  - `StoryboardGridPanel.tsx`: Container for scene cards.
  - `StoryboardSceneCard.tsx`: Individual shot card with visual prompt, camera angle/motion tags, media preview.
  - `CharacterStudioPanel.tsx`: Character Anchor and Scene Anchor selection.
  - `PipelineTrackerPanel.tsx`: 8-step pipeline execution progress.
  - `MediaLightboxModal.tsx`: High-resolution media viewer.
  - `AdvancedInfrastructureDrawer.tsx`: Slide-over drawer holding Chrome Bridge port, Lobby debug view, and Mutex lock indicators.

---

## Code Layout
- `main/workflow/flow-engine/rpc/`: Google Flow Web RPC, Batch Builder, Constants, Bridge Server.
- `main/veo/`: Google Flow session manager, anti-spam, partition cookie manager.
- `main/ai-studio/services/`: Storyboard, Visual, Video Assembler, Model Config, CapCut Exporter.
- `main/ai-studio/types.ts`: Core data structures and contracts.
- `renderer/components/ai-studio/`: UI views and modals.
- `renderer/components/ai-studio/autopilot/`: Modularized AutoPilot subcomponents.
- `tests/`: Automated unit and end-to-end test suites.
