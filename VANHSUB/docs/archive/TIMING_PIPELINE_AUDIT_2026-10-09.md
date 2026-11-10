# VANHSUB timing pipeline audit — 2026-10-09

## Existing path

| Stage | Implementation | Timing and state |
| --- | --- | --- |
| Decode and ASR | `main/asr/audioExtractor.ts`, `taskRunner.ts`, `asrRouter.ts`, `fasterWhisperEngine.ts`, `whisperEngine.ts`, Python faster-whisper server | FFmpeg extracts 16 kHz WAV. Faster-Whisper emits millisecond word positions and optional speaker labels; whisper.cpp fallback supplies coarser SRT positions. Router reports the fallback. |
| OCR | `main/ocr/frameExtractor.ts`, `ocrRunner.ts`, `paddleEngine.ts`, `resultMerge.ts`, `subtitleBuilder.ts` | FFmpeg fps filter samples video frames. Paddle OCR and optional Tesseract crop results are merged; text and box tracks become SRT events. OCR time means *visible text*, not proven speech. |
| Fusion | `main/asr/hybridRunner.ts`, `hybridFusionEngine.ts` | ASR and OCR run in sequence; candidate speech is compared with visual text. Matched speech timing now remains primary, with separate visual timing in the timeline JSON. |
| SRT and translation | `main/lib/srt.ts`, `srtNormalizer.ts`, `main/translate/translator.ts`, `translateRunner.ts` | SRT stores integer milliseconds, text, and optional speaker label. Translation retains one-to-one events and times. JSON sidecars retain evidence and stable source IDs when the mapping verifies. |
| TTS and render | `main/render/ttsEngine.ts`, `ttsRunner.ts`, `dubbingEngine.ts`, `dubbingRunner.ts` | TTS produces per-group MP3 and manifest. Dubbing probes actual duration, positions voice on source timeline, encodes merged audio, and muxes it with the video. |

## Confirmed defects and repairs

1. `frameExtractor.ts` rounded `1000/fps` before multiplying by frame number. At 3 fps, frame 300 was placed at 99,900 ms rather than 100,000 ms. The interval now retains its fraction; event boundaries round once.
2. `hybridFusionEngine.ts` concatenated every ASR candidate in the OCR time window and used visual time for matched speech. The following sentence could enter the current event. Fusion now selects one turn, uses ASR speech time in the hybrid runner, and preserves OCR display time as separate evidence. Multiple OCR phrases sharing one ASR turn use aligned words when available; unresolved splits retain visual time and receive `needsReview`.
3. `srtNormalizer.ts` could merge fragments, extend durations by reading speed, and shift overlapping events even when extraction had measured their boundaries. OCR and hybrid runners now use evidence-preserving normalization and report invalid/overlapping events without silently shifting them.
4. `wordSegmenter.ts` and the Python equivalent could join adjacent short sentences such as `Go. Now.` when the pause was under the duration threshold. A terminal mark followed by a new capitalized word now splits, with common abbreviations exempt. Different-speaker overlaps are no longer forcibly clamped together.
5. `dubbingEngine.ts` flexible mode advanced a cursor after long speech; both modes could cut off TTS above 1.5x. Each voice now starts at its source time. Moderate overrun is stretched within 1.5x; larger overrun and unsupported overlap fail with an explicit timing conflict. The final speech slot is bounded by measured video duration during video dubbing.
6. Separate TTS and dubbing SRT parsers relied on the numeric SRT labels and did not preserve speaker labels reliably. They now share the project parser; output audio filenames use event order, and the scheduler reads the same speaker and millisecond times as the rest of the pipeline.
7. `whisperEngine.ts` launched `/c` as the executable on Windows when its model was absent. It now invokes `cmd.exe` correctly and checks whether the downloaded model really exists; the bundled downloader was observed returning exit code 0 even for an unusable invocation.
8. The old SRT readers could silently skip malformed blocks and bind TTS files by numeric subtitle labels. TTS, translation, and dubbing now use strict parsing. New TTS manifests mark verified source text, which the dub scheduler checks against the SRT before placing audio; legacy manifests retain compatibility.

`main/lib/timelineDiagnostics.ts` checks malformed/non-finite times, duration bounds when supplied, duplicate intervals, long events, and same-speaker/unknown-speaker overlaps. The runners write `.timeline.json` beside their SRTs with original evidence and issues. These checks do not invent corrections without acoustic or visual evidence.

## Reproduction examples

| Input | Before | After |
| --- | --- | --- |
| ASR words `Go.` 100–250 ms, `Now.` 270–430 ms | Could form one `Go. Now.` event | Two events: 100–250 ms and 270–430 ms |
| OCR at 3 fps, frame 300 | 99,900 ms from rounded 333 ms interval | 100,000 ms from exact 1000/3 ms interval |
| OCR `First sentence.` 800–2200 ms with ASR 1000–1800 ms, neighboring speech 1850–2500 ms | OCR display window anchored; nearby ASR candidates concatenated | First speech at 1000–1800 ms; second at 1850–2500 ms; visual windows retained in JSON |
| 4050 ms generated TTS in a 1500 ms slot | Could shift later dialogue or lose speech tail | Explicit 2.70x timing conflict; no dubbed output is accepted |

## Validation

| Check | Result | Scope |
| --- | --- | --- |
| `npm run build:main` | PASS | TypeScript main process |
| `npm test` | PASS, 38/38 | Existing SRT/OCR normalization and mocked translation |
| `tests/test_hybrid_fusion.ts` | PASS, 11/11 | Existing fusion regressions |
| `tests/test_word_segmenter.ts` | PASS, 9/9 | Existing word segmentation |
| `scripts/test-ocr-suite.ts` | PASS, 7/7 | Deterministic OCR tracks |
| `tests/test_pipeline_timing_regressions.ts` | PASS | Deterministic ASR/OCR/SRT cases, generated TTS, decoded onset checks, and synthetic video mux |
| `tests/test_challenger_m2_empirical_stress.ts` | PASS, 15/15 | Existing 20-dialogue/60-second stress fixture and TTS grouping |
| `tests/test_translator_alignment.ts` | PASS, 29/29 | One-to-one translated line and timestamp identity |
| `tests/test_adversarial_m2_critic.ts` | PASS, 14/14 | Existing manifest and dub edge cases |
| `tests/test_r2_visual_wrapping_seamless_tts.ts` | FAIL, 20/21 | Case 1.4 expects `segmentSubtitlesNetflix` to consolidate to two blocks; this function and `nlpSegmenter.ts` were not changed in this repair. Its three audio merge tests pass. |
| `tests/test_asr_fallback.ts` | BLOCKED after two initial passes | The model download launcher now runs and `tiny` was fetched, but `whisper-cli.exe` is absent from this checkout's `nodejs-whisper` package. This dependency has no build output in the installed package, so the live whisper.cpp fallback could not run. |
| Representative production video with ground-truth speech and hard subtitles | BLOCKED | No media fixture in the repository. Synthetic rendering cannot establish real ASR or OCR accuracy. |

The generated dubbing test decodes merged audio and rendered MP4: the 0–900 ms lead and 2000–2400 ms gap are silent; voice is present at 1050–1500 ms and 2550–3000 ms. Measured first audible sample onset errors were 0 ms and 0 ms relative to the 1000 ms and 2500 ms source starts in this fixture (100 ms pass tolerance). It does not measure model accuracy.

## Remaining limits

- Whisper.cpp fallback has no word alignment in this path. Short phrase splits from one coarse ASR event remain review cases.
- The whisper.cpp CLI binary must be built or supplied before its live fallback path can be verified here.
- OCR sampling does not carry original variable-frame-rate PTS or explicit scene-cut detection. The FFmpeg fps filter gives a uniform sampled timeline; source stream offsets and cut transitions need real-media validation.
- An OCR-only SRT provides visual display timing. Its voiceover still uses that time as a scheduling proxy because no speech evidence exists. The JSON sidecar labels this source. A dub cannot claim acoustic alignment from OCR alone.
- The concat-based dub mixer cannot represent simultaneous speakers on separate tracks. It now reports overlap instead of moving one voice. Independent voice tracks would require a larger rendering change.
- Translation remains a one-to-one text mapping. The JSON sidecar preserves source relationships for matching events, but arbitrary user edits to an SRT or an external translation file can break that mapping; evidence propagation is skipped and logged when it does.
- No representative media or ground-truth annotations exist here. Production timestamp error, ASR word error, OCR event recall, and real-video lip or voice sync were not measured.
