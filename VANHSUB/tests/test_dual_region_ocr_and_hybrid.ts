import assert from 'assert';
import {
  buildOverlaySegmentsFromTopFrames,
  buildSubtitleSegmentsWithStats,
  splitFramesByZone,
} from '../main/ocr/subtitleBuilder';
import type { OcrFrameResult } from '../main/ocr/ocrEngine';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';
import { resolveReconcileDecisions, type AsrOcrReconcileItem } from '../main/ai/geminiClient';
import type { SrtLine } from '../main/lib/srt';

console.log('=== BẮT ĐẦU TEST SUITE: DUAL-REGION OCR & HYBRID AI RECONCILIATION ===\n');

let passCount = 0;
let totalCount = 0;

function runTest(name: string, fn: () => void) {
  totalCount++;
  try {
    fn();
    console.log(`✓ PASS: ${name}`);
    passCount++;
  } catch (err: any) {
    console.error(`✗ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeFramesFromTimeline(
  totalFrames: number,
  populate: (idx: number) => OcrFrameResult['lines'],
): OcrFrameResult[] {
  const frames: OcrFrameResult[] = [];
  for (let i = 0; i < totalFrames; i++) {
    const lines = populate(i);
    frames.push({
      text: lines.map((l) => l.text).join(' '),
      confidence: lines.length > 0 ? Math.round(lines.reduce((s, l) => s + l.confidence, 0) / lines.length) : 0,
      lines,
    });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// 1. splitFramesByZone giữ đúng độ dài mảng & chỉ số frame (bảo toàn timestamp)
// ---------------------------------------------------------------------------
runTest('1. splitFramesByZone bảo toàn index frame giữa vùng trên và vùng dưới', () => {
  const frames: OcrFrameResult[] = [
    { text: '', confidence: 0, lines: [] },
    {
      text: 'Header Câu 1',
      confidence: 90,
      lines: [
        { text: 'Header', confidence: 92, y0: 40, x0: 80, w: 300, h: 30, zone: 'top' },
        { text: 'Câu 1', confidence: 88, y0: 650, x0: 100, w: 400, h: 32, zone: 'bottom' },
      ],
    },
    {
      text: 'Header',
      confidence: 91,
      lines: [{ text: 'Header', confidence: 91, y0: 40, x0: 80, w: 300, h: 30, zone: 'top' }],
    },
  ];

  const { topFrames, bottomFrames } = splitFramesByZone(frames);
  assert.strictEqual(topFrames.length, frames.length);
  assert.strictEqual(bottomFrames.length, frames.length);
  assert.strictEqual(topFrames[0].lines.length, 0);
  assert.strictEqual(topFrames[1].lines[0].text, 'Header');
  assert.strictEqual(topFrames[2].lines[0].text, 'Header');
  assert.strictEqual(bottomFrames[1].lines[0].text, 'Câu 1');
  assert.strictEqual(bottomFrames[2].lines.length, 0);
});

// ---------------------------------------------------------------------------
// 2. buildOverlaySegmentsFromTopFrames giữ bảng nhiều hàng (\n) không cắt timestamp
// ---------------------------------------------------------------------------
runTest('2. buildOverlaySegmentsFromTopFrames gộp các hàng bảng đồng thời bằng \\n & vá hụt 1 frame', () => {
  // 2 fps -> interval 500ms; bảng hiện từ frame 4 (2000ms) -> frame 27 (13500ms => endMs 14000ms)
  const frames = makeFramesFromTimeline(32, (idx) => {
    if (idx < 4 || idx > 27) return [];
    const baseRows = [
      { text: 'Bảng so sánh gói', confidence: 95, y0: 50, x0: 100, w: 400, h: 28, zone: 'top' as const },
      { text: 'Gói A: 100k', confidence: 94, y0: 95, x0: 100, w: 350, h: 26, zone: 'top' as const },
      { text: 'Gói B: 200k', confidence: 94, y0: 140, x0: 100, w: 350, h: 26, zone: 'top' as const },
    ];
    // Giả lập frame 10 bị OCR rớt hàng giữa
    if (idx === 10) return [baseRows[0], baseRows[2]];
    return baseRows;
  });

  const overlays = buildOverlaySegmentsFromTopFrames(frames, 500);
  assert.strictEqual(overlays.length, 1, `Kỳ vọng 1 block bảng liền mạch, nhận ${overlays.length}`);
  assert.strictEqual(overlays[0].startMs, 2000);
  assert.strictEqual(overlays[0].endMs, 14000);
  assert.strictEqual(
    overlays[0].text,
    'Bảng so sánh gói\nGói A: 100k\nGói B: 200k',
  );
});

// ---------------------------------------------------------------------------
// 3. Kịch bản 00:02->00:14 tràn vùng dưới đè lên 4 câu thoại 00:03->00:13
// ---------------------------------------------------------------------------
runTest('3. Tách bảng tràn 00:02->00:14 khỏi 4 câu thoại 00:03->00:13 ở cùng vùng dưới', () => {
  // interval 500ms, 30 frames = 15s
  const frames = makeFramesFromTimeline(30, (idx) => {
    const tMs = idx * 500;
    const lines: OcrFrameResult['lines'] = [];

    // Bảng tràn xuất hiện ở phần trên vùng dưới (y0 = 510) từ 2000ms -> 13500ms (end 14000ms)
    if (tMs >= 2000 && tMs <= 13500) {
      lines.push({
        text: 'Số liệu doanh thu Q1-Q4',
        confidence: 92,
        y0: 510,
        x0: 120,
        w: 600,
        h: 30,
        zone: 'bottom',
      });
    }

    // 4 câu thoại liên tiếp ở sát đáy (y0 = 650) từ 3000ms -> 13000ms (mỗi câu 2.5s = 5 frames)
    if (tMs >= 3000 && tMs <= 5000) {
      lines.push({ text: 'Hôm nay chúng ta xem báo cáo', confidence: 90, y0: 650, x0: 150, w: 600, h: 32, zone: 'bottom' });
    } else if (tMs >= 5500 && tMs <= 7500) {
      lines.push({ text: 'Quý một tăng trưởng mười phần trăm', confidence: 90, y0: 650, x0: 150, w: 600, h: 32, zone: 'bottom' });
    } else if (tMs >= 8000 && tMs <= 10000) {
      lines.push({ text: 'Quý hai đạt mức kỷ lục mới', confidence: 90, y0: 650, x0: 150, w: 600, h: 32, zone: 'bottom' });
    } else if (tMs >= 10500 && tMs <= 12500) {
      lines.push({ text: 'Cuối cùng là kế hoạch năm tới', confidence: 90, y0: 650, x0: 150, w: 600, h: 32, zone: 'bottom' });
    }

    return lines;
  });

  const built = buildSubtitleSegmentsWithStats(frames, 500, { splitStaticBleed: true });
  assert.strictEqual(built.segments.length, 4, `Phải còn đúng 4 câu thoại, nhận ${built.segments.length}`);
  assert.strictEqual(built.segments[0].text, 'Hôm nay chúng ta xem báo cáo');
  assert.strictEqual(built.segments[0].startMs, 3000);
  assert.strictEqual(built.segments[3].text, 'Cuối cùng là kế hoạch năm tới');
  assert.strictEqual(built.segments[3].endMs, 13000);

  assert.ok(built.overlaySegments && built.overlaySegments.length === 1, 'Bảng tràn phải được tách sang overlaySegments');
  assert.strictEqual(built.overlaySegments![0].text, 'Số liệu doanh thu Q1-Q4');
  assert.strictEqual(built.overlaySegments![0].startMs, 2000);
  assert.strictEqual(built.overlaySegments![0].endMs, 14000);
});

// ---------------------------------------------------------------------------
// 4. Phụ đề thoại 2 dòng bình thường không bị tách nhầm sang overlay
// ---------------------------------------------------------------------------
runTest('4. Phụ đề thoại ngắt 2 dòng cùng nhịp xuất hiện không bị tách nhầm là bleed', () => {
  const frames = makeFramesFromTimeline(16, (idx) => {
    const tMs = idx * 500;
    if (tMs >= 1000 && tMs <= 4500) {
      return [
        { text: 'Đây là một câu thoại dài', confidence: 91, y0: 610, x0: 140, w: 500, h: 28, zone: 'bottom' },
        { text: 'được ngắt thành hai dòng', confidence: 91, y0: 650, x0: 140, w: 500, h: 28, zone: 'bottom' },
      ];
    }
    return [];
  });

  const built = buildSubtitleSegmentsWithStats(frames, 500, { splitStaticBleed: true });
  assert.strictEqual(built.overlaySegments?.length ?? 0, 0);
  assert.ok(built.segments.length >= 1);
});

// ---------------------------------------------------------------------------
// 5. Hybrid fuseOcrAndWhisper routing bảng đè tiếng nói sang overlaySegments
// ---------------------------------------------------------------------------
runTest('5. fuseOcrAndWhisper với routeUnmatchedOverlappingToOverlay đẩy bảng đè thoại sang overlaySegments', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-board', startMs: 2000, endMs: 14000, text: 'Bảng thống kê chi phí vận hành 2026' },
    { id: 'ocr-sub-1', startMs: 3000, endMs: 5500, text: 'hom nay chung ta xem chi phi' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'w-1', startMs: 3000, endMs: 5500, text: 'Hôm nay chúng ta xem chi phí' },
    { id: 'w-2', startMs: 6000, endMs: 9000, text: 'Phần tiếp theo là lợi nhuận quý hai' },
    { id: 'w-3', startMs: 9500, endMs: 13000, text: 'Tổng kết năm tăng trưởng hai mươi phần trăm' },
  ];

  // Khi bật routeUnmatchedOverlappingToOverlay: ocr-board lệch tiếng & trùng 3 câu Whisper -> sang overlaySegments
  const hybridDual = fuseOcrAndWhisper(ocrSegments, whisperSegments, {
    preserveSpeechOnlyWhisper: true,
    timingSource: 'speech',
    routeUnmatchedOverlappingToOverlay: true,
  });

  assert.strictEqual(hybridDual.overlaySegments?.length, 1);
  assert.strictEqual(hybridDual.overlaySegments![0].text, 'Bảng thống kê chi phí vận hành 2026');
  assert.ok(
    !hybridDual.segments.some((s) => s.text.includes('Bảng thống kê')),
    'File thoại chính không được dính dòng bảng thống kê',
  );
  assert.strictEqual(hybridDual.segments.length, 3, 'Vẫn phải giữ đủ 3 câu thoại Whisper');

  // Chế độ mặc định vẫn giữ tương thích ngược (không route sang overlay nếu không bật flag)
  const legacyGapBanner = fuseOcrAndWhisper(
    [{ id: 'b1', startMs: 1000, endMs: 2500, text: 'TIÊU ĐỀ ĐẦU VIDEO' }],
    [{ id: 'w1', startMs: 5000, endMs: 7000, text: 'Xin chào các bạn' }],
    { preserveSpeechOnlyWhisper: true },
  );
  assert.strictEqual(legacyGapBanner.stats.bannersPreserved, 1);
  assert.strictEqual(legacyGapBanner.overlaySegments, undefined);
});

// ---------------------------------------------------------------------------
// 6. Gemini AI Reconciliation response parsing & Missing Index Recovery
// ---------------------------------------------------------------------------
runTest('6. resolveReconcileDecisions phân loại AI & tự khôi phục index bị sót', () => {
  const chunk: AsrOcrReconcileItem[] = [
    {
      index: 0,
      startMs: 1000,
      endMs: 3500,
      asrText: 'Chúng ta dùng công nghệ mới',
      ocrText: 'Chung ta dung cong nghe moi',
      status: 'matched',
      fallbackAction: 'keep_sub',
      fallbackText: 'Chúng ta dùng công nghệ mới',
    },
    {
      index: 1,
      startMs: 4000,
      endMs: 9000,
      asrText: 'Như các bạn thấy trên màn hình',
      ocrText: 'Lãi suất: 6.5% / năm',
      status: 'unmatched_ocr_with_speech',
      fallbackAction: 'move_to_overlay',
      fallbackText: 'Lãi suất: 6.5% / năm',
    },
    {
      index: 2,
      startMs: 9500,
      endMs: 12000,
      asrText: 'Xin cảm ơn mọi người',
      ocrText: 'Xin cảm ơn mọi người',
      status: 'matched',
      fallbackAction: 'keep_sub',
      fallbackText: 'Xin cảm ơn mọi người',
    },
  ];

  // Giả lập JSON AI trả thiếu index 2 + bọc trong ```json
  const aiRaw = `\`\`\`json
[
  { "index": 0, "action": "keep_sub", "text": "Chúng ta dùng công nghệ mới." },
  { "index": 1, "action": "move_to_overlay", "text": "Lãi suất: 6,5% / năm" }
]
\`\`\``;

  const decisions = resolveReconcileDecisions(chunk, aiRaw);
  assert.strictEqual(decisions.length, 3);
  assert.deepStrictEqual(decisions[0], { index: 0, action: 'keep_sub', text: 'Chúng ta dùng công nghệ mới.' });
  assert.deepStrictEqual(decisions[1], { index: 1, action: 'move_to_overlay', text: 'Lãi suất: 6,5% / năm' });
  assert.deepStrictEqual(decisions[2], { index: 2, action: 'keep_sub', text: 'Xin cảm ơn mọi người' });
});

console.log(`\n=== KẾT QUẢ DUAL-REGION TEST: ${passCount}/${totalCount} PASSED ===`);
