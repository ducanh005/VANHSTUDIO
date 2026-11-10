# ChatGPT Web response collection — 2026-10-06

Applied to the running checkout at `D:/DEAN/DEAN/VANHSUB`, preserving existing local changes.

## Confirmed cause

Read-only inspection of the Chrome conversation reported in the timeout showed visible user and assistant content, but zero matches for `data-message-author-role`, `article`, and `.markdown`. The assistant body instead lived under `data-chatgpt-search-unit-key="…:assistant"`, with a direct `data-conversation-role="assistant"` heading followed by its body. The old selector cascade never found a response, leaving the observed length at -1.

The master-prompt service caught this error and returned its hardcoded `promptTemplate`. That explains why the app displayed different content from Chrome. A separate extraction risk was accepting the shared clipboard after a failed Copy click.

## Changes

- Support the observed assistant container and role-heading layout while retaining legacy selectors.
- Read assistant body text directly; exclude role labels/user text and collect multiple answer blocks without duplicated nested prose.
- Capture the assistant count before submission and require a new turn. Compare actual text stability, not only length.
- Do not resend an accepted prompt when response collection fails.
- Fail if submission cannot be confirmed; include assistant counts in timeout diagnostics.
- Propagate remote master-prompt failures or empty/echo results through the existing IPC/UI error path. Preserve the current prompt instead of silently substituting the built-in template. The explicit no-provider path still uses the local template.

## Verification

- `tests/test_chatgpt_current_dom.ts`: 8 passing regressions in isolated headless Chromium, including the observed DOM layout, role-only fallback, legacy multi-block output, old/new turns, clipboard isolation, no duplicate sends, and master-prompt failure propagation.
- `tests/test_chatgpt_script_collector.ts`: 21 passing existing tests.
- TypeScript check passed.
- Main/preload webpack build succeeded. Existing optional native dependency warnings remain.
- The live Chrome CDP endpoint became unavailable before a post-fix live collection could be performed. No new prompt was sent to the user's conversation during diagnosis. A fresh end-to-end generation still needs verification after restarting the app.

The `app/main.js` and `app/preload.js` bundles were rebuilt in this checkout. Restart VANHSUB from this directory to load them. No installer was produced.

## Follow-up: missing contract lines and idea submission

The output sanitizer removed every input line of at least 40 characters from the response. This deleted verbatim contract lines required in a generated master prompt, including narration directions, placeholders, and the output-only instructions. Master-prompt output now bypasses this destructive line sanitizer; whole-response echo validation remains.

Submission handling now reads a textarea's live value without falling back to its stale default text, re-resolves a replaced composer, and accepts a newly added user message matching the sent prompt as confirmation. Send buttons are resolved within the composer's form when present, with exact English/Vietnamese accessible labels prioritized. Failed clicks no longer count as successful; Enter fallback can run. An unconfirmed send no longer triggers a second blind click.

The Chromium regression suite now has 13 passing cases, adding verbatim contract preservation, stale textarea defaults, unrelated send buttons, delayed editor clearing, no-op submission rejection, and failed-click Enter fallback. TypeScript passes. Live idea generation remains unverified because the Chrome CDP endpoint was unavailable during this follow-up.

## Follow-up review and repairs: incomplete responses

- Removed destructive per-line/substring filtering for idea and script outputs too. Legitimate repeated titles/source facts remain intact; complete input echoes still fail validation.
- Master-prompt completion now requires the output contract, narration direction, and final output-only instruction. The source boundary in section 2 is no longer treated as the end of the answer.
- Idea completion requires a parseable JSON object, not merely any closing brace from a nested object.
- Script stitching no longer invents an END SCRIPT marker. Continuation exhaustion checks the requested minimum sentence count; empty or unchanged continuation results stay incomplete.
- Native Continue click errors propagate; waiting requires the answer to change before accepting the expanded turn.
- Both facade entry points reject truncated results. Failed format/schema repair no longer silently returns an invalid result.
- Verification: 18 regression cases (Chromium DOM plus mocked facade/continuation cases), 21 collector tests, TypeScript, and main/preload webpack build pass. The old test which treated section 9's heading alone as completion was corrected to require the final contract.
- Chrome CDP port 9223 remained unavailable. No claim of live authenticated generation success is made. Restart the D-drive application to load the rebuilt main/preload bundles.
