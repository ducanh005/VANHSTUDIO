import { hasUsableScript } from './aiStudioScript';

/** @param {{currentStage?:number,artifacts?:any}} session */
export function stageApprovalIssue(session) {
  const a = session.artifacts || {}, stage = session.currentStage;
  if (stage === 2 && !hasUsableScript(a.scriptLines)) return 'Kịch bản chưa hợp lệ để duyệt.';
  if (stage === 3 && (!a.audioPath || !hasUsableScript(a.scriptLines))) return 'Thiếu audio hoặc script hợp lệ.';
  if (stage === 4 && (!hasUsableScript(a.scriptLines) || a.scriptLines.some(line =>
    !Number.isFinite(line.startMs) || !Number.isFinite(line.endMs) || line.startMs < 0 || line.endMs <= line.startMs))) return 'Timing từng câu chưa hợp lệ.';
  if ((stage === 5 || stage === 6) && (!Array.isArray(a.scenes) || !a.scenes.length || a.scenes.some(scene => !scene?.id || !Number.isFinite(scene.durationMs) || scene.durationMs <= 0))) return 'Storyboard chưa có scene/timing hợp lệ.';
  if (stage === 6 && a.scenes.some(scene => scene.status !== 'ready' || !(scene.assetPath || scene.videoPath || scene.imagePath))) return 'Còn scene thiếu media; hãy nhập hoặc tạo media trước khi duyệt.';
  if (stage === 7 && !a.videoPath) return 'Thiếu video đã render.';
  if (stage === 8 && !a.metadata?.title) return 'Thiếu metadata SEO.';
  return null;
}
