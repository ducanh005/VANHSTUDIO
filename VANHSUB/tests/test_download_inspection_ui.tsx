import assert from 'assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { backgroundDownloadManager } from '../renderer/lib/downloadManager';
import { MediaInspectionPanel } from '../renderer/components/download/MediaInspectionPanel';
import type { MediaInspection } from '../shared/mediaInspection';

const report: MediaInspection = {
  version: 1, checkedAt: '2026-10-18', originalPath: 'source.mp4', filePath: 'source_edit.mp4', reportPath: 'report.json', duration: 50.2, width: 720, height: 960, decode: 'passed',
  metadata: { status: 'cleaned', removedFields: ['format.comment'], remainingSourceFields: [], before: { 'format.comment': 'vid:old' }, after: {} },
  visual: { status: 'unavailable', method: 'sampled_ocr_and_manual_review', frames: [], scannedFrames: 0, message: 'Missing OCR model' }, warnings: [],
};

async function main() {
  let progress: (value: any) => void = () => {};
  let resolveDownload!: (value: any) => void;
  let sentOptions: any;
  (globalThis as any).window = { vanhsub: { downloader: {
    onProgress: (callback: any) => { progress = callback; return () => {}; },
    download: (options: any) => { sentOptions = options; return new Promise(resolve => { resolveDownload = resolve; }); },
  } } };
  const params = { url: 'https://www.douyin.com/video/7694614404276428264', platform: 'douyin' as const, title: 'Test', cleanMetadata: false };
  const pending = backgroundDownloadManager.startDownload(params);
  assert.equal(sentOptions.cleanMetadata, false);
  progress({ percent: 98, status: 'processing', stageDescription: 'OCR' });
  assert.equal(backgroundDownloadManager.getState().active?.isDownloading, true);
  progress({ percent: 100, status: 'completed' });
  assert.equal(backgroundDownloadManager.getState().active?.isDownloading, true, 'IPC completion/report must arrive before enabling a second download');
  await assert.rejects(backgroundDownloadManager.startDownload(params), /Đang có/);
  resolveDownload({ task: { id: 'test' }, result: { inspection: report } });
  await pending;
  assert.equal(backgroundDownloadManager.getState().active?.isDownloading, false);
  assert.equal(backgroundDownloadManager.getState().active?.inspection, report);
  assert.equal(backgroundDownloadManager.getState().active?.progress.status, 'completed');
  assert.equal(backgroundDownloadManager.getState().active?.progress.percent, 100);
  console.log('PASS: IPC option, processing state, completion ordering, duplicate prevention and report persistence');

  const missing = renderToStaticMarkup(<MediaInspectionPanel report={report} />);
  assert.match(missing, /Chưa hoàn tất kiểm tra hình ảnh/);
  assert.match(missing, /không xác nhận quyền đăng lại/);
  assert.doesNotMatch(missing, /Không watermark.*✓/);
  const partial = renderToStaticMarkup(<MediaInspectionPanel report={{ ...report, visual: { ...report.visual, status: 'partial' } }} />);
  assert.match(partial, /Mới kiểm tra một phần/);
  const sampled = renderToStaticMarkup(<MediaInspectionPanel report={{ ...report, visual: { ...report.visual, status: 'no_text_detected_in_samples' } }} />);
  assert.match(sampled, /cần xem logo bằng mắt/);
  const retained = renderToStaticMarkup(<MediaInspectionPanel report={{ ...report, metadata: { ...report.metadata, status: 'not_requested', remainingSourceFields: ['format.comment'] } }} />);
  assert.match(retained, /không yêu cầu làm sạch/);
  assert.match(retained, /Còn trường thông tin nguồn/);
  console.log('PASS: rendered UI distinguishes missing/partial/sampled OCR and retained metadata without false guarantee');
  backgroundDownloadManager.dismiss();
}
main().catch(err => { console.error(err); process.exitCode = 1; });
