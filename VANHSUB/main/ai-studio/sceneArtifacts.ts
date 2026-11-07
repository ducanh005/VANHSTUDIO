import type { PipelineSessionState } from './types';
import { invalidateSessionArtifacts } from './sessionArtifacts';

export function applySceneMedia(session: PipelineSessionState, shotId: string, media: { imagePath?: string; videoPath?: string; visualPrompt?: string; provenance?: NonNullable<PipelineSessionState['artifacts']['scenes']>[number]['mediaProvenance'] }): void {
  const scene = session.artifacts.scenes?.find(item => item.id === shotId || item.shotId === shotId);
  if (!scene) throw new Error('Phân cảnh không tồn tại trong phiên này.');
  if (!media.imagePath && !media.videoPath) throw new Error('Không có media mới cho phân cảnh.');
  if (media.imagePath) scene.imagePath = media.imagePath;
  scene.videoPath = media.videoPath;
  scene.assetPath = media.videoPath || media.imagePath;
  scene.mediaProvenance = media.provenance;
  if (!media.videoPath) delete scene.originalMediaDurationSec;
  scene.motionType = media.videoPath ? 'video' : 'ken_burns';
  if (media.visualPrompt !== undefined) scene.visualPrompt = media.visualPrompt;
  scene.status = 'ready';
  delete scene.error;
  invalidateSessionArtifacts(session, 7);
  if (session.currentStage >= 5) {
    const ready = session.artifacts.scenes!.every(item => item.status === 'ready' && Boolean(item.assetPath));
    session.currentStage = ready ? 6 : 5;
    session.stageName = ready ? 'visuals' : 'storyboard';
    session.status = 'awaiting_approval';
    session.stages[session.currentStage] = { ...session.stages[session.currentStage], status: 'success', stageName: ready ? 'Ảnh / Video' : 'Storyboard' };
    session.progress = ready ? 75 : 62.5;
    delete session.error;
  }
}
