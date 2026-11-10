# VANHSUB — Production readiness after RC stabilization, 2026-10-16

## Public release verdict: NOT READY

Internal Beta on the current Windows machine is assessed separately as **CONDITIONALLY READY for controlled/local use**, with Google Flow/live-provider/full-pipeline acceptance pending user setup. A clean Windows VM remains a Public Release gate, not a mandatory Internal Beta condition. No old tests were rerun or new application fixes claimed during setup. [Beta status](VANHSUB_INTERNAL_BETA_STATUS.md) · [Practical Vietnamese guide](VANHSUB_USER_ACCEPTANCE_GUIDE.md).

Review branch:`codex/integration-stabilization-20261015`, descendant of `origin/main=899088f`. Main remains unchanged. The branch contains scoped fixes and acceptance evidence; no merge/release is recommended until essential gates below close.

| Gate | Current result | Evidence / limit |
|---|---|---|
| Git reconciliation | PASS on integration branch |27 remote commits retained, selected audit/local patches preserved, no reset/force/main merge; latest fetch unchanged |
| Main/renderer TypeScript and full NSIS build | PASS, isolated dev-host build |Own npm ci, Whisper CMake, Next 16.3.8/static export, Electron 43.5.0 packaging. Final source hashes checked; not clean installation |
| Regression |46 offline/loopback suites PASS |Includes pairing, IPC/media, DPAPI, TTS cancel/rerun, physical ownership and actual native OCR failure/cancel regression. Provider mocks remain offline |
| Packaged UI/security/persistence |20 scoped checks PASS |Actual CSP/foreign IPC denial, Windows DPAPI current-secret migration, pairing/revoke with synthetic peer,1,000 subtitle lines editor/pages/save, task/project/settings restart |
| Native/runtime flows | PASS within documented cases |New 884591d: five packaged OCR cases PASS (fault preservation, 275 ms native cancel/rerun, cached-model Latin recognition). Actual packaged Whisper; local HTTP TTS/translation close/reset/timeout/checkpoint/concurrency; FFmpeg Unicode export and corrected actual-main SIGKILL/restart. No new native guardian ships |
| Dependency/security | PARTIAL |Production scan0, runtime wrapper/chain absent, shipped Electron patched separately. Full toolchain8 High/8 Moderate/0 Critical; full schemas/granular grants/legacy snapshot migration still incomplete |
| Clean Windows NSIS install/uninstall/upgrade | **BLOCKED** |No accessible independent clean guest/VM/Sandbox; checksum-verified internal VM kit/checklist prepared, not installed. Running an unpacked EXE/profile on the dev machine is not Clean Installation PASS |
| Signing/distribution | OPEN |Installer is NotSigned; no release/publish performed |
| Google Flow and cloud providers | **NOT TESTED LIVE** |No dedicated authenticated session/CDP9224;0 generation/credit. Extension 1.0.8 source/VM and synthetic-peer pairing do not prove real Flow generation |
| Performance/reliability | PARTIAL |Editor100 rows/page retains1,000 lines; sampled RAM922→651MiB/180s and current895.43→675.68MiB/30s. Native render sample and kernel/listener counts measured. Idle602.577s/121samples,487.72→448.45MiB,4processes; limits in RC acceptance; not a multi-hour leak guarantee |
| All-job crash/recovery and full workflows | **NOT TESTED fully** |Remaining OCR dual-engine/Python shutdown/stems/browser/workflow interruption, OS power loss, every write-failure path and provider-quality acceptance remain open |

## Required next acceptance

1. Independent clean Windows guest: installer install/uninstall/upgrade, launch/restart, Unicode/space paths, ACLs, native/model/Python/fonts and signing/distribution.
2. Dedicated authenticated Flow/Chrome profile with extension 1.0.8: bounded image/I2V/T2V, exact request/media ownership, download/decode/timing, disconnect/reconnect/cancel. No anti-bot bypass.
3. Live translation/TTS/Studio/workflow provider runs with budget and semantic/audio/timing review. Synthetic local tone/HTTP fixtures cannot close this gate.
4. OCR/stems/browser/workflow shutdown and crash, cross-file checkpoint reconciliation, multi-hour concurrent/large-media soak and resource profiling.
5. Remaining build advisories, per-channel semantic validation, narrowly scoped media grants and legacy episode/corrupt-config/secret recovery.
6. Human review of integration/RC evidence before any main merge; no automatic release or merge.

Authoritative current detail:[RC acceptance](CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md), [risk register](CODEX_RISK_REGISTER.md), [test matrix](CODEX_TEST_MATRIX.md), [integration mapping](CODEX_INTEGRATION_REPORT.md), [evidence notes](rc-evidence/2026-10-15/README.md). Historical integration/audit evidence remains intact.
