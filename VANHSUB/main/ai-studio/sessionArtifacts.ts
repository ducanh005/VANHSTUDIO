import type { AiStudioStageId, PipelineSessionState, ScriptBeatLine } from './types';
import { assertUsableScript } from '../../shared/aiStudioScript';

/** Invalidate pointers only. Previous production files remain available for recovery. */
export function invalidateSessionArtifacts(session: PipelineSessionState, from: AiStudioStageId): void {
  for (let stage = from; stage <= 8; stage++) {
    session.stages[stage] = { status: 'pending', stageName: session.stages[stage]?.stageName || `Bước ${stage}` };
  }
  const artifacts = session.artifacts;
  if (from <= 3) {
    const revision = session.productionRevision || 0;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revision của session không hợp lệ.');
    session.productionRevision = revision + 1;
    artifacts.audioPath = undefined;
    artifacts.scriptLines = artifacts.scriptLines?.map(clearTiming);
  }
  if (from <= 2) { artifacts.scriptLines = undefined; artifacts.scriptEvaluation = undefined; }
  if (from <= 4) { artifacts.wordsAlignment = undefined; artifacts.alignmentSource = undefined; }
  if (from <= 5) { artifacts.scenes = undefined; artifacts.storyboardSynthesis = undefined; }
  if (from <= 7) { artifacts.videoPath = undefined; artifacts.srtPath = undefined; }
  artifacts.metadata = undefined;
}

function clearTiming(line: ScriptBeatLine): ScriptBeatLine {
  const { audioPath, startMs, endMs, durationMs, assetPath, assetType, ...clean } = line;
  return clean;
}

const narration = (lines: ScriptBeatLine[]) => JSON.stringify(lines.map(({ id, text, speaker, voiceDirection }) => ({ id, text, speaker, voiceDirection })));
const content = (lines: ScriptBeatLine[]) => JSON.stringify(lines.map(clearTiming));

export function applyScriptLines(session: PipelineSessionState, incoming: ScriptBeatLine[]): boolean {
  assertUsableScript(incoming);
  if (!Array.isArray(incoming) || !incoming.length || incoming.some(line =>
    !line || typeof line.id !== 'string' || !line.id.trim() || typeof line.text !== 'string' || !line.text.trim()) ||
    new Set(incoming.map(line => line.id)).size !== incoming.length) {
    throw new Error('Kịch bản phải có lời thoại và ID duy nhất cho từng dòng.');
  }
  const previous = session.artifacts.scriptLines || [];
  const lines = incoming.map((line, index) => ({ ...clearTiming(line), index: index + (previous[0]?.index === 1 ? 1 : 0) }));
  if (content(previous) === content(lines)) return false;
  const voiceChanged = narration(previous) !== narration(lines);
  session.artifacts.scriptHistory ||= [];
  session.artifacts.scriptHistory.push({ lines: structuredClone(previous), evaluation: session.artifacts.scriptEvaluation, timestamp: Date.now() });
  invalidateSessionArtifacts(session, voiceChanged ? 3 : 5);
  session.artifacts.scriptLines = voiceChanged ? lines : lines.map((line, index) => ({
    ...line, audioPath: previous[index]?.audioPath, startMs: previous[index]?.startMs,
    endMs: previous[index]?.endMs, durationMs: previous[index]?.durationMs,
  }));
  session.artifacts.scriptEvaluation = undefined;
  const gate = !voiceChanged && session.stages[4]?.status === 'success' ? 4 : 2;
  session.currentStage = gate;
  session.stageName = gate === 4 ? 'alignment' : 'script';
  session.stages[gate] = { ...session.stages[gate], status: 'success', stageName: session.stages[gate]?.stageName || `Bước ${gate}` };
  session.status = 'awaiting_approval';
  session.progress = gate * 12.5;
  delete session.error;
  return true;
}
