import { isOcrGarbageLine } from '../lib/subtitleSanitizer';
import { serializeSrt, type SrtLine } from '../lib/srt';
import type { OcrFrameResult } from './ocrEngine';

/**
 * Ngưỡng tin cậy tối thiểu để giữ text của 1 khung. Bộ lọc chính là
 * MIN_LINE_CONFIDENCE trong ocrEngine (theo từng dòng) — đây chỉ là cửa
 * phụ trên mean của các dòng đã được lọc nên đặt ngang mức đó.
 */
const MIN_CONFIDENCE = 40;

/**
 * Ghép kết quả OCR từng khung thành dòng phụ đề có timestamp.
 *
 * Phụ đề cứng hiển thị nhiều khung liên tiếp → các khung liền nhau cùng nội dung
 * được gộp thành 1 dòng duy nhất (start = khung đầu, end = khung cuối + 1 khoảng lấy mẫu).
 * Một khung bị đọc hụt giữa dòng (nhiễu) cũng được vá nếu nội dung trước/sau trùng nhau.
 */
interface TextDetection {
  text: string;
  confidence: number;
  timeMs: number;
  y0: number;
  x0?: number;
  w?: number;
  h?: number;
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
  zone?: 'top' | 'bottom';
}

interface ActiveTrack {
  id: number;
  startMs: number;
  lastSeenMs: number;
  y0: number;
  x0?: number;
  w?: number;
  h?: number;
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
  zone?: 'top' | 'bottom';
  detections: TextDetection[];
}

export interface IntermediateSubtitleSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
  frames: number;
  stable: boolean;
  needsReview: boolean;
  y0?: number;
  x0?: number;
  w?: number;
  h?: number;
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
  zone?: 'top' | 'bottom';
}

/**
 * Kiểm tra tương thích không gian (Rule 3 & Rule 16 Test 6):
 * Tránh gộp text ở vị trí khác nhau (ví dụ: title/overlay ở trên đỉnh vs phụ đề ở đáy).
 */
function isSpatiallyCompatible(
  det: { y0: number; h?: number; classification?: string; zone?: 'top' | 'bottom' },
  track: { y0: number; h?: number; classification?: string; zone?: 'top' | 'bottom' },
): boolean {
  // Nếu đã gắn nhãn zone rõ ràng ('top' vs 'bottom'), không bao giờ gộp chéo vùng
  if (det.zone && track.zone && det.zone !== track.zone) {
    return false;
  }

  // Nếu 1 trong 2 không có tọa độ y (y0 < 0), cho phép khớp dựa trên text
  if (det.y0 < 0 || track.y0 < 0) return true;

  // Nếu phân loại khác nhau rõ ràng (SUBTITLE vs OVERLAY), không gộp
  if (
    det.classification &&
    track.classification &&
    det.classification !== track.classification &&
    det.classification !== 'OTHER_TEXT' &&
    track.classification !== 'OTHER_TEXT'
  ) {
    return false;
  }

  const maxDiff = Math.max(70, (det.h ?? 30) * 1.5, (track.h ?? 30) * 1.5);
  return Math.abs(det.y0 - track.y0) <= maxDiff;
}

/**
 * Chọn text đại diện ổn định nhất qua nhiều frame (Rule 6 - Stability Voting):
 * Nhóm text theo mergeKey, tính điểm = count * 2.0 + (avgConf / 100.0).
 * Văn bản chiếm ưu thế sẽ thắng các lỗi OCR chập chờn (1-2 frame typo).
 */
function selectStableText(
  detections: TextDetection[],
  preserveNewlines: boolean = false,
): { text: string; confidence: number } {
  const normFn = (raw: string) => (preserveNewlines ? normalizeMultilineText(raw) : normalizeText(raw));
  if (detections.length === 0) return { text: '', confidence: 0 };
  if (detections.length === 1) {
    return {
      text: normFn(detections[0].text),
      confidence: Math.round(detections[0].confidence),
    };
  }

  const groups = new Map<string, { count: number; totalConf: number; samples: string[] }>();
  for (const d of detections) {
    const norm = normFn(d.text);
    const key = mergeKey(norm);
    if (!key) continue;
    const g = groups.get(key) || { count: 0, totalConf: 0, samples: [] };
    g.count += 1;
    g.totalConf += d.confidence;
    g.samples.push(norm);
    groups.set(key, g);
  }

  if (groups.size === 0) {
    return {
      text: normFn(detections[0].text),
      confidence: Math.round(detections[0].confidence),
    };
  }

  // Khắc phục lỗi voting thiên vị câu ngắn trong chuỗi karaoke:
  // Nếu nhóm B là bản mở rộng (progressive extension) của nhóm A (A là tiền tố của B, keyB.startsWith(keyA)),
  // thì sự xuất hiện của A củng cố cho B thay vì phạt B vì B xuất hiện ở ít frame cuối hơn.
  const effectiveCounts = new Map<string, number>();
  for (const [key, g] of groups.entries()) {
    let effCount = g.count;
    for (const [otherKey, otherG] of groups.entries()) {
      if (key !== otherKey && otherKey.length >= 3 && key.startsWith(otherKey) && key.length > otherKey.length) {
        effCount += otherG.count;
      }
    }
    effectiveCounts.set(key, effCount);
  }

  let bestGroupKey = '';
  let bestScore = -1;
  for (const [key, g] of groups.entries()) {
    const avgConf = g.totalConf / g.count;
    const effCount = effectiveCounts.get(key) || g.count;
    const score = effCount * 2.0 + avgConf / 100.0;
    if (score > bestScore || (Math.abs(score - bestScore) < 0.001 && key.length > bestGroupKey.length)) {
      bestScore = score;
      bestGroupKey = key;
    }
  }

  const bestGroup = groups.get(bestGroupKey)!;
  // Chọn mẫu tốt nhất từ nhóm thắng cuộc (mẫu phổ biến nhất, nếu bằng thì lấy dài hơn)
  const sampleCounts = new Map<string, number>();
  for (const s of bestGroup.samples) {
    sampleCounts.set(s, (sampleCounts.get(s) || 0) + 1);
  }
  let bestSample = bestGroup.samples[0];
  let maxCount = -1;
  for (const [s, count] of sampleCounts.entries()) {
    if (count > maxCount || (count === maxCount && s.length > bestSample.length)) {
      maxCount = count;
      bestSample = s;
    }
  }

  const avgConfidence = Math.round(bestGroup.totalConf / bestGroup.count);
  return { text: bestSample, confidence: avgConfidence };
}

/**
 * Ghép kết quả OCR từng khung thành dòng phụ đề có timestamp (Rule 4, 5, 6, 7).
 * Sử dụng multi-track tracking theo vị trí không gian (bbox y0/h),
 * dung sai hụt tối đa 2 frame (mergeGapMs), và bình chọn độ ổn định text.
 */
export interface SubtitleBuilderStats {
  framesScanned: number;
  textDetections: number;
  trackedGroups: number;
  duplicatesMerged: number;
  finalEvents: number;
  highConfidence: number;
  needsReview: number;
}

/**
 * Gộp các từ/box nằm trên cùng một hàng ngang trong một khung thành một dòng phụ đề hoàn chỉnh.
 * Hỗ trợ các engine OCR phát hiện bounding box theo từng từ riêng lẻ.
 */
function groupFrameLinesIntoRows(lines: Array<{
  text: string;
  confidence: number;
  y0: number;
  x0?: number;
  w?: number;
  h?: number;
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
  zone?: 'top' | 'bottom';
}>): Array<{
  text: string;
  confidence: number;
  y0: number;
  x0?: number;
  w?: number;
  h?: number;
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
  zone?: 'top' | 'bottom';
}> {
  if (lines.length <= 1) return lines;

  // Sắp xếp theo y0 rồi theo x0
  const sorted = [...lines].sort((a, b) => {
    if (Math.abs(a.y0 - b.y0) > 15) return a.y0 - b.y0;
    return (a.x0 ?? 0) - (b.x0 ?? 0);
  });

  const rows: Array<typeof lines> = [];
  for (const item of sorted) {
    const y0 = item.y0;
    const h = item.h ?? 30;
    const y1 = y0 + h;

    let placed = false;
    for (const row of rows) {
      const ref = row[row.length - 1];
      const refY0 = ref.y0;
      const refH = ref.h ?? 30;
      const refY1 = refY0 + refH;

      const overlap = Math.min(y1, refY1) - Math.max(y0, refY0);
      const minH = Math.max(1, Math.min(h, refH));
      // Cùng một hàng nếu chênh lệch y0 <= 18 hoặc chồng lấn chiều cao >= 40%
      if (overlap >= 0.4 * minH || Math.abs(y0 - refY0) <= 18) {
        row.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([item]);
    }
  }

  return rows.map((row) => {
    row.sort((a, b) => (a.x0 ?? 0) - (b.x0 ?? 0));
    const text = row.map((l) => l.text).join(' ').trim();
    const confidence = Math.round(row.reduce((s, l) => s + l.confidence, 0) / row.length);
    const y0 = Math.min(...row.map((l) => l.y0));
    const x0 = Math.min(...row.map((l) => l.x0 ?? 0));
    const maxRight = Math.max(...row.map((l) => (l.x0 ?? 0) + (l.w ?? 0)));
    const maxBottom = Math.max(...row.map((l) => l.y0 + (l.h ?? 30)));
    const w = maxRight - x0;
    const h = maxBottom - y0;
    const classification = row[0].classification;
    const zone = row.find((l) => l.zone)?.zone;

    return {
      text,
      confidence,
      y0,
      x0,
      w,
      h,
      classification,
      zone,
    };
  });
}

/**
 * Ghép kết quả OCR từng khung thành dòng phụ đề có timestamp kèm thống kê số liệu (Rule 17, 18).
 */
export function buildSubtitleSegmentsWithStats(
  frames: OcrFrameResult[],
  frameIntervalMs: number,
  options?: { splitStaticBleed?: boolean },
): { segments: SrtLine[]; overlaySegments?: SrtLine[]; stats: SubtitleBuilderStats } {
  let totalDetections = 0;
  for (const f of frames) {
    const rawLines = f.lines && f.lines.length > 0 ? f.lines : (f.text ? [{ text: f.text, confidence: f.confidence, y0: -1 }] : []);
    const grouped = groupFrameLinesIntoRows(rawLines);
    totalDetections += grouped.filter((l) => isUsableText(l.text, l.confidence)).length;
  }

  // Cho phép hụt tối đa 2 frame (ví dụ 500ms * 2.5 = 1250ms)
  const mergeGapMs = Math.max(frameIntervalMs * 2.5, 1200);

  const activeTracks: ActiveTrack[] = [];
  const completedTracks: ActiveTrack[] = [];
  let trackSeq = 0;

  for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
    const f = frames[frameIdx];
    const timeMs = Math.round(frameIdx * frameIntervalMs);

    // Lấy danh sách detection của khung này (đã gộp theo hàng ngang)
    let rawLines = f.lines && f.lines.length > 0 ? f.lines : [];
    if (rawLines.length === 0 && f.text && isUsableText(f.text, f.confidence)) {
      rawLines = [{ text: f.text, confidence: f.confidence, y0: -1 }];
    }

    const groupedLines = groupFrameLinesIntoRows(rawLines);
    let lineDets: TextDetection[] = [];
    for (const line of groupedLines) {
      if (!isUsableText(line.text, line.confidence)) continue;
      lineDets.push({
        text: line.text,
        confidence: line.confidence,
        timeMs,
        y0: line.y0,
        x0: line.x0,
        w: line.w,
        h: line.h,
        classification: line.classification,
        zone: line.zone,
      });
    }

    // Đóng các track đã quá hạn không thấy detection mới
    for (let i = activeTracks.length - 1; i >= 0; i--) {
      const tr = activeTracks[i];
      if (timeMs - tr.lastSeenMs > mergeGapMs) {
        completedTracks.push(tr);
        activeTracks.splice(i, 1);
      }
    }

    // Ghép từng detection vào track phù hợp nhất
    const assignedTrackIndices = new Set<number>();

    for (const det of lineDets) {
      let bestTrackIdx = -1;
      let bestTrackScore = -1;

      for (let tIdx = 0; tIdx < activeTracks.length; tIdx++) {
        if (assignedTrackIndices.has(tIdx)) continue;
        const tr = activeTracks[tIdx];

        // 1. Kiểm tra thời gian
        if (timeMs - tr.lastSeenMs > mergeGapMs) continue;

        // 2. Kiểm tra không gian
        if (!isSpatiallyCompatible(det, tr)) continue;

        // 3. Kiểm tra tương đồng text (Level 1, 2, 3)
        const lastDet = tr.detections[tr.detections.length - 1];
        const match = checkMergeMatch(lastDet.text, det.text);

        if (match.matched) {
          let score = 100;
          if (det.y0 >= 0 && tr.y0 >= 0) {
            score -= Math.abs(det.y0 - tr.y0) * 0.1;
          }
          if (score > bestTrackScore) {
            bestTrackScore = score;
            bestTrackIdx = tIdx;
          }
        }
      }

      if (bestTrackIdx >= 0) {
        // Cập nhật track hiện có
        assignedTrackIndices.add(bestTrackIdx);
        const tr = activeTracks[bestTrackIdx];
        tr.lastSeenMs = timeMs;
        tr.detections.push(det);
        if (det.y0 >= 0) tr.y0 = det.y0;
        if (det.x0 !== undefined) tr.x0 = det.x0;
        if (det.w !== undefined) tr.w = det.w;
        if (det.h !== undefined) tr.h = det.h;
        if (det.classification) tr.classification = det.classification;
        if (det.zone) tr.zone = det.zone;
      } else {
        // Tạo track mới
        const newTrack: ActiveTrack = {
          id: ++trackSeq,
          startMs: timeMs,
          lastSeenMs: timeMs,
          y0: det.y0,
          x0: det.x0,
          w: det.w,
          h: det.h,
          classification: det.classification,
          zone: det.zone,
          detections: [det],
        };
        activeTracks.push(newTrack);
        assignedTrackIndices.add(activeTracks.length - 1);
      }
    }
  }

  // Thu thập tất cả các track còn lại
  const allTracks = [...completedTracks, ...activeTracks];

  // Chuyển track thành các segment
  const intermediateSegments: IntermediateSubtitleSegment[] = [];
  for (const tr of allTracks) {
    if (tr.detections.length === 0) continue;

    const { text, confidence } = selectStableText(tr.detections);
    if (!text) continue;

    const startMs = tr.detections[0].timeMs;
    const endMs = Math.round(tr.detections[tr.detections.length - 1].timeMs + frameIntervalMs);
    const framesCount = tr.detections.length;
    const needsReview = confidence < 65 || framesCount === 1;
    const stable = framesCount >= 2 && confidence >= 65;

    intermediateSegments.push({
      startMs,
      endMs,
      text,
      confidence,
      frames: framesCount,
      stable,
      needsReview,
      y0: tr.y0,
      x0: tr.x0,
      w: tr.w,
      h: tr.h,
      classification: tr.classification,
      zone: tr.zone,
    });
  }

  // Nếu bật splitStaticBleed (chế độ dual): tách các dòng tĩnh/bảng nằm trên phần thoại trong cùng vùng dưới
  // TRƯỚC khi deduplicate cắt ngắn timestamp theo thứ tự tuyến tính.
  let dialogueInputs = intermediateSegments;
  let overlaySegments: SrtLine[] | undefined;
  if (options?.splitStaticBleed) {
    const split = splitStaticBleedFromSegments(intermediateSegments);
    dialogueInputs = split.dialogueSegments;
    if (split.bleedSegments.length > 0) {
      const collapsed = collapseSimultaneousOverlaySegments(split.bleedSegments, frameIntervalMs);
      overlaySegments = deduplicateSubtitleSegments(collapsed, frameIntervalMs, { preserveNewlines: true });
    } else {
      overlaySegments = [];
    }
  }

  const segments = deduplicateSubtitleSegments(dialogueInputs, frameIntervalMs);
  const highConfidence = segments.filter((s) => !s.needsReview).length;
  const needsReview = segments.filter((s) => s.needsReview).length;
  const duplicatesMerged = Math.max(0, totalDetections - segments.length);

  return {
    segments,
    ...(options?.splitStaticBleed ? { overlaySegments } : {}),
    stats: {
      framesScanned: frames.length,
      textDetections: totalDetections,
      trackedGroups: allTracks.length,
      duplicatesMerged,
      finalEvents: segments.length,
      highConfidence,
      needsReview,
    },
  };
}

/**
 * Ghép kết quả OCR từng khung thành dòng phụ đề có timestamp (Rule 4, 5, 6, 7).
 * Wrapper tương thích ngược cho buildSubtitleSegmentsWithStats.
 */
export function buildSubtitleSegments(
  frames: OcrFrameResult[],
  frameIntervalMs: number,
): SrtLine[] {
  return buildSubtitleSegmentsWithStats(frames, frameIntervalMs).segments;
}

/**
 * Tách các segment tĩnh (bảng/chú thích tràn từ vùng trên xuống phần trên của vùng dưới)
 * khỏi phụ đề thoại khi chúng nằm cao hơn (`y0` nhỏ hơn) và đứng yên suốt >= 2 lượt thoại
 * thay đổi liên tiếp bên dưới.
 */
export function splitStaticBleedFromSegments(
  segments: IntermediateSubtitleSegment[],
): { dialogueSegments: IntermediateSubtitleSegment[]; bleedSegments: IntermediateSubtitleSegment[] } {
  if (segments.length <= 1) {
    return { dialogueSegments: [...segments], bleedSegments: [] };
  }

  const bleedIndices = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    const cand = segments[i];
    if (cand.zone === 'top') {
      bleedIndices.add(i);
      continue;
    }

    const candDuration = cand.endMs - cand.startMs;
    const candY0 = cand.y0 ?? -1;
    if (candY0 < 0 || candDuration < 2000) continue;

    const minVerticalGap = Math.max(20, Math.round((cand.h ?? 24) * 0.6));
    const lowerOverlapping = segments.filter((other, j) => {
      if (j === i) return false;
      const otherY0 = other.y0 ?? -1;
      if (otherY0 < 0) return false;
      if (otherY0 <= candY0 + minVerticalGap) return false;
      if (isSpatiallyCompatible(
        { y0: candY0, h: cand.h, classification: cand.classification, zone: cand.zone },
        { y0: otherY0, h: other.h, classification: other.classification, zone: other.zone },
      )) {
        return false;
      }

      const overlap = Math.min(cand.endMs, other.endMs) - Math.max(cand.startMs, other.startMs);
      if (overlap < 300) return false;

      // Hai hàng của cùng 1 bảng tĩnh có cùng khung giờ không tính là "lượt thoại thay đổi"
      const sameSpan =
        Math.abs(other.startMs - cand.startMs) <= 600 &&
        Math.abs(other.endMs - cand.endMs) <= 600;
      if (sameSpan) return false;

      return true;
    });

    if (lowerOverlapping.length === 0) continue;

    lowerOverlapping.sort((a, b) => a.startMs - b.startMs);
    const distinctTurns: IntermediateSubtitleSegment[] = [];
    for (const seg of lowerOverlapping) {
      const prev = distinctTurns[distinctTurns.length - 1];
      if (prev && checkMergeMatch(prev.text, seg.text).matched && seg.startMs - prev.endMs <= 1200) {
        continue;
      }
      distinctTurns.push(seg);
    }

    const isExplicitOverlayWithSub =
      cand.classification === 'OVERLAY' &&
      lowerOverlapping.some((other) => other.classification === 'SUBTITLE');

    if (distinctTurns.length >= 2 || isExplicitOverlayWithSub) {
      bleedIndices.add(i);
    }
  }

  const dialogueSegments: IntermediateSubtitleSegment[] = [];
  const bleedSegments: IntermediateSubtitleSegment[] = [];
  segments.forEach((seg, idx) => {
    if (bleedIndices.has(idx)) {
      bleedSegments.push(seg);
    } else {
      dialogueSegments.push(seg);
    }
  });

  return { dialogueSegments, bleedSegments };
}

function mergeOverlayLinesPreserveOrder(aText: string, bText: string): string {
  const linesA = aText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const linesB = bText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const combined = [...linesA];
  for (const lb of linesB) {
    const alreadyExists = combined.some((la) => checkMergeMatch(la, lb).matched);
    if (!alreadyExists) {
      combined.push(lb);
    }
  }
  return combined.join('\n');
}

function collapseSimultaneousOverlaySegments(
  segments: IntermediateSubtitleSegment[],
  frameIntervalMs: number,
): IntermediateSubtitleSegment[] {
  if (segments.length <= 1) return [...segments];

  const sorted = [...segments].sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return (a.y0 ?? 0) - (b.y0 ?? 0);
  });

  const maxStartDiff = Math.max(1200, frameIntervalMs * 2.5);
  const groups: IntermediateSubtitleSegment[] = [];

  for (const seg of sorted) {
    const matchGroup = groups.find((g) => {
      const overlap = Math.min(g.endMs, seg.endMs) - Math.max(g.startMs, seg.startMs);
      const minDur = Math.max(1, Math.min(g.endMs - g.startMs, seg.endMs - seg.startMs));
      return (
        overlap >= minDur * 0.65 &&
        Math.abs(g.startMs - seg.startMs) <= maxStartDiff &&
        Math.abs(g.endMs - seg.endMs) <= maxStartDiff
      );
    });

    if (matchGroup) {
      const topFirst = (seg.y0 ?? 0) < (matchGroup.y0 ?? 0);
      matchGroup.text = topFirst
        ? mergeOverlayLinesPreserveOrder(seg.text, matchGroup.text)
        : mergeOverlayLinesPreserveOrder(matchGroup.text, seg.text);
      matchGroup.startMs = Math.min(matchGroup.startMs, seg.startMs);
      matchGroup.endMs = Math.max(matchGroup.endMs, seg.endMs);
      matchGroup.confidence = Math.round((matchGroup.confidence + seg.confidence) / 2);
      matchGroup.frames = Math.max(matchGroup.frames, seg.frames);
      matchGroup.y0 = Math.min(matchGroup.y0 ?? 0, seg.y0 ?? 0);
    } else {
      groups.push({ ...seg });
    }
  }

  return groups;
}

/**
 * Chia mảng khung OCR theo nhãn `zone` ('top' vs 'bottom') nhưng giữ nguyên độ dài mảng
 * để `timeMs = frameIdx * frameIntervalMs` luôn khớp chính xác từng frame video.
 */
export function splitFramesByZone(frames: OcrFrameResult[]): {
  topFrames: OcrFrameResult[];
  bottomFrames: OcrFrameResult[];
} {
  const toFrame = (lines: OcrFrameResult['lines']): OcrFrameResult => {
    if (lines.length === 0) {
      return { text: '', confidence: 0, lines: [] };
    }
    const text = lines.map((l) => l.text).join(' ').trim();
    const confidence = lines.reduce((sum, l) => sum + l.confidence, 0) / lines.length;
    return { text, confidence, lines };
  };

  const topFrames: OcrFrameResult[] = [];
  const bottomFrames: OcrFrameResult[] = [];

  for (const frame of frames) {
    const lines = frame.lines || [];
    const topLines = lines.filter((l) => l.zone === 'top');
    const bottomLines = lines.filter((l) => l.zone !== 'top');
    topFrames.push(toFrame(topLines));
    bottomFrames.push(toFrame(bottomLines));
  }

  return { topFrames, bottomFrames };
}

function isOverlayBoardMatch(a: string, b: string): boolean {
  if (checkMergeMatch(a, b).matched) return true;
  const linesA = a.split(/\r?\n/).map(normalizeText).filter(Boolean);
  const linesB = b.split(/\r?\n/).map(normalizeText).filter(Boolean);
  if (linesA.length === 0 || linesB.length === 0) return false;

  let matchedCount = 0;
  for (const la of linesA) {
    if (linesB.some((lb) => checkMergeMatch(la, lb).matched)) {
      matchedCount += 1;
    }
  }
  return matchedCount / Math.max(linesA.length, linesB.length) >= 0.5;
}

/**
 * Tạo timeline độc lập cho File 2 (`_overlay.srt`) từ các khung vùng trên (bảng/thông tin).
 * Các hàng đồng thời trong cùng 1 bảng được giữ nguyên trên nhiều dòng (`\n`),
 * không bị chia cắt theo nhịp lời thoại bên dưới.
 */
export function buildOverlaySegmentsFromTopFrames(
  frames: OcrFrameResult[],
  frameIntervalMs: number,
  extraBleedSegments: SrtLine[] = [],
): SrtLine[] {
  const mergeGapMs = Math.max(frameIntervalMs * 2.5, 1200);
  const activeTracks: ActiveTrack[] = [];
  const completedTracks: ActiveTrack[] = [];
  let trackSeq = 0;

  for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
    const f = frames[frameIdx];
    const timeMs = Math.round(frameIdx * frameIntervalMs);

    const rawLines = f.lines && f.lines.length > 0
      ? f.lines
      : (f.text && isUsableText(f.text, f.confidence) ? [{ text: f.text, confidence: f.confidence, y0: 0 }] : []);

    const groupedRows = groupFrameLinesIntoRows(rawLines)
      .filter((l) => isUsableText(l.text, l.confidence))
      .sort((a, b) => a.y0 - b.y0);

    for (let i = activeTracks.length - 1; i >= 0; i--) {
      if (timeMs - activeTracks[i].lastSeenMs > mergeGapMs) {
        completedTracks.push(activeTracks[i]);
        activeTracks.splice(i, 1);
      }
    }

    if (groupedRows.length === 0) continue;

    const combinedText = groupedRows.map((r) => normalizeText(r.text)).filter(Boolean).join('\n');
    if (!combinedText) continue;

    const avgConf = Math.round(
      groupedRows.reduce((s, r) => s + r.confidence, 0) / groupedRows.length,
    );
    const minY0 = Math.min(...groupedRows.map((r) => r.y0));
    const maxBottom = Math.max(...groupedRows.map((r) => r.y0 + (r.h ?? 30)));
    const det: TextDetection = {
      text: combinedText,
      confidence: avgConf,
      timeMs,
      y0: minY0,
      x0: groupedRows[0].x0,
      w: groupedRows[0].w,
      h: maxBottom - minY0,
      classification: 'OVERLAY',
      zone: 'top',
    };

    const matchTrack = activeTracks.find((tr) => {
      if (timeMs - tr.lastSeenMs > mergeGapMs) return false;
      const lastDet = tr.detections[tr.detections.length - 1];
      return isOverlayBoardMatch(lastDet.text, det.text);
    });

    if (matchTrack) {
      matchTrack.lastSeenMs = timeMs;
      matchTrack.detections.push(det);
      matchTrack.y0 = det.y0;
      matchTrack.h = det.h;
    } else {
      activeTracks.push({
        id: ++trackSeq,
        startMs: timeMs,
        lastSeenMs: timeMs,
        y0: det.y0,
        x0: det.x0,
        w: det.w,
        h: det.h,
        classification: 'OVERLAY',
        zone: 'top',
        detections: [det],
      });
    }
  }

  const allTracks = [...completedTracks, ...activeTracks];
  const intermediate: IntermediateSubtitleSegment[] = [];

  for (const tr of allTracks) {
    if (tr.detections.length === 0) continue;
    const { text, confidence } = selectStableText(tr.detections, true);
    if (!text) continue;

    const startMs = tr.detections[0].timeMs;
    const endMs = Math.round(tr.detections[tr.detections.length - 1].timeMs + frameIntervalMs);
    const framesCount = tr.detections.length;

    intermediate.push({
      startMs,
      endMs,
      text,
      confidence,
      frames: framesCount,
      stable: framesCount >= 2 && confidence >= 65,
      needsReview: confidence < 65 || framesCount === 1,
      y0: tr.y0,
      x0: tr.x0,
      w: tr.w,
      h: tr.h,
      classification: 'OVERLAY',
      zone: 'top',
    });
  }

  for (const bleed of extraBleedSegments) {
    const cleaned = normalizeMultilineText(bleed.text);
    if (!cleaned) continue;
    intermediate.push({
      startMs: bleed.startMs,
      endMs: bleed.endMs,
      text: cleaned,
      confidence: bleed.confidence ?? 75,
      frames: bleed.frames ?? 2,
      stable: bleed.stable ?? true,
      needsReview: bleed.needsReview ?? false,
      classification: 'OVERLAY',
      zone: 'top',
    });
  }

  if (intermediate.length === 0) return [];
  const collapsed = collapseSimultaneousOverlaySegments(intermediate, frameIntervalMs);
  return deduplicateSubtitleSegments(collapsed, frameIntervalMs, { preserveNewlines: true });
}

/**
 * Hậu xử lý 5 tầng loại bỏ phụ đề lặp (Rule 13 & 14):
 * Level 1: Trùng hệt chuỗi (exact match)
 * Level 2: Trùng key chuẩn hoá (mergeKey)
 * Level 3: Mờ thích ứng (fuzzy Levenshtein / karaoke prefix)
 * Level 4: Tương đồng vị trí không gian (spatial)
 * Level 5: Liên tục thời gian (temporal gap <= maxGapMs)
 *
 * Đồng thời bảo vệ các câu độc lập (Rule 14) và không cắt xén top overlay vs bottom subtitle.
 */
export function deduplicateSubtitleSegments(
  segments: Array<{
    startMs: number;
    endMs: number;
    text: string;
    confidence?: number;
    frames?: number;
    stable?: boolean;
    needsReview?: boolean;
    y0?: number;
    x0?: number;
    w?: number;
    h?: number;
    classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
    zone?: 'top' | 'bottom';
  }>,
  frameIntervalMs: number = 500,
  options?: { preserveNewlines?: boolean },
): SrtLine[] {
  if (segments.length === 0) return [];

  const preserveNewlines = Boolean(options?.preserveNewlines);
  const maxGapMs = Math.max(1000, frameIntervalMs * 2);

  // Sắp xếp theo startMs, sau đó theo y0
  const sorted = [...segments].sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return (a.y0 ?? 0) - (b.y0 ?? 0);
  });

  const result: Array<{
    startMs: number;
    endMs: number;
    text: string;
    confidence: number;
    frames: number;
    stable: boolean;
    needsReview: boolean;
    y0?: number;
    x0?: number;
    w?: number;
    h?: number;
    classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
    zone?: 'top' | 'bottom';
  }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const text = preserveNewlines ? normalizeMultilineText(seg.text) : normalizeText(seg.text);
    if (!text) continue;

    // Lọc rác OCR (ký tự đơn lẻ, dấu trôi nổi, nhiễu khung hình)
    if (isOcrGarbageLine({ id: 'temp', startMs: seg.startMs, endMs: seg.endMs, text }, { minDurationMs: 0 })) {
      continue;
    }
    const alnum = text.replace(/[^\p{L}\p{N}]/gu, '');
    const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
    if (!isCjk && alnum.length <= 1) {
      continue;
    }

    const conf = seg.confidence ?? 70;
    const fCount = seg.frames ?? 1;
    const isNeedsRev = seg.needsReview ?? (conf < 65 || fCount === 1);
    const isStable = seg.stable ?? (fCount >= 2 && conf >= 65);

    // Tìm segment gần nhất trước đó có cùng vùng không gian (để xem có gộp được không)
    let merged = false;
    for (let j = result.length - 1; j >= 0; j--) {
      const prev = result[j];
      const gap = seg.startMs - prev.endMs;

      // Nếu khoảng cách thời gian vượt quá maxGapMs, không xét tiếp các phần tử xa hơn
      if (gap > maxGapMs) break;

      // Kiểm tra tính tương thích không gian
      const spatialCompat = isSpatiallyCompatible(
        { y0: seg.y0 ?? -1, h: seg.h, classification: seg.classification, zone: seg.zone },
        { y0: prev.y0 ?? -1, h: prev.h, classification: prev.classification, zone: prev.zone },
      );
      if (!spatialCompat) continue;

      // Kiểm tra text khớp (Level 1, 2, 3; nếu giữ nhiều dòng dùng thêm isOverlayBoardMatch)
      const match = checkMergeMatch(prev.text, text);
      const boardMatched = match.matched || (preserveNewlines && isOverlayBoardMatch(prev.text, text));
      if (boardMatched) {
        // Gộp vào prev
        prev.endMs = Math.max(prev.endMs, seg.endMs);
        const bestCandidate = match.bestText && match.bestText.length >= prev.text.length
          ? match.bestText
          : (text.length > prev.text.length ? text : prev.text);
        prev.text = bestCandidate;
        prev.frames += fCount;
        prev.confidence = Math.round((prev.confidence + conf) / 2);
        prev.needsReview = prev.confidence < 65 || prev.frames === 1;
        prev.stable = prev.frames >= 2 && prev.confidence >= 65;
        merged = true;
        break;
      }
    }

    if (!merged) {
      result.push({
        startMs: seg.startMs,
        endMs: seg.endMs,
        text,
        confidence: conf,
        frames: fCount,
        stable: isStable,
        needsReview: isNeedsRev,
        y0: seg.y0,
        x0: seg.x0,
        w: seg.w,
        h: seg.h,
        classification: seg.classification,
        zone: seg.zone,
      });
    }
  }

  // Đảm bảo không chồng timestamp giữa các dòng nằm trong CÙNG dải không gian
  for (let i = 0; i < result.length - 1; i++) {
    const cur = result[i];
    for (let j = i + 1; j < result.length; j++) {
      const next = result[j];
      if (next.startMs >= cur.endMs) break; // không còn chồng thời gian

      // Chỉ cắt ngắn nếu cùng dải không gian (tránh cắt nhầm top overlay song song với bottom subtitle)
      const sameBand = isSpatiallyCompatible(
        { y0: cur.y0 ?? -1, h: cur.h, classification: cur.classification, zone: cur.zone },
        { y0: next.y0 ?? -1, h: next.h, classification: next.classification, zone: next.zone },
      );
      if (sameBand && next.startMs > cur.startMs && cur.endMs > next.startMs) {
        cur.endMs = next.startMs;
      }
    }
  }

  // Lọc watermark / channel handle lặp lại nhiều lần xuyên suốt video (ví dụ: ANGELANJ...)
  const textOccurrences = new Map<string, { count: number; firstMs: number; lastMs: number }>();
  for (const r of result) {
    const k = mergeKey(r.text);
    if (!k || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(r.text)) continue;
    const occ = textOccurrences.get(k) || { count: 0, firstMs: r.startMs, lastMs: r.endMs };
    occ.count += 1;
    occ.firstMs = Math.min(occ.firstMs, r.startMs);
    occ.lastMs = Math.max(occ.lastMs, r.endMs);
    textOccurrences.set(k, occ);
  }

  const watermarkKeys = new Set<string>();
  const totalVideoMs = result.length > 0 ? (result[result.length - 1].endMs - result[0].startMs) : 0;
  for (const [k, occ] of textOccurrences.entries()) {
    const spanMs = occ.lastMs - occ.firstMs;
    if (occ.count >= 4 || (totalVideoMs > 15000 && spanMs >= totalVideoMs * 0.25 && occ.count >= 3)) {
      watermarkKeys.add(k);
    }
  }

  const filteredResult = result.filter((r) => {
    const k = mergeKey(r.text);
    if (k && watermarkKeys.has(k)) return false;
    return true;
  });

  // Đảm bảo không chồng lấn timestamp giữa các dòng phụ đề kề nhau trong danh sách cuối cùng
  // (Với overlay đa dòng, chỉ tỉa nhẹ phần chồng lấn nhỏ ở đuôi để không cắt mất bảng dài)
  const smallTailOverlapMs = Math.max(1500, frameIntervalMs * 2);
  for (let i = 0; i < filteredResult.length - 1; i++) {
    const cur = filteredResult[i];
    const next = filteredResult[i + 1];
    if (cur.endMs > next.startMs && next.startMs > cur.startMs) {
      if (!preserveNewlines || cur.endMs - next.startMs <= smallTailOverlapMs) {
        cur.endMs = next.startMs;
      }
    }
  }

  return filteredResult.map((s, index) => ({
    id: `line-${index}`,
    startMs: Math.max(0, s.startMs),
    endMs: Math.max(s.startMs + 100, s.endMs),
    text: s.text,
    confidence: s.confidence,
    frames: s.frames,
    stable: s.stable,
    needsReview: s.needsReview,
    source: 'ocr' as const,
    displayStartMs: Math.max(0, s.startMs),
    displayEndMs: Math.max(s.startMs + 100, s.endMs),
  }));
}

/** Ghép các dòng phụ đề thành nội dung file .srt (trả về null nếu không có dòng nào) */
export function segmentsToSrt(segments: SrtLine[]): string | null {
  if (segments.length === 0) return null;
  return serializeSrt(segments);
}

/**
 * Bỏ dòng "lớp phủ tĩnh" ở 1/4 TRÊN khung: watermark/logo/tên kênh in cố định
 * xuất hiện từ đầu đến cuối video. Chỉ áp dụng cho vùng y < 25% chiều cao —
 * phụ đề (dù đứng yên suốt video) nằm ở vùng dưới không bao giờ bị đụng tới.
 * Cần biết height video (ffprobe); height = 0 thì bỏ qua lọc.
 */
export function filterPersistentTopLines(
  frames: OcrFrameResult[],
  frameIntervalMs: number,
  videoHeight: number,
): OcrFrameResult[] {
  if (!videoHeight || frames.length === 0) return frames;
  const topLimit = videoHeight * 0.25;
  const totalMs = frames.length * frameIntervalMs;
  if (totalMs <= 0) return frames;

  // Band = nhóm dòng theo y0 (bucket 64px) — watermark OCR chênh vài px giữa các khung
  const bandKeyOf = (y0: number) => Math.round(y0 / 64);
  const firstSeen = new Map<number, number>();
  const lastSeen = new Map<number, number>();
  frames.forEach((f, i) => {
    const t = i * frameIntervalMs;
    for (const line of f.lines) {
      if (line.y0 < 0 || line.y0 >= topLimit) continue;
      const band = bandKeyOf(line.y0);
      if (!firstSeen.has(band)) firstSeen.set(band, t);
      lastSeen.set(band, t);
    }
  });

  // Band bị coi là lớp phủ tĩnh nếu xuất hiện cả ở 25% đầu và 25% cuối video
  // (watermark có thể bị OCR bỏ sót vài khung — cửa sổ 10% là hụt)
  const staticBands = new Set<number>();
  for (const [band, first] of firstSeen) {
    const last = lastSeen.get(band) ?? first;
    if (first <= totalMs * 0.25 && last >= totalMs * 0.75) staticBands.add(band);
  }
  if (staticBands.size === 0) return frames;

  return frames.map((f) => {
    const kept = f.lines.filter(
      (l) => !(l.y0 >= 0 && l.y0 < topLimit && staticBands.has(bandKeyOf(l.y0))),
    );
    if (kept.length === f.lines.length) return f;
    if (kept.length === 0) return { text: '', confidence: 0, lines: [] };
    return {
      text: kept.map((l) => l.text).join(' '),
      confidence: kept.reduce((s, l) => s + l.confidence, 0) / kept.length,
      lines: kept,
    };
  });
}

function isUsableText(text: string, confidence: number): boolean {
  if (!text) return false;
  if (confidence < MIN_CONFIDENCE) return false;
  return true;
}

/** Khóa so sánh khi gộp khung: bỏ space/dấu câu, lowercase — chỉ còn "chữ cái" */
function mergeKey(text: string): string {
  return text
    .replace(/[\s.,!?;:、。，！？…·'"“”‘’()（）[\]{}<>《》—–\-]+/g, '')
    .toLowerCase();
}

export interface MergeMatch {
  matched: boolean;
  bestText?: string;
}

/**
 * Kiểm tra xem hai đoạn text có nên gộp thành cùng một dòng phụ đề không:
 * 1. Giống hệt nhau (sau khi chuẩn hoá bỏ dấu/khoảng trắng).
 * 2. Phụ đề tích lũy dạng karaoke (chuỗi này là tiền tố bắt đầu của chuỗi kia).
 * 3. Sai số ký tự nhỏ do OCR nhiễu (Levenshtein thích ứng theo độ dài và ngôn ngữ).
 */
export function checkMergeMatch(a: string, b: string): MergeMatch {
  if (a === b) return { matched: true, bestText: a };
  const ka = mergeKey(a);
  const kb = mergeKey(b);
  if (!ka || !kb) return { matched: false };

  // Trùng khớp hoàn toàn sau chuẩn hoá
  if (ka === kb) {
    return { matched: true, bestText: b.length >= a.length ? b : a };
  }

  // 1. Phụ đề tích lũy (Cumulative / Karaoke text):
  // Một chuỗi là tiền tố của chuỗi kia (tối thiểu 3 ký tự)
  if (ka.length >= 3 && kb.length >= 3) {
    if (kb.startsWith(ka)) {
      return { matched: true, bestText: b };
    }
    if (ka.startsWith(kb)) {
      return { matched: true, bestText: a };
    }
  }

  // 2. Kiểm tra ngôn ngữ CJK:
  const isCjk = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ka);
  if (isCjk) {
    // Với chữ Hán/Nhật: mỗi ký tự là một từ, chỉ cho phép sai khác 1 ký tự khi câu đủ dài (>= 10 ký tự)
    if (ka.length >= 10 && kb.length >= 10 && levenshteinWithin(ka, kb, 1)) {
      return { matched: true, bestText: b.length >= a.length ? b : a };
    }
    return { matched: false };
  }

  // 3. Với chữ Latin (Tiếng Việt, Anh):
  // Sai lệch 1-2 ký tự do dấu thanh, nhầm l/1, o/0
  const maxLen = Math.max(ka.length, kb.length);
  const minLen = Math.min(ka.length, kb.length);
  const lenDiff = maxLen - minLen;

  if (minLen >= 4 && lenDiff <= 2) {
    const maxDist = maxLen >= 12 ? 2 : 1;
    if (levenshteinWithin(ka, kb, maxDist)) {
      return { matched: true, bestText: b.length >= a.length ? b : a };
    }
  }

  return { matched: false };
}

export function isSimilarMerge(a: string, b: string): boolean {
  return checkMergeMatch(a, b).matched;
}

/** Levenshtein với giới hạn — vượt maxDist trả false sớm, không tính hết */
function levenshteinWithin(a: string, b: string, maxDist: number): boolean {
  if (Math.abs(a.length - b.length) > maxDist) return false;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // Cả hàng đều vượt ngưỡng → không bao giờ hội tụ về <= maxDist
    if (rowMin > maxDist) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= maxDist;
}

/** Chuẩn hoá text OCR: gộp dòng/khoảng trắng, sửa dấu câu dính khoảng trắng */
function normalizeText(raw: string): string {
  if (!raw) return '';
  const s = raw
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    // Tesseract chèn space giữa từng chữ Hán/Nhật — ghép lại thành từ liên tiếp
    // (chỉ áp dụng cho CJK; tiếng Hàn giữ nguyên space giữa các từ như bản gốc)
    .replace(/([\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff])\s+(?=[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff])/g, '$1')
    .trim();
}

/** Chuẩn hoá từng dòng riêng lẻ và giữ nguyên dấu xuống dòng (`\n`) cho bảng/overlay nhiều hàng */
function normalizeMultilineText(raw: string): string {
  if (!raw) return '';
  return raw
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join('\n');
}
