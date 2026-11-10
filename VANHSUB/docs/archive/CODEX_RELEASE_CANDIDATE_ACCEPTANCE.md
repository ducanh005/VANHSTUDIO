# VANHSUB — Release Candidate Acceptance

Updated: 2026-10-16 (Asia/Saigon). Work/evidence began 2026-10-15; raw timestamps may be UTC. Branch: `codex/integration-stabilization-20261015`.

## Internal Beta / Public Release assessment — 2026-10-16

**Internal Beta: CONDITIONALLY READY** for controlled use on this Windows machine, new/copied projects and previously evidenced local functions. Flow/live providers/full Studio/workflow remain pending user-guided acceptance. Clean Windows VM is not an Internal Beta gate. **Public Release: NOT READY**; no main merge/release recommendation.

Actual integrated EXE is now running in a separate persistent beta profile; a real window and normal loopback bridge listeners were observed. No Chrome session, pairing or generation is simulated. User must load Extension 1.0.8/login/pair before live testing; generation/credits 0. No application code changed and no old PASS suite/build was rerun. [Independent decisions](VANHSUB_INTERNAL_BETA_STATUS.md), [Vietnamese user guide](VANHSUB_USER_ACCEPTANCE_GUIDE.md), [current preparation evidence](internal-beta-evidence/2026-10-16/runtime-preparation.json).

## Public release decision: NOT READY — do not merge or release

RC code has scoped build, regression, packaged runtime and UI evidence. **Clean Windows installation is BLOCKED**, Google Flow live is NOT TESTED, and full cloud-provider/OCR/browser/crash/long-session acceptance is incomplete. No main merge, installer publication or release was performed. A green local test is not clean installation or live-provider certification.

## Git and review status

- Re-fetched `origin/main`: `899088f075891412f247e51f9433a29d4ab4223f`, unchanged from integration baseline. It remains an ancestor of this branch; all 27 remote commits are retained.
- Local main remains `df9d768`. Audit branch `codex/full-audit-20261015=f164e0f` was selectively reconciled as documented in [integration report](CODEX_INTEGRATION_REPORT.md); no full merge reintroduces rejected duplicate implementations.
- Application code through `884591d`, extension instructions `5183bca`, acceptance harnesses `a3ebe7b` / `ce6275e` / `286ac1d`. Test/report commits follow. No reset/force push, no modification of user uncommitted files. Original checkout was not switched.
- Branch is for review only. No actual PR is claimed: GitHub PR creation tools/gh are not available in this session. A review description is prepared in [RC PR description](CODEX_RC_PR_DESCRIPTION.md); the branch can be compared against main on GitHub.

| RC commit | Change / verification |
|---|---|
| `8b969c5` | Extension 1.0.8 pairing: one-use 128-bit code, 2-minute expiry / 5 attempts; initial Origin-bound pairing (superseded by protocol 2 in b9efaab); reconnect/revoke; replies bound to originating socket. Real loopback tests, extension VM and packaged app/synthetic-peer acceptance |
| `ddc8cfb` | Fail-closed verified migration for valid current settings/Studio LLM/Flow keys; encrypt Flow API key on new writes. Atomic replacement is prepared before store write; synthetic DPAPI migration/restart verified |
| `5b8358d` | Generic IPC bounds 16 MiB/depth24/prototype-key rejection plus schemas for critical task IDs, local paths, subtitle/export/TTS calls; real privileged IPC negative cases |
| `c808758` | Media file/project/selected-root grants, physical containment, no cwd/active-project guessing, ambiguous relative paths denied; media/image/SRT boundaries. Bundle extension/popup and resolve resources independent of working directory |
| `d92f138` | Editor mounts 100 rows/page, retains all 1,000 lines in model; first/last-page edit/save and off-page preservation verified |
| `1057870` | Confirmed TTS cancel/reset bug: stop retries after cancel and report cancelled; preserve last completed merged audio/video pointers until full rerun succeeds. Actual local HTTP reset/audio processing/rerun test |
| `a2dfa32` | Electron 43.5.0, Next 16.3.8 and corresponding Next/Sharp platform patches; move unchanged nodejs-whisper to build-only dependency. No mass upgrade/downgrade; native/runtime/package checks |
| `0052135` | Physical/junction SRT paths share task ownership, active lease and invalidation; regression verifies busy edits denied and idle edits invalidate correctly |
| `b9efaab` / `5183bca` | Protocol 2 mutual HMAC proofs, fresh nonce bound to actual listening port/extension Origin; no raw code/bearer token in auth requests, DPAPI-encrypted derived server key, fail closed if encryption is unavailable. Tests reject fake AUTH_OK/server proofs, wrong-port relay and old-nonce replay. Old pairing requires re-pair; instructions updated |
| `884591d` | OCR rerun preserves completed SRT/translation/TTS/video until success; failed/cancelled native extraction cleans owned partial frames. Real packaged before/after evidence, 275 ms observed cancel, successful cached-model PaddleOCR Latin recognition and downstream revision invalidation |
| `a3082e3` | Reproduced async HMAC race: RPC immediately after AUTH_OK was dropped. Commands now await authentication only; a pending generation handler does not block cancellation. Extension VM regression verifies both behaviors |

## Follow-up acceptance — 2026-10-16

Continued from 79577fe; no audit restart or replacement of prior fixes. New P1 was reproduced on the packaged app: failed OCR reruns lost six output references and deleted a completed TTS line; malformed video also leaked its temporary frame directory. Commit 884591d fixes both and enables cancellation during native frame extraction. [Before](rc-evidence/2026-10-16/ocr-recovery-before.json)/[after](rc-evidence/2026-10-16/ocr-recovery-after.json): all 5 scoped cases PASS, including actual PaddleOCR recognition using existing cached Latin models, not a mock/cloud provider. Old completed bytes survive even successful reruns; stale downstream references are invalidated only on success. Python networking/DNS were denied by an isolated test guard, with no package/model installation.

Final rebuild uses the unchanged prior isolated npm-ci dependency snapshot. 46 source-workspace offline/loopback suites PASS; the new native OCR suite was also checked against the isolated release dependencies. Main/renderer standalone types, full production/NSIS rebuild and 20 actual packaged UI/security/persistence checks PASS. Current artifact source/config hashes and all 8 packaged extension files match. Earlier job/crash/soak measurements below retain their stated source/date; they were not rerun or relabeled as clean-host/live-provider results.

Clean Windows remains **BLOCKED** and Flow live **NOT TESTED**, rechecked this phase. A checksum-verified local [VM handoff kit](rc-evidence/2026-10-16/clean-vm-kit.json) is prepared with unsigned installer, synthetic media/SRT, read-only baseline collector and a [clean-guest checklist](CODEX_CLEAN_WINDOWS_ACCEPTANCE.md). The installer was not executed and the kit is not a published release or installation PASS. 0 generation/credit. Refreshed audit remains 0 production / 8 High / 8 Moderate full toolchain; no dependencies changed this phase.

## Clean installation: BLOCKED

Physical dev host: GIGABYTE G5 GE/Windows 10.0.26200, 16 GiB RAM. Hypervisor present/vmcompute running does not establish an independently controlled Windows guest. No accessible Windows VM endpoint, Get-VM/VBoxManage/vmrun/qemu/WindowsSandbox executable or running Windows guest was found. Optional-feature enumeration requires Windows administrator elevation; no OS feature or VM was installed/enabled.

| Requirement | Result |
|---|---|
| NSIS install/uninstall on clean Windows/VM | **BLOCKED** |
| Clean-host native/Python/model/font dependencies and installer ACLs | **BLOCKED** |
| Upgrade/uninstall preservation on clean guest | **NOT TESTED** |
| Full build/NSIS creation, unpacked EXE launch and restart on dev host | **PASS, scoped** |
| Unicode/space profile/project/media/SRT/export paths on dev host | **PASS, scoped** |
| Signature | **NotSigned**; no signing identity available/applied |

See [environment evidence](rc-evidence/2026-10-15/clean-windows-environment.json) and [installer hash/size](rc-evidence/2026-10-16/release-artifact.json). Installer was not installed on the user's dev host as a substitute for clean acceptance. Keep this gate blocked until an independent guest is supplied.

## Build, regression and packaged acceptance

- Own same-drive build workspace, original isolated npm-ci snapshot, current full `npm run build` rebuild: Whisper CMake → Next Turbopack static renderer → main/preload → electron-builder NSIS. Final source/config integrity and build result are recorded separately; no shared node_modules mutation.
- Main and renderer standalone TypeScript checks PASS. 46 offline/loopback suites PASS; fixtures/provider stubs retain their offline classification. Actual FFmpeg fixtures remain real native processing.
- Actual unpacked Electron 43.5.0:20 scoped UI/runtime checks, no unexpected page/console errors. Six routes, actual foreign-window IPC rejection, Chromium CSP enforcement, DPAPI migration/decryption, project/task/SRT/settings save/restart, editor1,000 lines and pairing/media checks.
- Archive excludes JS Whisper wrapper and its braces/micromatch/fast-glob/shelljs chain; Next/Sharp build packages also excluded. FFmpeg/FFprobe/Whisper help/version checks pass. Packaged ASR runs with an isolated model cache, without relying on repo node_modules at runtime.
- Native FFmpeg is an older 2018 build and FFprobe 2023; npm audit does not cover vulnerabilities in these native binaries. Compatibility/codec exposure across clean machines is not certified by `-version`. Python/OCR/stems clean-host acceptance remains open.

Evidence: [final regression](rc-evidence/2026-10-16/regression-final.json), [runtime UI](rc-evidence/2026-10-16/runtime-packaged.json), [source/package integrity](rc-evidence/2026-10-16/source-and-package-integrity.json), [build](rc-evidence/2026-10-16/build-final-result.json), [native inventory](rc-evidence/2026-10-16/package-module-presence-clean.json).

## Crash, cancellation and recovery

| Scenario | Classification / result | Practical limit |
|---|---|---|
| Close while actual packaged Whisper is running | **Real Runtime PASS** | Observed native child exits, prior SRT retained, restart clears phantom running. Existing tiny model/public sample; no download |
| Complete ASR on public JFK speech | **Real Runtime PASS** | Actual packaged TaskRunner saves recognized SRT; not a multilingual accuracy benchmark |
| Close while TTS request is pending | **Real Runtime PASS, synthetic local HTTP provider** | Socket disconnects; restart preserves completed MP3 pointer/data. No provider-live synthesis claim |
| Close during translation after first checkpoint batch | **Real Runtime PASS, controlled local transport** | Restart reuses completed batch and requests only the missing one; no actual Gemini network request |
| Local socket reset / timeout | **Real Runtime fault-injection PASS** | Actual loopback TCP reset and500ms test timeout. Production default timeout and host-wide internet loss are not certified |
| TTS cancel → request failure → rerun | **Real HTTP/native integration PASS** | Cancelled request is not retried, previous audio retained, runner released, synthetic-audio rerun succeeds. Current external in-flight request is still cooperative/bounded by its timeout |
| Two distinct TTS tasks / same-task duplicate | **Packaged Runtime PASS** | Two jobs finish, duplicate active ID rejected; five local synthetic-audio jobs complete. Not a live-provider concurrency stress test |
| SIGKILL during 1080p FFmpeg render | **Real Runtime PASS** | Kill actual Electron main PID, observed worker exits, previous output hash/pointer survives restart, status recoverable. Does not certify OS power loss or every child/provider/browser |
| OCR dependency/video failure, extraction cancel/rerun and actual cached-model recognition | **Real Runtime PASS, scoped** | Five cases; no prior file/reference loss, 275 ms observed FFmpeg cancel, partial frames cleaned, duplicate job rejected, real Latin text recognized in 4,821 ms; dual engine/clean-host/sidecar quit remain untested |
| Successful subtitle video export with Vietnamese paths | **Real Runtime PASS** | Actual packaged FFmpeg hardsub and FFprobe confirm 2.000s video output |
| Remaining OCR dual-engine/Python shutdown, stems/Flow/workflow quit/crash and interrupted writes on every path | **NOT TESTED** | Still essential recovery coverage |

[Job evidence](rc-evidence/2026-10-15/job-runtime.json), [hard-crash evidence](rc-evidence/2026-10-15/hard-crash-render.json), [TTS regression log](rc-evidence/2026-10-15/tts-cancel-after.log).

Important correction: on Windows, Playwright's launcher PID differs from actual Electron main PID. Early attempts killed the launcher and were falsely interpreted as app orphaning. Corrected tests obtain `process.pid` inside Electron and verify OS exit. Baseline also passes the corrected hard-crash case. A proposed guardian prototype was discarded; **no new native supervisor/architecture change ships**. Keep failed harness evidence separate from app findings.

Historical job and 600s idle evidence use 0052135; render SIGKILL was last run on a3082e3. Current 884591d full rebuild, 46 source regression suites, 20 UI checks and 5 OCR runtime cases are separate. Unchanged historical job/crash/soak results are not relabeled as 884591d acceptance.

## Google Flow: NOT TESTED LIVE

Extension source/package is 1.0.8, with previous tab ownership/I2V provenance protections retained. Node `vm` source fixtures cover active/background user-tab isolation; real app loopback pairing/reconnect/revoke uses a **synthetic extension peer**. These do not prove Chrome MV3 is loaded or Google generation works.

Before tests, dedicated CDP9224 and bridge9222/8765 TCP ports were closed. No authenticated dedicated Flow session was available. No personal Chrome tab was selected; no CAPTCHA/anti-bot bypass. **Generation count 0; credits incurred by this audit 0.** Real Flow I2V/T2V/download/decode/provenance and live disconnect/reconnect remain NOT TESTED. See [Flow status](rc-evidence/2026-10-15/flow-live-status.json).

## Security disposition

Production dependency audit: **0 vulnerabilities** after moving the unused JS wrapper out of runtime and inspecting the archive. This is not a zero-security-risk claim: Electron is declared as a devDependency but its shipped binary was separately upgraded/verified 43.5.0. Full toolchain scan remains **8 High/8 Moderate/0 Critical**; the original braces chain still exists for building Whisper. No blind Whisper/builder downgrade.

Targeted versions follow the [Electron advisory](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq) and [Next Windows server advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36)/[Next 16.3.8 release](https://github.com/vercel/next.js/releases/tag/v16.3.8). Static production export does not expose a Next server, but development/build tooling still requires triage. [Production scan](rc-evidence/2026-10-16/dependency-production.json), [full scan](rc-evidence/2026-10-16/dependency-full.json).

Protocol 2 pairing is fail closed for unapproved sockets and unauthenticated servers; browser Origin alone is no longer authorization. Token storage is restricted to extension trusted contexts, following [Chrome storage access-level guidance](https://developer.chrome.com/docs/extensions/reference/api/storage). Real installed-MV3 compatibility remains unverified. Nonce replay, wrong-port proofs and forged server acceptance are rejected in targeted tests. The derived server authorization key is encrypted using DPAPI; raw pairing codes/bearer tokens are not sent in authentication requests. Old protocol pairing requires re-pairing. Local hostile-process DoS and comprehensive rate/resource policy remain open.

Media access now requires known files or physically contained approved roots and media extensions; traversal, unknown config/image reads, junction escape and ambiguous relative names are denied. Root grants can be broad when a user explicitly selects a broad directory; all IPC channels do not yet have complete semantic schemas. CSP continues to allow style inline/HTTPS media/font and loopback WS for necessary features. Legacy current-config migration passed using synthetic secrets; old episode snapshots/corrupt-config recovery were not mass-migrated or rotated.

## Performance and reliability measurements

| Scenario | Measured result | Scope |
|---|---|---|
| Idle fixed-artifact soak | 602.577s / 121 samples; 4 processes; RAM 487.72 → 448.45 MiB (min 447.30); sampled CPU sum max 0.16% | Dev host, bridge disabled, source through 0052135 |
| Idle kernel/listener counts | Main handles 979 → 960; threads 53 → 48; selected IPC events 3 / before-quit listeners 0 throughout | Total handles, not file-specific; does not prove no leak |
| Final 1,000-subtitle editor/UI smoke | Startup 1,047ms; first 100-row page 822ms; first/last-page edit+save 2,526ms; 100 mounted textareas | Final 884591d; all 1,000 lines retained and saved |
| Final post-UI 30s sample | 6 samples / 5s; RAM895.43 →675.68MiB; sampled CPU sum max1.08% | Electron process working-set sum, not whole-session peak |
| Earlier editor/security 180s sample | 36 samples; RAM 922.11 → 651.26 MiB; sampled CPU sum max 1.06% | Earlier source; editor unchanged; separate UI sequence |
| Five local synthetic TTS jobs | 4 processes before/after; RAM 500.72 → 549.26 MiB; main handles 985 → 975; 52 threads | Selected IPC events 3 / quit listeners 0; ProcessWrap8/PipeWrap26 observed immediately after jobs, later settled |
| After fault tests / successful export | RAM 539.77 / 544.37 MiB; 4 processes; main handles 981; selected IPC3/quit0; PipeWrap2, no ProcessWrap | Same restarted main; no monotonic leak claim |
| During 1080p render | FFmpeg RAM 619.03 MiB; private 772.86 MiB; 267 handles; CPU 36.12% of machine across 554.82ms / 16 logical processors | One native worker sample, not peak or full-job average |
| After final close | No executables remaining within owned RC unpacked build or fixed soak artifact | Does not certify every user/browser process |

Sources:[resource summary](rc-evidence/2026-10-16/performance-summary.json), [idle raw samples](rc-evidence/2026-10-15/idle-soak600.json), [final owned-process check](rc-evidence/2026-10-16/process-after-close.json).

Large-editor measurements are sampled process working sets after different UI sequences, not controlled percentage-speedup or full-session peak benchmarks. First-page timing now means 100 mounted rows; the full 1,000 subtitle lines data model and off-page save integrity are verified separately. HandleCount is the process's total kernel handles, not a per-file handle inventory. Listener/resource samples cover selected main/IPC counters only. Short runs and stable counts do not prove no leaks.

A soak attempt was invalidated by rebuilding its active artifact, causing Windows EPERM. It is not acceptance PASS. The final harness refuses an active build target and runs soak from a private fixed artifact copy. Multi-hour active-job soak, 10,000+ subtitle-line/media-heavy projects and clean-host resource limits remain untested.

## Remaining release blockers and next acceptance

1. Supply an independently controlled clean Windows guest; install/uninstall/upgrade/restart, Unicode/ACL/native/model/Python/fonts checks and signing/distribution acceptance.
2. Load extension 1.0.8 in a dedicated authenticated test Chrome/CDP profile; bounded live image/I2V/T2V, exact request/asset ownership, download/FFmpeg validation and reconnect/cancel. No anti-bot bypass.
3. Provider-live translation/TTS/full Studio/workflow pipelines with explicit budget and audio/semantic/timing review; local fixtures cannot close these gates.
4. Complete remaining OCR dual-engine/sidecar shutdown, stems/browser/workflow shutdown, OS interruption/write-failure/recovery and multi-hour concurrent-job soak. Workspace/catalog are still two atomic files, not a shared transaction.
5. Triage remaining build-toolchain advisories, full IPC semantic validation, granular root capabilities and legacy episode-secret/corrupt-config recovery.

**No merge recommendation while these essential gates remain open.** The branch/report are ready for human review; the application is not yet certified for production release.
