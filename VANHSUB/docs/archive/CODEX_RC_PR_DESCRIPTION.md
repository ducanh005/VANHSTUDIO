# Draft review description — VANHSUB Release Candidate stabilization

Target:main. Head:codex/integration-stabilization-20261015. Suggested state:Draft. **Do not merge/release yet.**

This branch safely reconciles all 27 remote commits with selected audit/local fixes, preserving owner workspaces, snapshots/revisions, task leases and artifact invalidation. RC changes add protocol 2 mutual extension/server pairing (nonce/port/Origin-bound HMAC, DPAPI key storage), revocation and socket response binding, bounded IPC payloads, local file grants, verified current-secret migration, bundled extension resources, editor pagination and TTS cancellation/last-good-output preservation. Electron/Next were patched with a bounded lockfile update; the unused JS Whisper wrapper is build-only and absent from the shipped archive.

Validation:full clean-dependency production/NSIS build, main/renderer typechecks,46 offline/loopback suites, actual packaged UI/security/persistence checks, native ASR/export, controlled local HTTP close/reset/timeout/checkpoint/concurrency, Unicode paths and corrected actual-main SIGKILL/restart. Scope and resource measurements:docs/CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md.

Blocking acceptance:clean Windows installation/VM, signing, live Flow/provider pipelines, all-job crash/recovery and multi-hour stress. Full toolchain audit still has8 High/8 Moderate despite production scan0. No clean-install or provider-live PASS is claimed.

No PR was created automatically because this session has neither gh nor a GitHub PR creation tool. Branch comparison/review can use [GitHub comparison](https://github.com/ducanh005/VANHSUB/compare/main...codex/integration-stabilization-20261015). Do not treat this draft text as an existing PR.

OCR follow-up884591d: packaged before/after reproduces/fixes prior TTS-file deletion, six lost output pointers and temporary-frame leaks on failed rerun. Cancellation of observed FFmpeg stops in 275 ms, preserves prior files and permits rerun; cached-model PaddleOCR recognizes the synthetic Latin fixture. New NSIS rebuild and 20 UI checks pass. Clean Windows handoff kit is local/prepared only; clean installation and live providers remain unverified.
