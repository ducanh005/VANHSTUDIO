# VANHSUB — Integration and stabilization, 2026-10-15

Status: **reconciled and tested on the integration branch; NOT READY for full production release**. Main remains unchanged. Final acceptance evidence and remaining gates are recorded below.

## Baselines and branch safety

- Common ancestor: `f03de1c`.
- Fetched `origin/main`: `899088f`,27 commits after ancestor, all retained as ancestors of the integration branch.
- Local `main`: `df9d768`,5 different commits after ancestor.
- Audit branch: `codex/full-audit-20261015`, tip `f164e0f`,5 audit commits above local main.
- Integration branch: **`codex/integration-stabilization-20261015`**, created directly from fetched `origin/main`.
- No main reset/merge, no force push, no user uncommitted files overwritten. Work takes place in the existing isolated worktree; the original D checkout is not switched.
- Git author names do not establish which agent wrote a commit. Attribution follows historical handoff descriptions; inclusion decisions use code and tests.

## Commit reconciliation

| Original | Decision / integrated revision | Reason |
|---|---|---|
| All 27 remote commits `de1fce8`…`899088f` | Retained by ancestry | Keep export resolution/audio, unique project allocation/download preservation, subtitle invalidation, queued leases, TTS sentence groups/opt-in shortening, shared preferences, episode workspaces, config snapshots, session cancellation, rendering/voice/storyboard/media/BGM fixes |
| `39beaa6` | Selectively integrated as `78fc559` | Add fill-mode UI/types/IPC and renderer guard/freeze support. Reject older engine ownership/storage implementation which would replace pinned workspaces, revisions, snapshots and session leases. Import keeps existing `applySceneMedia` invalidation plus duration evidence. Ownership regression retained and upgraded to decoded media/persisted states |
| `070c919` | Selectively integrated as `2f2bcdd` | Keep I2V keyframe identity and CDP routing. Preserve backend artifact invalidation and UI refresh/session guards; reject stale frontend savedSession overwrite hunk. Add assetId contract field required by actual result |
| `ea1b716` | Selectively integrated as `f1fd533` | Keep20–30s duration, collector/pacing improvements and single-shot scene timing. Reject loading state by highest stage, replacing snapshot/lease logic, forcing global outputMode over explicit shot mode, and auto-adopting the active Flow project |
| `5402ea6` | Integrated as `0024011` | Scoped ChatGPT composer and duplicate-send protection; collector unit regression included |
| `df9d768` | Integrated as `6f08080` | Prevent extension auto-reload loop |
| `9efb10b` | Selectively integrated as `aec87c6` | Keep security, workflow cleanup/node leases, ASR/translation failure preservation, fresh TTS outputs. Preserve remote task/subtitle/queue/preferences behavior. `taskLease` now shares canonical `taskOperations`; no second lock registry. Keep atomic unique directory allocator instead of parallel hash allocator |
| `31204ba` | Not replayed wholesale; atomic-write hunk applied separately | Remote already has stronger workspace catalog checks, revision paths, config snapshot, AbortController/process-aware session leases and recovery. Replaying the whole commit would regress these. Atomic file safety remains necessary |
| `b12aaa0` | Not replayed wholesale; invalid TTS-duration hunk and regression retained separately | Provider review/refinement parsers already on remote. Preserve remote alignment/word boundary implementation; reject fictitious5s duration |
| `97479c0` | Integrated as `73c0b1e` | Fresh owned Flow tab on create; protect background user tabs; extension1.0.7 and VM tests |
| `f164e0f` | Integrated as `b60cf89` | Keep original audit evidence as historical evidence, not new integration PASS; new output uses `docs/integration-evidence/2026-10-15` |

Conflicts were reviewed by behavior. No global ours/theirs strategy was used. The incoming feature commit messages retain their historical wording; their prior E2E claims are not accepted as current evidence.

## Integration-specific corrections

- New fill-mode IPC is guarded by trusted renderer and canonical session lease, validates enum/scene list and invalidates rendered output.
- Main IPC added on the remote is also guarded; old subtitle mutation helpers, TTS regeneration options and dubbing preferences remain in use.
- Queued task leases remain reserved from enqueue until real completion; no double-reservation wrapper. Final-state persistence failure cannot prevent releasing the task lock.
- TTS rerun keeps a new directory while copying compatible audio/manifest cache from the previous run. This preserves data without spending synthesis calls on unchanged groups.
- Timeline test now explicitly requests freeze for short clips and verifies missing consent is rejected; still checks rendered colors, audible narration tail, dimensions,30/60 FPS and4K.
- Legacy ownership fixture now contains an actual scene so the ambiguous-workspace assertion reaches the intended safety check. Test is retained, not deleted.

## Verification status

See final update below and the integration test matrix. No live-provider success or clean Windows installation is inferred from offline tests or execution on this development host.

## Final integration commits

| Commit | Verified change |
|---|---|
| `365b9e9` | Preserve canonical task/session operations, release locks despite final-state persistence failure, guard fill-mode IPC, keep revision invalidation and timeline FPS/audio behavior, copy compatible TTS cache into new run; include only the necessary atomic-write and invalid-duration hunks from `31204ba`/`b12aaa0` |
| `5f8f0d4` | Reject stale project selection before session start; do not silently use another active project's config. Re-run project isolation/snapshot tests and full build afterward |
| `4222182` | Bounded production updates: axios 1.20.0, fast-uri 3.1.8, js-yaml 4.3.2, source-map-js 1.2.2; actual local HTTP binary/redirect/cancel regression |
| `7e68f09` | New secret writes fail closed without DPAPI; production CSP hashes static Next bootstrap scripts; unit regression plus real packaged encryption/restart and Chromium enforcement |
| `2bb50e7` | Explicit Turbopack root and isolated clean-dependency full build harness; no mutation of shared node_modules |
| `7392257` | Scoped packaged UI/IPC/DPAPI/CSP acceptance, native ASR/export cancellation and large-editor test harnesses; no additional application behavior |

Subsequent test/evidence/documentation commits on this branch contain the acceptance harness and reports, not additional application behavior. Exact remote commits retained are listed in [retained-origin-commits.txt](integration-evidence/2026-10-15/retained-origin-commits.txt); the original divergence is in [source-branch-graph.txt](integration-evidence/2026-10-15/source-branch-graph.txt). The final fetch still returned `899088f075891412f247e51f9433a29d4ab4223f`; `origin/main` is an ancestor of the integration branch. The audit branch is a comparison source, not a merge parent: rejected duplicate implementations were not silently included by a full merge.

## Conflicts and regression decisions

1. **Project storage:** retained remote atomic unique-directory allocation and ambiguous legacy collision guard. Episode workspaces use the remote pinned owner/catalog checks. The local allocator/session persistence replacements were redundant or weaker.
2. **Task/workflow lifecycle:** retained remote queued reservation and one canonical registry. Audit taskLease is a compatibility export of that registry; a cross-module test proves contention. Workflow actual-node leases from the audit remain necessary and are retained independently.
3. **AI Studio:** retained snapshot/productionRevision/process-aware cancellation and script provider paths from origin. Incoming short-mode/media/fill-mode features were adapted to them. Rejected automatic Flow-project adoption and stale UI session overwrite, which could bypass ownership or restore stale pointers.
4. **Audio/render:** retained sentence-group TTS regeneration, per-task dubbing preferences, word boundaries, narration/BGM and explicit shot modes. New UUID outputs copy compatible cache rather than discarding it. Freeze is explicit; tests now request it and verify rejection without consent where required.
5. **Tests:** retained and adapted the project media isolation test to actual decoded PNG/persisted owner/session states; no test was deleted. Legacy fixture now reaches ambiguous ownership validation. Timeline fixtures generate their own media rather than silently skipping old missing files.
6. **Atomic writes/security:** took the small last-good-file fix instead of replaying the older whole session implementation. No unlink/copy fallback remains in that writer. New security helpers are additive and verified in the packaged app.

## Final-source F01–F16 verification

The [full report](CODEX_FULL_AUDIT_REPORT.md) contains a source-and-evidence row for **each F01–F16**, including retained remote implementations and limits. Key results: unique project isolation, active-node cleanup, episode pinning, locked atomic destination, shared task locks, session abort/resume gates, output preservation, script invalidation, TTS duration validation and secret redaction all pass their scoped regression tests. F16 is source/VM verified; the active extension/live Flow path is not certified.

## Build and acceptance results

- **Automated Test PASS:**38offline suites on isolated clean dependencies; extension fixtures synchronized and affected tests rerun; final project-start edit followed by three affected-suite reruns. [Final results](integration-evidence/2026-10-15/regression-final.json) retain retry metadata, not an invented all-green initial run.
- **Static/full build PASS:** main and renderer tsc; own npm ci; standard `npm run build` through Whisper CMake, Next Turbopack, main/preload and NSIS. Final full rebuild exit0. SHA256 verification found no differences across248 application source/config files. The original C/D dependency-junction limitation is not a clean-host build guarantee.
- **Real Runtime PASS, scoped:** final unpacked Electron EXE startup1,020 ms; actual preload IPC, foreign BrowserWindow rejection, Chromium CSP denial, DPAPI synthetic secret persistence/decryption, task/video fixture/SRT/AI Studio project save and restart.3 native binaries help/version exit0; actual packaged Whisper tiny inference and cancellation PASS; actual FFmpeg worker cancellation preserves the previous output and removes partial output.
- **UI E2E PASS, scoped:**6 routes, visible editor1,000 subtitle lines loaded in3,412 ms; screenshot inspected; settings/restart. Setup partly uses renderer preload IPC, so not every dialog/wizard is click-tested.
- **Measured performance:** final30s after large editor:4 processes, sampled total working set1,483.13→838.47 MiB; maximum sampled summed CPU0.834%. Earlier180s idle:740.64→595.26 MiB, CPU max0.95%. These are sampled totals, not full-session peaks or multi-hour leak proof. Large-editor RAM is an open performance concern. Four sampled final app PIDs were gone after ordinary close.
- **Distribution PARTIAL:** final NSIS installer172,510,930 bytes, SHA256 recorded, **NotSigned**. Built and unpacked EXE tested on the dev host. Installer clean Windows/VM installation **NOT TESTED**.
- **Live Provider PASS: none.** Flow generation count 0. Dedicated safe CDP/loaded extension patch unavailable; user previously deferred live acceptance. Translation/TTS/LLM/provider DAG quality is not inferred from mocks.

## Security and essential remaining gates

Production dependency scan improved9→5 High/0 Critical, with the remaining five affected packages in the braces/micromatch/fast-glob/shelljs/nodejs-whisper chain. No forced downgrade. ASR uses direct CLI spawn, but the dependency/build supply-chain risk remains open. New secret writes fail closed; legacy weak records are still readable and not mass-migrated. CSP is enforced; bridge pairing, media capabilities and comprehensive IPC schemas remain open.

Active-job app quit/OS crash recovery across all runners, Python/OCR/stems portability, multi-hour/concurrent-job soak, clean Windows installation, live Flow/provider pipelines and large-project memory acceptance remain essential work. No release or main merge is claimed. Consult the [risk register](CODEX_RISK_REGISTER.md), [test matrix](CODEX_TEST_MATRIX.md), [production gates](CODEX_PRODUCTION_READINESS.md) and [raw evidence notes](integration-evidence/2026-10-15/README.md).

## Release Candidate continuation —2026-10-16

Source reconciliation remains intact; re-fetch still899088f. Additional commits:8b969c5 pairing/socket binding; ddc8cfb current-secret migration/Flow encryption;5b8358d IPC bounds/schemas;c808758 media grants and packaged extension;d92f138 editor pagination;1057870 TTS cancellation/artifact safety;a2dfa32 bounded Electron/Next patches and build-only wrapper;0052135 junction ownership/lease guard;b9efaab protocol 2 mutual authentication with DPAPI key storage/nonce-port-origin binding and spoof/replay rejection;5183bca pairing migration instructions;a3082e3 reproduced asynchronous auth/RPC race fix (without blocking cancellation);a3ebe7b bounded RC harnesses. See [RC acceptance](CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md) for current source/build/runtime results, limits and release decision. Earlier integration38suite/5 High/version numbers above are historical. Main remains unchanged.

## OCR stabilization continuation — 2026-10-16

Re-fetch stillorigin/main899088f; local main unchanged and all original tracked/untracked files preserved.884591d fixes newly reproduced OCR data loss/partial-frame leakage; it retains earlier integration/security patches.46 regressions, isolated main/renderer types/targeted OCR, full NSIS rebuild, 20 UI checks and5actual packaged OCR cases PASS in scope. Exact source/package hashes and new before/after evidence are in [current RC acceptance](CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md)/[phase evidence](rc-evidence/2026-10-16/README.md). VM kit prepared locally, not installed/published. Clean Windows BLOCKED; Flow/provider live NOT TESTED; no main merge/release.
