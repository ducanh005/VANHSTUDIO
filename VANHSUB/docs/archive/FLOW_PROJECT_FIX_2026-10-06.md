# Flow media/project corrections

Applied in `D:/DEAN/DEAN/VANHSUB` without discarding existing local changes.

## Causes

- Stage 6 preferred global Flow settings over session ownership. Without a configured ID, the visual service adopted the currently open Chrome project.
- The extension entered the first existing project link from the lobby before attempting New project. It also treated an intended project ID as confirmed even after navigation failed.
- Activity/CAPTCHA blocks were classified as retryable, causing repeated image/video requests despite a server rejection.

## Changes

- For the extension-backed pipeline, stage 6 uses the session's Flow URL exclusively. An unlinked session requests New project through a dedicated bridge command. The confirmed project URL is checkpointed before submitting media generation.
- Project preparation uses the browser mutex. Resume reuses the persisted project; session-based regeneration uses the same binding and rejects a conflicting ID.
- The extension no longer clicks arbitrary existing project links. New-project creation must produce a project URL distinct from the old one. Explicit navigation must confirm the requested ID; unbound RPC requests fail instead of adopting the active tab.
- The visual service no longer infers ownership from the active browser tab.
- Activity/CAPTCHA blocks stop immediately in both image/video RPC retry loops and visual generation/re-generation. Ordinary rate limits retain backoff. No promise of automatic removal of a Google restriction is made.

## Verification and rollout

- `tests/test_flow_project_isolation.ts`: mocked Chrome project creation/resume/mismatch/failure checks, error classification, and dispatch stops after one activity-blocked request.
- `scripts/test_chrome_bridge_pure_rpc.ts`: image/video bridge and failure handling pass. The old assertion requiring CAPTCHA-block retries was changed to require halt.
- TypeScript and extension JavaScript syntax checks pass. Main/preload rebuilt.
- No live Google generation or credit-consuming request was made. Upstream acceptance remains unverified.
- Reload the unpacked extension from this checkout, then restart VANHSUB. Existing sessions already linked explicitly to old projects retain that link; use a new unlinked session for a newly created Flow project. New creation occurs when stage 6 starts.
