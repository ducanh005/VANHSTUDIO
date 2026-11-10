# VANHSUB Phase 2 synchronization validation — 2026-10-09

This continues `TIMING_PIPELINE_AUDIT_2026-10-09.md`. The previous ASR/OCR/hybrid timing repairs remain in place. Production readiness is **not established** because no representative video with annotated speech and hard-subtitle boundaries is available in the project.

## Confirmed findings and repairs

| Finding | Repair |
| --- | --- |
| `test_r2_visual_wrapping_seamless_tts.ts` expected deprecated `segmentSubtitlesNetflix` to consolidate clauses by default, but its default is `consolidateClauses: false`. This was an old test assumption, not a production regression. | Test now checks the unmerged default and explicitly enables consolidation for the two-block case. Production segmentation was not changed. |
| The word segmenter test expected adjacent short sentences to remain joined, contrary to the preceding audit's default `splitShortTerminalBeforeCapital: true` repair. | Test now checks the new default and the optional legacy behavior. Word-level segmentation was not changed in Phase 2. |
| `nodejs-whisper` carried whisper.cpp source but no `whisper-cli.exe`; installation alone did not build it. | Added a reproducible CMake build command to `package.json`, included it in `npm run build`, and copied the Release EXE and DLLs to packaged resources. `whisperEngine.ts` resolves the packaged binary, supports an explicit binary override, places packaged models in the writable user cache, and errors when the executable is absent. Windows CLI and fallback router passed on the bundled JFK WAV sample. The packaged CLI and DLLs also transcribed that sample; installed-app execution remains untested. |
| TTS duration adaptation happened only at merge time; a 1–5% overrun could be cut because the old threshold skipped stretching. The final dialogue could borrow remaining media time beyond its source end. | `ttsTiming.ts` measures generated MP3 duration, optionally requests a natural shortening, retries supported provider rate, and rejects speech beyond the configured tempo limit. `dubbingEngine.ts` now stretches any measured overrun and uses the source dialogue end as its speech deadline while padding later silence. Default tempo limit is 1.35×, configurable with `VANHSUB_MAX_TEMPO` from 1.0–1.5. |
| A failed automatic audio merge could still leave the TTS task marked done; a missing TTS group could silently become silence. | `ttsRunner.ts` now propagates merge failure; `dubbingEngine.ts` rejects missing group audio. Invalid renders are not accepted. |
| Timeline sidecars lacked specific evidence for merged speakers, repeated IDs, ASR/OCR offset changes, and dub duration decisions. | `timelineDiagnostics.ts` reports these cases when source evidence exists. TTS writes attempts and conflicts; merge writes its anchored schedule or a missing-audio/timing-conflict issue to the existing `.timeline.json`. These are trace records, not automatic timestamp corrections. |

## Timing examples and actual measurements

| Case | Before | After / measured |
| --- | --- | --- |
| 1.04 s MP3 for a 1.00 s dialogue interval | Under the old 5% threshold, the fixed chunk could cut the tail. | Tempo is applied; regression test sees an overrun record. |
| 1.44 s MP3 for the last 1.00 s dialogue, with media continuing to 5.00 s | Final line could use remaining media as a 4.00 s slot. | Conflict at subtitle 2: needs 1.44×, above the configured 1.35× limit. |
| Five 1.50 s dialogue intervals with 2.53 s speech each | Legacy stress test accepted output if cumulative drift stayed below 3 s. | First interval reports a 1.69× conflict; no output accepted. |
| Synthetic two-turn MP4, starts at 1,000 and 2,500 ms | Previous audit fixed cursor drift. | Decoded rendered first audible samples remain at 1,000 and 2,500 ms: measured onset errors 0 and 0 ms. Synthetic only. |
| Bundled JFK WAV, 11.00 s | No live whisper.cpp fallback because executable was missing. | whisper.cpp tiny returns 0–10,500 ms SRT; Faster-Whisper tiny returns 22 words from 0–10,520 ms. No annotated ground truth, so accuracy error is unknown. |
| JFK speech with one manually translated Vietnamese Edge voice | No provider-backed adaptation evidence. | Source first audible sample 72 ms. Normal 10,520 ms slot: dubbed onset 257 ms, difference +185 ms; Edge MP3 7,080 ms. Stress 6,000 ms slot: Edge 7,080 ms at 1.00×, 6,740 ms at 1.05×, merge atempo 1.12895×; dubbed onset 205 ms, source difference +133 ms, last audible sample 5,208 ms. One speech turn only; this is not video-wide drift or linguistic-quality validation. |

## Validation status

**PASS:** `npm run build:main`; `npm run build:whisper-cpp`; full `npm run build` including Windows installer; packaged `resources/whisper/whisper-cli.exe` transcribed the JFK WAV; `npm test` (38/38); R2 visual wrapping (21/21); word segmenter (9/9); hybrid fusion (11/11); OCR deterministic suite (7/7); translator alignment (29/29); empirical M2 stress (15/15); adversarial M2 critic (14/14); pipeline timing regressions; new TTS adaptation and missing-binary tests; ASR fallback router; actual JFK WAV with whisper.cpp and Faster-Whisper; Edge TTS speech sample and 6,000 ms stress run. `git diff --check` passed.

**FAIL:** None in the final relevant suite. Intermediate legacy-test failures were resolved by updating expectations to the current explicit timing contract. The configured Gemini key returned HTTP 400 “Please pass a valid API key” during the real speech stress run; the workflow continued with provider rate and time stretch, and the failed shortening attempt was logged.

**BLOCKED:** Real-video ASR/OCR/HYBRID event accuracy, SRT translation timing against annotated frames, video PTS/stream-offset behavior, long-term dubbed drift, and installed-app first-run/model-download behavior. The repository has no representative video fixture or ground-truth annotations. The bundled JFK WAV establishes audio execution only. End-to-end shortening quality and meaning preservation also require a working translation API key and human review.

## Remaining production limitations

- OCR uses FFmpeg's uniform `fps` sample index for timestamps. It does not retain each decoded frame's original PTS, detect variable-frame-rate frame timing, or correct stream start offsets. Appearance/disappearance uncertainty is at least one sampling interval without frame-level evidence.
- whisper.cpp fallback emits coarse SRT events without word alignment; the primary Faster-Whisper path supplied word boundaries on the JFK sample.
- OCR-only dubbing uses text display time as a proxy for speech because it has no acoustic evidence. Hybrid offset warnings require review; they do not prove a mismatch by themselves.
- Automatic shortening is a model suggestion with protected numbers and negation, not a verified semantic equivalence proof. The available key was rejected, so the shortening branch passed only injected tests. Audible validation currently checks non-silent output and duration; it does not recognize the generated spoken words or assess subjective voice quality.
- MP3 duration includes provider-leading and trailing silence. The measured Edge onset lag was 133–185 ms against the JFK recording; a single manually translated turn cannot establish lip sync or cumulative drift. A real multi-speaker video with ground-truth speech/display boundaries is required.
- Overlapping simultaneous speakers still require separate audio tracks. The current fixed-lane renderer reports this conflict instead of moving unrelated audio.
