/**
 * tests/test_challenger_m2_adversarial.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE FOR MILESTONE 2 (M2)
 *
 * Scope:
 * 1. Strict Duration Clamping Invariants ([2.0s, 8.0s]) across borderline and extreme values.
 * 2. Metaphorical vs Physical Action Parsing (figurative phrases vs genuine dynamics).
 * 3. Empty, Sparse, and Malformed Input Resilience in Script Models & Workspace.
 * 4. Multi-Clip Video Splitting & Continuity Verification.
 *
 * Execution:
 * .\node_modules\.bin\tsx.cmd tests/test_challenger_m2_adversarial.ts
 */

process.env.TEST_ENV = 'true';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import type {
  ScriptBeatLine,
  CinematographyPlan,
  AiStudioFlowEngineConfig,
} from '../main/ai-studio/types';

// ==============================================================================
// ScriptWorkspaceView Pure Helper Invariants (Mirroring UI Contracts)
// ==============================================================================

function formatCameraAngle(angle?: string): string {
  if (!angle) return 'Trung cảnh';
  const map: Record<string, string> = {
    wide_establishing: 'Toàn cảnh (Wide)',
    medium_shot: 'Trung cảnh (Medium)',
    close_up: 'Cận cảnh (Close-up)',
    low_angle: 'Góc thấp (Low Angle)',
    high_angle: 'Góc cao (High Angle)',
    point_of_view: 'Góc nhìn thứ nhất (POV)',
  };
  return map[angle] || angle;
}

function formatCameraMovement(movement?: string): string {
  if (!movement) return 'Cố định';
  const map: Record<string, string> = {
    pan_left_to_right: 'Lia phải (Pan R)',
    pan_right_to_left: 'Lia trái (Pan L)',
    dolly_in: 'Tiến lại (Dolly In)',
    dolly_out: 'Lùi ra (Dolly Out)',
    pedestal_up: 'Nâng máy (Up)',
    pedestal_down: 'Hạ máy (Down)',
    static: 'Cố định (Static)',
  };
  return map[movement] || movement;
}

// ==============================================================================
// Adversarial Test Runner Harness
// ==============================================================================

let passCount = 0;
let failCount = 0;
const testRecords: Array<{ id: string; name: string; passed: boolean; durationMs: number; error?: string }> = [];

async function advTest(id: string, name: string, fn: () => Promise<void> | void) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    passCount++;
    testRecords.push({ id, name, passed: true, durationMs });
    console.log(`  ✅ [${id}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    failCount++;
    testRecords.push({ id, name, passed: false, durationMs, error: err?.message || String(err) });
    console.error(`  ❌ [${id}] ${name} (${durationMs}ms): ${err?.message || err}`);
    throw err;
  }
}

// ==============================================================================
// Test Suites
// ==============================================================================

async function runAdversarialSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ADVERSARIAL EMPIRICAL CHALLENGER SUITE: MILESTONE 2 (M2)               ║');
  console.log('║   Duration Clamping, Metaphorical Actions & Sparse Row Resilience        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const storyboardService = AiStudioStoryboardService.getInstance();
  const llmService = AiStudioLlmService.getInstance();
  const tmpRoot = path.join(os.tmpdir(), `vanhsub_challenger_m2_${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  // ────────────────────────────────────────────────────────────────────────────
  // SUITE 1: DURATION CLAMPING INVARIANTS ([2.0s, 8.0s])
  // ────────────────────────────────────────────────────────────────────────────
  console.log('--- 🛡️ SUITE 1: ADVERSARIAL DURATION CLAMPING MATRIX ---');

  await advTest('ADV-DUR-01', 'planCinematography strictly clamps video duration for borderline values (1.9s, 2.0s, 7.9s, 8.0s, 8.1s)', () => {
    const testCases: Array<{ input: number; expected: number }> = [
      { input: 1.9, expected: 2.0 },
      { input: 1.99, expected: 2.0 },
      { input: 1.9999, expected: 2.0 },
      { input: 2.0, expected: 2.0 },
      { input: 2.0001, expected: 2.0001 },
      { input: 7.9, expected: 7.9 },
      { input: 7.99, expected: 7.99 },
      { input: 8.0, expected: 8.0 },
      { input: 8.0001, expected: 8.0 },
      { input: 8.01, expected: 8.0 },
      { input: 8.1, expected: 8.0 },
    ];

    for (const tc of testCases) {
      // Force video action via dynamic text and high tension
      const plan = storyboardService.planCinematography('Chiến binh chạy thật nhanh', undefined, 0.9, tc.input);
      assert.strictEqual(plan.media_type, 'video');
      assert(
        plan.duration_sec >= 2.0 && plan.duration_sec <= 8.0,
        `Expected duration in [2.0, 8.0] for input ${tc.input}, got ${plan.duration_sec}`
      );
      assert.strictEqual(
        Math.round(plan.duration_sec * 1000) / 1000,
        Math.round(tc.expected * 1000) / 1000,
        `Expected ${tc.expected} for input ${tc.input}, got ${plan.duration_sec}`
      );
    }
  });

  await advTest('ADV-DUR-02', 'planCinematography handles extreme / non-finite duration boundaries (negative, 0, 1000s, NaN, Infinity)', () => {
    const extremes = [-1000, -10.0, -1.0, -0.01, 0, 0.001, 0.5, 10.0, 100.0, 3600.0, Infinity, -Infinity, NaN];

    for (const val of extremes) {
      const planVideo = storyboardService.planCinematography('Người hùng lao vào lửa', undefined, 0.85, val);
      assert.strictEqual(planVideo.media_type, 'video');
      assert(
        planVideo.duration_sec >= 2.0 && planVideo.duration_sec <= 8.0,
        `Video duration for input ${val} violated [2.0, 8.0]: ${planVideo.duration_sec}`
      );
      assert(!isNaN(planVideo.duration_sec), `Video duration for input ${val} was NaN`);
      assert(Number.isFinite(planVideo.duration_sec), `Video duration for input ${val} was not finite`);

      const planImage = storyboardService.planCinematography('Bức tranh tĩnh lặng', undefined, 0.1, val);
      assert.strictEqual(planImage.media_type, 'image');
      assert(planImage.duration_sec >= 2.0, `Image duration for input ${val} violated >= 2.0: ${planImage.duration_sec}`);
      assert(!isNaN(planImage.duration_sec), `Image duration for input ${val} was NaN`);
    }
  });

  await advTest('ADV-DUR-03', 'decideMediaType strictly enforces Veo duration limits and clamps durationSec', () => {
    const borderlineDurations = [0, 1.2, 1.9, 2.0, 4.5, 7.9, 8.0, 8.1, 15.0, 60.0];

    for (const d of borderlineDurations) {
      // Empty text case
      const emptyDecision = storyboardService.decideMediaType('', undefined, d);
      assert.strictEqual(emptyDecision.media_type, 'image');
      assert(
        emptyDecision.duration_sec! >= 2.0 && emptyDecision.duration_sec! <= 8.0,
        `Empty text duration violated [2.0, 8.0]: got ${emptyDecision.duration_sec} for input ${d}`
      );

      // Action video case with explicit dramatic tension
      const actionDecision = storyboardService.decideMediaType('Nhân vật chiến đấu quyết liệt', undefined, d, {
        dramaticTension: 0.9,
      });
      assert.strictEqual(actionDecision.media_type, 'video');
      assert(
        actionDecision.duration_sec! >= 2.0 && actionDecision.duration_sec! <= 8.0,
        `Action decision duration violated [2.0, 8.0]: got ${actionDecision.duration_sec} for input ${d}`
      );
    }
  });

  await advTest('ADV-DUR-04', 'Multi-clip video splitting ensures EVERY sub-clip respects [2.0s, 8.0s] limits', () => {
    const splitMethod = (storyboardService as any).splitIntoMultiClips.bind(storyboardService);
    assert(typeof splitMethod === 'function', 'splitIntoMultiClips must exist');

    const testDurations = [8.1, 10.0, 12.0, 15.0, 16.0, 20.0, 24.0, 30.0, 45.0, 60.0];

    for (const totalDur of testDurations) {
      const mockDecision = {
        media_type: 'video' as const,
        reason: 'Action scene exceeding limit',
        confidence: 'high' as const,
        videoScore: 3,
        imageScore: 0,
        camera_angle: 'medium_shot',
        camera_motion: 'dolly_in',
        duration_sec: totalDur,
        dramaticTension: 0.9,
      };

      const subShots = splitMethod(
        'scene_01',
        1,
        totalDur,
        8.0, // maxClipSec
        'Cinematic prompt',
        'Camera tracking',
        mockDecision,
        0.0,
        [1],
        ['scene_01'],
        ['Dialogue text']
      );

      assert(subShots.length >= 2, `Total duration ${totalDur}s should split into at least 2 clips, got ${subShots.length}`);

      let cumulativeTime = 0;
      const seenIds = new Set<string>();

      for (let i = 0; i < subShots.length; i++) {
        const shot = subShots[i];
        assert.strictEqual(shot.media_type, 'video');
        assert(
          shot.duration_sec >= 2.0 && shot.duration_sec <= 8.0,
          `Sub-clip ${shot.shot_id} duration ${shot.duration_sec}s outside [2.0, 8.0] for totalDur ${totalDur}s`
        );
        assert(
          shot.expected_duration_sec >= 2.0 && shot.expected_duration_sec <= 8.0,
          `Sub-clip ${shot.shot_id} expected_duration_sec outside [2.0, 8.0]`
        );
        assert(!seenIds.has(shot.shot_id), `Duplicate sub-shot id ${shot.shot_id}`);
        seenIds.add(shot.shot_id);

        if (i > 0) {
          assert.strictEqual(shot.previous_shot_id, subShots[i - 1].shot_id, 'Previous shot ID chaining broken');
        }
        cumulativeTime += shot.duration_sec;
      }

      // Check sum covers total duration within precision
      assert(
        Math.abs(cumulativeTime - totalDur) < 0.2,
        `Sum of sub-shots (${cumulativeTime}s) deviated too much from total (${totalDur}s)`
      );
    }
  });

  await advTest('ADV-DUR-05', 'AiStudioLlmService splitScriptToBeatLines and generateStoryboardScenes enforce [2.0s, 8.0s]', () => {
    // 1. splitScriptToBeatLines with micro words, normal words, and long sentences
    const script = `
      Này!
      Hôm nay chúng ta sẽ cùng nhau tìm hiểu về những điều kỳ lạ nhất trong vũ trụ bao la này.
      Và đó chính là lý do bạn nên đăng ký kênh ngay bây giờ.
    `;
    const lines = llmService.splitScriptToBeatLines(script);
    assert(lines.length >= 3, 'Should produce at least 3 lines');
    for (const l of lines) {
      assert(
        l.estimatedDurationSec !== undefined && l.estimatedDurationSec >= 2.0 && l.estimatedDurationSec <= 8.0,
        `Line ${l.index} duration ${l.estimatedDurationSec} violated [2.0, 8.0]`
      );
    }

    // 2. generateStoryboardScenes with video output mode
    const flowCfg: AiStudioFlowEngineConfig = {
      aspectRatio: '16:9',
      outputMode: 'video',
      stylePromptPrefix: 'Cinematic',
      negativePrompt: 'lowres',
      outputsPerScene: 1,
      downloadDir: '',
      concurrency: 1,
    };

    const sparseLines: ScriptBeatLine[] = [
      { id: 'l1', index: 1, text: 'Hook ngắn', estimatedDurationSec: 0.5 },
      { id: 'l2', index: 2, text: 'Thân bài dài vừa', estimatedDurationSec: 5.5 },
      { id: 'l3', index: 3, text: 'Cao trào cực dài', estimatedDurationSec: 25.0 },
    ];

    const scenes = llmService.generateStoryboardScenes(sparseLines, flowCfg);
    assert.strictEqual(scenes.length, 3);
    for (const sc of scenes) {
      const durSec = sc.durationMs / 1000;
      assert(
        durSec >= 2.0 && durSec <= 8.0,
        `Generated scene ${sc.id} duration ${durSec}s outside [2.0, 8.0]`
      );
      assert.strictEqual(sc.motionType, 'video');
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SUITE 2: METAPHORICAL VS PHYSICAL ACTION PARSING MATRIX
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 🧠 SUITE 2: METAPHORICAL VS PHYSICAL ACTION PARSING ---');

  await advTest('ADV-SEM-01', 'Figurative and metaphorical expressions do NOT trigger false-positive physical video actions', () => {
    const metaphoricalPhrases = [
      { phrase: 'Thời gian trôi qua thật nhanh như một cái chớp mắt', context: 'Chiêm nghiệm thời gian' },
      { phrase: 'Trái tim tôi như ngừng đập vì ngỡ ngàng trước vẻ đẹp thiên nhiên', context: 'Cảm xúc ngỡ ngàng' },
      { phrase: 'Núi lửa trong lòng sôi sục nhưng gương mặt anh vẫn bình thản', context: 'Tâm trạng kìm nén' },
      { phrase: 'Đứng trước ngã rẽ cuộc đời, anh trầm ngâm suy nghĩ về tương lai', context: 'Nội tâm nhân vật' },
      { phrase: 'Bước vào giai đoạn trầm cảm của nền kinh tế thế giới', context: 'Báo cáo kinh tế' },
      { phrase: 'Sau bao đêm trăn trở, ông đi đến quyết định lịch sử', context: 'Hồi ức lịch sử' },
      { phrase: 'Bước ngoặt tư duy của cả một thế hệ làm thay đổi nhận thức', context: 'Khảo luận xã hội' },
      { phrase: 'Các chuyên gia đánh giá tình hình một cách cẩn trọng', context: 'Hội nghị khoa học' },
      { phrase: 'Sự kiện này đánh dấu một cột mốc phát triển mới', context: 'Lễ kỷ niệm' },
      { phrase: 'Chấp nhận đánh đổi tuổi thanh xuân để xây dựng sự nghiệp', context: 'Tự sự' },
      { phrase: 'Hành động cụ thể vì môi trường đang được nhân rộng', context: 'Tuyên truyền xanh' },
      { phrase: 'Một bức tranh kinh tế u ám bao trùm toàn cầu', context: 'Bản tin tài chính' },
      { phrase: 'Dòng chảy lịch sử vẫn cuồn cuộn qua từng thời kỳ', context: 'Lịch sử cổ đại' },
      { phrase: 'Ngọn lửa đam mê bùng cháy trong tim các bạn trẻ', context: 'Truyền cảm hứng' },
    ];

    for (const item of metaphoricalPhrases) {
      const tension = storyboardService.analyzeDramaticTension(item.phrase, item.context);
      assert(
        tension < 0.7,
        `Metaphorical phrase "${item.phrase}" generated excessive dramatic tension: ${tension}`
      );

      const decision = storyboardService.decideMediaType(item.phrase, item.context, 4.0);
      assert.strictEqual(
        decision.media_type,
        'image',
        `Metaphorical phrase "${item.phrase}" was falsely classified as video! Reason: ${decision.reason}`
      );
      assert(
        decision.camera_motion === 'static' ||
        decision.camera_motion === 'pan_left_to_right' ||
        decision.camera_motion === 'dolly_in',
        `Metaphorical phrase camera motion unexpected: ${decision.camera_motion}`
      );

      const motionNote = storyboardService.buildMotionNote(1, 1, decision.media_type, {
        narration: item.phrase,
        visualNote: item.context,
        cameraMotion: decision.camera_motion,
      });
      assert(
        motionNote.toLowerCase().includes('ken burns'),
        `Image motion note for metaphorical phrase must use gentle Ken Burns, got "${motionNote}"`
      );
      assert(
        !motionNote.toLowerCase().includes('tracking subject') &&
        !motionNote.toLowerCase().includes('fast tracking'),
        `Metaphorical phrase must NOT have violent camera tracking: "${motionNote}"`
      );
    }
  });

  await advTest('ADV-SEM-02', 'Genuine physical action scenes ARE correctly identified as high-tension video with camera motion', () => {
    const genuineActionPhrases = [
      'Nhân vật chính chạy thục mạng qua con hẻm để trốn thoát kẻ thù',
      'Chiến binh nhảy vọt qua miệng vực thẳm và chiến đấu dũng cảm',
      'Tên cướp lao nhanh ra xe và đuổi theo đoàn cảnh sát',
      'Một vụ nổ bùng nổ dữ dội hất tung mọi thứ xung quanh',
      'Anh ấy bước đi giữa làn mưa đạn và bắn trả quyết liệt',
    ];

    for (const actionText of genuineActionPhrases) {
      const plan = storyboardService.planCinematography(actionText, 'Action tracking shot', 0.85);
      assert.strictEqual(
        plan.media_type,
        'video',
        `Physical action scene "${actionText}" must be classified as video`
      );
      assert(
        plan.camera_motion !== 'static',
        `Physical action scene "${actionText}" should have dynamic camera movement, got ${plan.camera_motion}`
      );
      assert(
        plan.duration_sec >= 2.0 && plan.duration_sec <= 8.0,
        `Physical action duration outside [2.0, 8.0]: ${plan.duration_sec}`
      );
    }
  });

  await advTest('ADV-SEM-03', 'isStaticOrDescriptiveNarration distinguishes words starting with "đánh" (đánh giá, đánh dấu, đánh đổi) from physical fight ("đánh")', () => {
    assert.strictEqual(
      storyboardService.isStaticOrDescriptiveNarration('Chúng ta cùng đánh giá báo cáo tài chính năm qua'),
      true,
      '"đánh giá" must be recognized as static descriptive narration'
    );
    assert.strictEqual(
      storyboardService.isStaticOrDescriptiveNarration('Sự kiện này đánh dấu bước chuyển mình của nhân loại'),
      true,
      '"đánh dấu" must be recognized as static descriptive narration'
    );
    assert.strictEqual(
      storyboardService.isStaticOrDescriptiveNarration('Anh ấy sẵn sàng đánh đổi mọi thứ vì gia đình'),
      true,
      '"đánh đổi" must be recognized as static descriptive narration'
    );

    // True physical combat keyword
    assert.strictEqual(
      storyboardService.isStaticOrDescriptiveNarration('Hai nhân vật nhảy vào đánh nhau dữ dội trên cầu'),
      false,
      '"đánh nhau" with action must NOT be treated as static narration'
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SUITE 3: EMPTY, SPARSE, AND MALFORMED INPUT RESILIENCE
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 🧪 SUITE 3: SPARSE & MALFORMED INPUT RESILIENCE ---');

  await advTest('ADV-INP-01', 'ScriptWorkspaceView formatting functions safely handle empty, undefined, and non-standard inputs', () => {
    // formatCameraAngle
    assert.strictEqual(formatCameraAngle(undefined), 'Trung cảnh');
    assert.strictEqual(formatCameraAngle(''), 'Trung cảnh');
    assert.strictEqual(formatCameraAngle('wide_establishing'), 'Toàn cảnh (Wide)');
    assert.strictEqual(formatCameraAngle('close_up'), 'Cận cảnh (Close-up)');
    assert.strictEqual(formatCameraAngle('custom_dutch_tilt'), 'custom_dutch_tilt');

    // formatCameraMovement
    assert.strictEqual(formatCameraMovement(undefined), 'Cố định');
    assert.strictEqual(formatCameraMovement(''), 'Cố định');
    assert.strictEqual(formatCameraMovement('dolly_in'), 'Tiến lại (Dolly In)');
    assert.strictEqual(formatCameraMovement('pan_left_to_right'), 'Lia phải (Pan R)');
    assert.strictEqual(formatCameraMovement('custom_drone_orbit'), 'custom_drone_orbit');
  });

  await advTest('ADV-INP-02', 'AiStudioLlmService splitScriptToBeatLines handles empty, whitespace, and sparse scripts', () => {
    assert.deepStrictEqual(llmService.splitScriptToBeatLines(''), []);
    assert.deepStrictEqual(llmService.splitScriptToBeatLines('   \n\r\n   '), []);
    assert.deepStrictEqual((llmService as any).splitScriptToBeatLines(null), []);
    assert.deepStrictEqual((llmService as any).splitScriptToBeatLines(undefined), []);

    // Single token strings
    const single = llmService.splitScriptToBeatLines('Xin chào.');
    assert.strictEqual(single.length, 1);
    assert.strictEqual(single[0].text, 'Xin chào.');
    assert.strictEqual(single[0].estimatedDurationSec, 2.0); // clamped min
    assert.strictEqual(single[0].beatType, 'hook');
  });

  await advTest('ADV-INP-03', 'parseBlueprintJson recovers robustly from malformed markdown, unclosed JSON, and template variables', () => {
    const topic = 'Bí Ẩn Tam Giác Bermuda';

    // 1. Text with {{CHANNEL_NAME}} and template tags
    const templateText = `
      Xin chào {{CHANNEL_NAME}}! Dưới đây là ý tưởng cho {{SOURCE_MATERIAL}}:
      \`\`\`json
      {
        "title": "Bí Ẩn Tam Giác Bermuda: Vùng Biển Tử Thần",
        "hookConcept": "Tại sao hàng trăm con tàu biến mất không dấu vết?",
        "narrativeAngle": "Khám phá khoa học kết hợp tài liệu giải mật",
        "outline": ["[00:00 - 00:45] Mở đầu", "[00:45 - 01:30] Diễn biến", "[01:30 - 02:00] Kết luận"],
        "thumbnailConcept": "Con tàu ma trôi dạt",
        "thumbnailPrompt": "Ghost ship floating in green glowing storm, 8k"
      }
      \`\`\`
    `;
    const bp1 = llmService.parseBlueprintJson(templateText, topic);
    assert.strictEqual(bp1.title, 'Bí Ẩn Tam Giác Bermuda: Vùng Biển Tử Thần');
    assert.strictEqual(bp1.outline?.length, 3);

    // 2. Trailing commas & unquoted keys repaired via jsonrepair
    const brokenJson = `
      Dưới đây là kế hoạch:
      {
        title: "Bí Ẩn Kim Tự Tháp",
        hookConcept: "Bí mật 4000 năm trước",
        narrativeAngle: "Kiểm chứng các giả thuyết",
        outline: ["Phần 1", "Phần 2", "Phần 3",],
      }
    `;
    const bp2 = llmService.parseBlueprintJson(brokenJson, 'Kim Tự Tháp');
    assert.strictEqual(bp2.title, 'Bí Ẩn Kim Tự Tháp');
    assert.strictEqual(bp2.hookConcept, 'Bí mật 4000 năm trước');

    // 3. Plain text format without JSON code block -> regex field extractor
    const plainText = `Tiêu đề: Giải Mã Đại Dương Xanh
Hook: Bạn có biết điều gì ở đáy vực Mariana?
Góc nhìn: Khoa học viễn tưởng
Phân đoạn 1 [00:00 - 00:45]: Mở đầu
Phân đoạn 2 [00:45 - 01:30]: Diễn biến
Phân đoạn 3 [01:30 - 02:00]: Kết luận`;
    const bp3 = llmService.parseBlueprintJson(plainText, 'Đại Dương');
    assert(bp3.title.includes('Giải Mã Đại Dương Xanh'), `Expected title to include 'Giải Mã Đại Dương Xanh', got '${bp3.title}'`);
    assert(bp3.hookConcept.includes('Mariana'), `Expected hookConcept to include 'Mariana', got '${bp3.hookConcept}'`);

    // 4. Unstructured noise must fail, not masquerade as provider-generated facts.
    const pureGarbage = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Random raw logs 12345.';
    assert.throws(() => llmService.parseBlueprintJson(pureGarbage, 'Chủ Đề Fallback'), /schema/);
  });

  await advTest('ADV-INP-04', 'convertNarrationToVisualConcept strips speaker labels, raw quotes, and dialogue verbs cleanly', () => {
    const dirtyInputs = [
      {
        raw: 'Người dẫn: "Chào mừng các bạn đến với hành trình bí ẩn."',
        expectedNotContain: ['Người dẫn:', '"', 'Chào mừng các bạn'],
      },
      {
        raw: 'Host 01: Lời thoại: "Chúng ta không thể quay đầu lại được nữa!"',
        expectedNotContain: ['Host 01', 'Lời thoại:', '"'],
      },
      {
        raw: 'Tiến sĩ thốt lên: "Đây là một phát hiện phi thường!"',
        expectedNotContain: ['thốt lên:', '"'],
      },
    ];

    for (const item of dirtyInputs) {
      const visualConcept = storyboardService.convertNarrationToVisualConcept(item.raw);
      assert(typeof visualConcept === 'string' && visualConcept.length > 5);
      for (const forbidden of item.expectedNotContain) {
        assert(
          !visualConcept.includes(forbidden),
          `Visual concept "${visualConcept}" must NOT contain "${forbidden}"`
        );
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SUITE 4: END-TO-END STORYBOARD WITH MULTI-DURATION DISK PIPELINE
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 🎬 SUITE 4: END-TO-END PIPELINE & TIMING INTEGRATION ---');

  await advTest('ADV-E2E-01', 'generateStoryboard produces 100% compliant unique shots with clamped durations and zero gaps', async () => {
    const projectDir = path.join(tmpRoot, 'proj_adv_storyboard');
    const storage = new AiStudioDiskStorageManager('proj_adv_storyboard', { baseDir: tmpRoot });

    // Populate script with diverse scenes:
    // Scene 1: Micro duration 1.5s (Action) -> clamped to 2.0s
    // Scene 2: Exact boundary 2.0s
    // Scene 3: Normal duration 5.5s (Introspective / Image)
    // Scene 4: Exact boundary 8.0s (Action / Video)
    // Scene 5: Long duration 15.0s (Action / Video) -> multi-clip split
    const scriptData = {
      project_id: 'proj_adv_storyboard',
      scenes: [
        { scene_id: 'scene_01', narration: 'Chạy nhanh lên!', visual_note: 'Nhân vật chạy thục mạng qua ngõ' },
        { scene_id: 'scene_02', narration: 'Đứng yên đó!', visual_note: 'Đối mặt kẻ thù' },
        { scene_id: 'scene_03', narration: 'Bầu trời đêm tĩnh lặng, những vì sao lấp lánh như ngàn hạt ngọc.', visual_note: 'Toàn cảnh bầu trời' },
        { scene_id: 'scene_04', narration: 'Tiếng súng nổ vang dội làm rung chuyển toàn bộ toà nhà hoang phế.', visual_note: 'Chiến đấu trong toà nhà' },
        { scene_id: 'scene_05', narration: 'Một cuộc truy đuổi nghẹt thở kéo dài qua các con phố tấp nập của thành phố.', visual_note: 'Xe cảnh sát đuổi theo tên cướp' },
      ],
    };

    const timingData = {
      project_id: 'proj_adv_storyboard',
      probed_engine: 'ffprobe' as const,
      scenes: [
        { scene_id: 'scene_01', audio_file: '02_voice/scene_01.mp3', start_sec: 0.0, end_sec: 1.5, duration_sec: 1.5 },
        { scene_id: 'scene_02', audio_file: '02_voice/scene_02.mp3', start_sec: 1.5, end_sec: 3.5, duration_sec: 2.0 },
        { scene_id: 'scene_03', audio_file: '02_voice/scene_03.mp3', start_sec: 3.5, end_sec: 9.0, duration_sec: 5.5 },
        { scene_id: 'scene_04', audio_file: '02_voice/scene_04.mp3', start_sec: 9.0, end_sec: 17.0, duration_sec: 8.0 },
        { scene_id: 'scene_05', audio_file: '02_voice/scene_05.mp3', start_sec: 17.0, end_sec: 32.0, duration_sec: 15.0 },
      ],
      total_duration_sec: 32.0,
    };

    storage.saveScript(scriptData as any);
    storage.saveTiming(timingData as any);

    const storyboard = await storyboardService.generateStoryboard({
      storage,
      script: scriptData as any,
      timing: timingData as any,
      shotMode: 'multi',
      maxVideoClipDurationSec: 8.0,
    });

    assert(storyboard && Array.isArray(storyboard.scenes), 'Storyboard must have scenes');
    assert.strictEqual(storyboard.scenes.length, 5, 'Should have 5 storyboard scenes');

    const allShots = storyboard.scenes.flatMap((s) => s.shots);
    assert(allShots.length >= 6, `Expected at least 6 shots due to multi-clip split, got ${allShots.length}`);

    const seenShotIds = new Set<string>();

    for (const shot of allShots) {
      // 1. Unique Shot ID
      assert(!seenShotIds.has(shot.shot_id), `Duplicate shot ID: ${shot.shot_id}`);
      seenShotIds.add(shot.shot_id);

      // 2. Media Type & Reason validity
      assert(shot.media_type === 'image' || shot.media_type === 'video', `Invalid media type: ${shot.media_type}`);
      assert(shot.reason && shot.reason.trim().length > 0, `Missing reason for shot ${shot.shot_id}`);

      // 3. Video Duration Invariant [2.0s, 8.0s]
      if (shot.media_type === 'video') {
        assert(
          shot.duration_sec >= 2.0 && shot.duration_sec <= 8.0,
          `Video shot ${shot.shot_id} duration ${shot.duration_sec}s outside [2.0, 8.0]`
        );
      } else {
        assert(
          shot.duration_sec > 0,
          `Image shot ${shot.shot_id} duration ${shot.duration_sec}s must be positive`
        );
      }

      // 4. Prompts non-empty
      assert(shot.image_prompt && shot.image_prompt.trim().length > 10, 'Prompt too short');
      assert(shot.motion_note && shot.motion_note.trim().length > 3, 'Motion note too short');
    }

    // Verify scene 5 (15.0s video) was properly split into multi-clips
    const sc5 = storyboard.scenes.find((s) => s.scene_id === 'scene_05');
    assert(sc5, 'scene_05 must exist');
    assert(sc5.shots.length >= 2, `scene_05 should have >= 2 shots, got ${sc5.shots.length}`);
    for (const sh of sc5.shots) {
      assert(sh.shot_id.includes('scene_05_shot_'), 'Naming convention respected');
      assert.strictEqual(sh.media_type, 'video');
      assert(sh.duration_sec >= 2.0 && sh.duration_sec <= 8.0);
    }

    // Synthesis validation
    assert.strictEqual(storyboard.synthesis.total_shots, allShots.length);
    assert(storyboard.synthesis.estimated_credits > 0);
  });

  // Clean up temporary test files
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}

  console.log('\n================================================================================');
  console.log(`📊 ADVERSARIAL CHALLENGER SUITE SUMMARY:`);
  console.log(`   Passed:  ${passCount} / ${passCount + failCount} ✅`);
  console.log(`   Failed:  ${failCount} ❌`);
  console.log('================================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
