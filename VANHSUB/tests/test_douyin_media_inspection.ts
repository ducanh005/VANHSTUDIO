import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { getFfmpegBinPath } from '../main/asr/audioExtractor';
import { inspectMediaFile, removableMetadataFields, sampleTimes, looksLikeMark } from '../main/media/mediaInspection';
import { douyinStreamCandidates, downloadDouyinNoWatermark, downloadVideoFromUrl, normalizeDouyinUrl } from '../main/helpers/videoDownloader';
import { resolveGrantedMedia, IMAGE_EXTENSIONS } from '../main/security/mediaCapabilities';
import { isCancelledError } from '../main/lib/cancel';
import { TaskStore } from '../main/store/taskStore';
import { ExportRunner } from '../main/render/exportRunner';
import { DubbingRunner } from '../main/render/dubbingRunner';

const root = path.resolve('audit-output/media-inspection-tests');
fs.mkdirSync(root, { recursive: true });
const dir = fs.mkdtempSync(path.join(root, 'run-'));
process.env.VANHSUB_TASKS_DIR = path.join(dir, 'task-store');
process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings-store');
const ffmpeg = getFfmpegBinPath();
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ff = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', ...args], { windowsHide: true, maxBuffer: 8_000_000 });
let passed = 0;
function pass(name: string) { console.log(`PASS ${++passed}: ${name}`); }

async function main() {
  const candidates = douyinStreamCandidates('https://cdn.example/playwm/?video_id=abc', [
    'https://cdn.example/playwm/?video_id=abc', 'https://cdn.example/play/?video_id=abc',
    'https://cdn.example/movie.mp4?watermark=1', 'javascript:alert(1)', 'not a URL',
  ]);
  assert.deepEqual(candidates, ['https://cdn.example/play/?video_id=abc']);
  assert.equal(await normalizeDouyinUrl('https://www.douyin.com/user/self?modal_id=7694614404276428264'), 'https://www.douyin.com/video/7694614404276428264');
  pass('Douyin user/self normalized; no marked/invalid backup URL');
  assert.equal(sampleTimes(50.2).length, 24);
  assert.deepEqual(sampleTimes(0.04), [0]);
  assert.equal(sampleTimes(3600).at(-1), 3599.9);
  assert.ok(looksLikeMark('抖音号: author123'));
  assert.ok(looksLikeMark('@creator'));
  assert.ok(!looksLikeMark('Hello world'));
  assert.ok(!looksLikeMark('reference [video] and [video2]'));
  pass('bounded frame sampling includes end; text marker heuristics');
  assert.deepEqual(removableMetadataFields({ 'format.comment': 'vid:abc123', 'format.copyright': 'Creator', 'format.information': '{"com.bytedance.info":"{\"aigc\":true}"}' }), ['format.comment']);
  pass('AI provenance and copyright are not selected for deletion');

  const source = path.join(dir, 'source.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'comment=vid:unit123', '-metadata', 'information={"com.bytedance.info":"{}"}', '-metadata', 'copyright=Test Creator', '-metadata', 'artist=Test Creator', '-movflags', 'use_metadata_tags', source]);
  const originalHash = hash(source);
  const report = await inspectMediaFile(source, { cleanMetadata: true, ocrCachePath: path.join(dir, 'missing-models'), sampleCount: 2 });
  assert.equal(report.decode, 'passed');
  assert.equal(report.metadata.status, 'cleaned');
  assert.equal(report.metadata.removedFields.length, 2);
  assert.equal(report.metadata.after['format.copyright'], 'Test Creator');
  assert.equal(report.metadata.after['format.artist'], 'Test Creator');
  assert.equal(report.metadata.remainingSourceFields.length, 0);
  assert.notEqual(report.filePath, source);
  assert.equal(hash(source), originalHash);
  assert.equal(report.visual.status, 'unavailable');
  assert.equal(report.visual.scannedFrames, 0);
  assert.equal(report.visual.frames.length, 2);
  assert.ok(fs.existsSync(report.reportPath));
  const mediaHashes = (file: string) => ff(['-i', file, '-map', '0:v', '-map', '0:a', '-f', 'framemd5', '-']).toString();
  assert.equal(mediaHashes(report.filePath), mediaHashes(source));
  pass('real remux removes technical IDs, preserves source/attribution and decoded audio/video');
  const again = await inspectMediaFile(source, { cleanMetadata: true, ocrCachePath: path.join(dir, 'missing-models'), sampleCount: 1 });
  assert.notEqual(again.filePath, report.filePath);
  assert.ok(fs.existsSync(report.filePath));
  pass('repeat inspection never overwrites previous editing copy');
  const projectReports = fs.mkdtempSync(path.join(dir, 'project-'));
  const optOut = await inspectMediaFile(source, { reportDirectory: projectReports, cleanMetadata: false, ocrCachePath: path.join(dir, 'missing-models'), sampleCount: 1 });
  assert.equal(optOut.filePath, source);
  assert.equal(path.dirname(path.dirname(optOut.reportPath)), projectReports);
  assert.equal(resolveGrantedMedia(optOut.visual.frames[0].imagePath, { files: [source], directories: [projectReports] }, IMAGE_EXTENSIONS), fs.realpathSync(optOut.visual.frames[0].imagePath));
  assert.equal(optOut.metadata.status, 'not_requested');
  assert.equal(optOut.metadata.remainingSourceFields.length, 2);
  assert.equal(hash(source), originalHash);
  pass('metadata option off keeps original file and reports retained IDs');
  const audioOnly = path.join(dir, 'audio-only.mp3');
  ff(['-i', source, '-vn', '-c:a', 'libmp3lame', '-metadata', 'comment=vid:audio123', audioOnly]);
  const audioReport = await inspectMediaFile(audioOnly, { cleanMetadata: true });
  assert.equal(audioReport.visual.status, 'not_applicable');
  assert.equal(audioReport.decode, 'passed');
  assert.ok(!audioReport.metadata.after['format.comment']);
  pass('audio-only file is verified without claiming a visual watermark scan');

  const provenance = path.join(dir, 'provenance.mp4');
  ff(['-i', source, '-map', '0', '-c', 'copy', '-metadata', 'information={"com.bytedance.info":"{\"aigc\":true}"}', '-movflags', 'use_metadata_tags', provenance]);
  const preserved = await inspectMediaFile(provenance, { cleanMetadata: true, ocrCachePath: path.join(dir, 'missing-models'), sampleCount: 1 });
  assert.equal(preserved.metadata.after['format.information'], '{"com.bytedance.info":"{\"aigc\":true}"}');
  assert.ok(preserved.metadata.remainingSourceFields.includes('format.information'));
  pass('non-empty provenance survives real remux and remains visible in report');

  const beforeFiles = fs.readdirSync(dir).filter(f => f.endsWith('.mp4'));
  let cancelled = false;
  await assert.rejects(inspectMediaFile(source, { cleanMetadata: true, shouldStop: () => cancelled, onProgress: message => { if (message.includes('giải mã')) cancelled = true; } }), isCancelledError);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.mp4')), beforeFiles);
  assert.equal(hash(source), originalHash);
  pass('cancel during postprocessing removes only its new copy and preserves original');
  const invalid = path.join(dir, 'invalid.mp4');
  fs.writeFileSync(invalid, Buffer.alloc(20_000, 1));
  await assert.rejects(inspectMediaFile(invalid, { cleanMetadata: true }));
  pass('invalid file >10 KB cannot pass media verification');

  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url || '');
    if (req.url === '/broken') { res.writeHead(503); res.end(); return; }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/playwm/' }); res.end(); return; }
    const bytes = fs.readFileSync(source);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length }); res.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await downloadDouyinNoWatermark(`${base}/broken`, 'fixture', dir, undefined, undefined, [`${base}/playwm/`]);
    assert.ok(seen.includes('/play/'));
    assert.ok(!seen.includes('/playwm/'));
    seen.length = 0;
    await downloadDouyinNoWatermark(`${base}/redirect`, 'fixture', dir, undefined, undefined, [`${base}/safe`]);
    assert.ok(!seen.includes('/playwm/'));
    assert.ok(seen.includes('/safe'));
    pass('real HTTP failures and redirects never request watermarked fallback');
    const progress: string[] = [];
    const result = await downloadVideoFromUrl({ url: 'https://www.douyin.com/video/7694614404276428264', noWatermarkUrl: `${base}/safe`, outputDir: dir, customFileName: 'download-test', onProgress: p => progress.push(p.status) });
    assert.ok(result.inspection);
    assert.ok(result.originalFilePath && fs.existsSync(result.originalFilePath));
    assert.notEqual(result.originalFilePath, result.filePath);
    assert.equal(hash(result.originalFilePath!), originalHash);
    assert.ok(progress.includes('processing'));
    assert.equal(progress.at(-1), 'completed');
    assert.equal(progress.filter(p => p === 'completed').length, 1);
    pass('complete Douyin download saves original + inspected editing copy; completed only after report');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }

  const srt = path.join(dir, 'subtitles.srt');
  fs.writeFileSync(srt, '1\n00:00:00,100 --> 00:00:01,700\nTesting subtitles\n');
  const taskFiles = () => {
    const projectDir = fs.mkdtempSync(path.join(dir, 'export-project-'));
    const srtPath = path.join(projectDir, 'subtitles.srt');
    fs.copyFileSync(srt, srtPath);
    return { projectDir, srtPath };
  };
  for (const mode of ['softsub', 'hardsub'] as const) {
    const task = TaskStore.create({ fileName: path.basename(source), filePath: source, ...taskFiles(), mediaInspection: report, originalFilePath: source, cleanTechnicalMetadata: true });
    assert.equal(TaskStore.getById(task.id)?.mediaInspection?.reportPath, report.reportPath);
    const progress: number[] = [];
    const exported = await ExportRunner.runExport(task.id, mode, null, () => { const current=TaskStore.getById(task.id); if(current) progress.push(current.progress); });
    assert.ok(progress.every((value,index)=>index===0 || value>=progress[index-1]), `Export progress regressed: ${progress.join(',')}`);
    assert.equal(exported?.status, 'done');
    assert.equal(exported.outputInspection?.decode, 'passed');
    assert.equal(exported.outputInspection?.filePath, exported.outputPath);
    assert.ok(exported.outputInspection?.reportPath && fs.existsSync(exported.outputInspection.reportPath));
    assert.equal(hash(source), originalHash);
    pass(`${mode} real export persists inspection of final output and keeps source`);
  }
  const ttsDir = path.join(dir, 'tts'); fs.mkdirSync(ttsDir);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100', '-t', '1', '-c:a', 'libmp3lame', path.join(ttsDir, 'subtitle_0001.mp3')]);
  const dubTask = TaskStore.create({ fileName: path.basename(source), filePath: source, ...taskFiles(), ttsAudioDir: ttsDir, cleanTechnicalMetadata: true });
  const dubProgress: number[] = [];
  const dubbed = await DubbingRunner.runDubbing(dubTask.id, true, () => { const current=TaskStore.getById(dubTask.id); if(current) dubProgress.push(current.progress); });
  assert.ok(dubProgress.every((value,index)=>index===0 || value>=dubProgress[index-1]), `Dubbing progress regressed: ${dubProgress.join(',')}`);
  assert.equal(dubbed?.status, 'done');
  assert.equal(dubbed.outputInspection?.decode, 'passed');
  assert.equal(dubbed.outputInspection?.filePath, dubbed.outputPath);
  assert.equal(dubbed.dubbedVideoPath, dubbed.outputPath);
  pass('real dubbing export includes final media inspection');
  const cancelTask = TaskStore.create({ fileName: path.basename(source), filePath: source, ...taskFiles(), cleanTechnicalMetadata: true });
  const cancelledExport = await ExportRunner.runExport(cancelTask.id, 'softsub', null, () => {
    if (TaskStore.getById(cancelTask.id)?.stageDescription === 'Đang đọc thông số và metadata...') ExportRunner.cancel(cancelTask.id);
  });
  assert.equal(cancelledExport?.status, 'cancelled');
  assert.equal(cancelledExport.outputInspection, undefined);
  pass('cancel during export inspection cannot resurrect a completed task');

  // Optional local OCR integration uses already installed data, never a fake OCR result.
  const cache = process.env.VANHSUB_TEST_OCR_CACHE;
  if (cache) {
    const marked = path.join(dir, 'visible-mark.mp4');
    ff(['-f', 'lavfi', '-i', 'color=c=white:s=640x360:r=5', '-vf', "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='DOUYIN ID author123':fontsize=36:fontcolor=black:x=20:y=20", '-t', '1', '-c:v', 'libx264', marked]);
    const ocr = await inspectMediaFile(marked, { ocrCachePath: cache, sampleCount: 1 });
    assert.equal(ocr.visual.scannedFrames, 1, ocr.visual.message);
    assert.ok(ocr.visual.frames[0].suspectedMark, ocr.visual.frames[0].text);
    assert.equal(ocr.visual.status, 'review_needed');
    pass('real Tesseract recognizes visible ID/logo text in generated video');
  }
  console.log(`COMPLETE ${passed} tests. Evidence: ${dir}`);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
