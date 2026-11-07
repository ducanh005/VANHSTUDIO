import { getOrCreateProjectDir } from './utils/projectFolder';
import { handleRendererIpc } from './security/ipc'
import { productionContentPolicy } from './security/contentPolicy'
import { resolveGrantedMedia, IMAGE_EXTENSIONS } from './security/mediaCapabilities'
import { trustRenderer, isTrustedRendererEvent, validateFlowBrowserUrl, validateModelName, resolveBundledPath } from './security/rendererTrust'
import fs from 'fs'
import path from 'path'
import url from 'url'
import { Readable } from 'stream'
import { app, ipcMain, dialog, BrowserWindow, protocol, net, shell } from 'electron'
import si from 'systeminformation'

import { createWindow } from './helpers/create-window'
import { TaskStore, type CreateTaskInput, type Task } from './store/taskStore'
import { saveTaskSubtitle, importTaskSubtitle } from './lib/subtitleArtifacts'
import { assertTaskAvailable, reserveTaskOperation, isTaskOperationActive } from './lib/taskOperations'
import { normalizeDubbingPreferences } from './lib/dubbingPreferences'
import { assertProjectIsolation } from './lib/projectIsolation'
import { SettingsStore, type AppSettings } from './store/settingsStore'
import { polishSubtitleLine, translateSubtitleLine, cleanAndDeduplicateSubtitles } from './ai/geminiClient'
import { normalizeSrtLines, normalizeSrt } from './lib/srtNormalizer'
import { TaskRunner } from './asr/taskRunner'
import { HybridRunner, type HybridRunOptions } from './asr/hybridRunner'
import { TranslateRunner } from './translate/translateRunner'
import { ExportRunner } from './render/exportRunner'
import type { AdvancedExportOptions } from './render/exportRunner'
import type { MaskRegion, SubtitleStyle } from './render/videoRenderer'
import { StemExportRunner } from './audio/stemExportRunner'
import { TTSRunner } from './render/ttsRunner'
import { DubbingRunner } from './render/dubbingRunner'
import { OcrRunner } from './ocr/ocrRunner'
import { checkVietTtsConnection, getAvailableVoices, previewTts, getEdgeVoices } from './render/ttsEngine'
import { VoiceSampleStore } from './store/voiceSampleStore'
import { getAiStudioStore, migrateAiStudioLegacySecrets } from './store/aiStudioStore'
import { extractAudioFromUrl } from './helpers/voiceFromUrl'
import { inspectMediaUrl, downloadVideoFromUrl, resolveBaseFolder, cancelDownload } from './helpers/videoDownloader'
import { inspectMediaFile } from './media/mediaInspection'
import { isCancelledError } from './lib/cancel'
import { installRendererLogger } from './helpers/logger'
import { getSharedTikTokProvider } from './tts-providers/tiktok/sessionStores'
import { TikTokTTSError } from './tts-providers/tiktok/types'
import { registerWorkflowIpc } from './workflow/ipc'
import { registerAiStudioIpc, setAiStudioPipelineEngine } from './ai-studio/ipc'
import { AiStudioPipelineEngine } from './ai-studio/pipelineEngine'
import { resolveAiStudioSessionsRoot } from './ai-studio/AiStudioPipelineEngine'
import { GoogleVeoSessionManager } from './veo/GoogleVeoSessionManager'
import { GoogleVeoAntiSpamGuard } from './veo/GoogleVeoAntiSpamGuard'
import { checkFasterWhisperAvailable, probePythonEnv } from './lib/pythonEnv'

const isProd = process.env.NODE_ENV === 'production'
const auditUserDataDir = process.env.VANHSUB_AUDIT_USER_DATA_DIR
if (auditUserDataDir) {
  const isolated = path.resolve(auditUserDataDir)
  fs.mkdirSync(path.join(isolated, 'temp'), { recursive: true })
  app.setPath('userData', isolated)
  app.setPath('temp', path.join(isolated, 'temp'))
}

// Forward log của main process tới terminal trong app (renderer)
installRendererLogger()

// Phải đăng ký scheme trước khi app ready — 'app' dùng cho render output ở prod,
// 'vanhmedia' dùng để stream file media local vào <video> (cả dev lẫn prod).
try {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        allowServiceWorkers: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: 'vanhmedia',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
} catch (e) {}

if (isProd) {
  app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
      const requestUrl = new URL(request.url)
      let pathname: string
      try { pathname = decodeURIComponent(requestUrl.pathname) } catch { return new Response('Invalid URL', { status: 400 }) }
      if (pathname.startsWith('/')) pathname = pathname.slice(1)

      const appDir = path.resolve(app.getAppPath(), 'app')
      let filePath: string
      try { filePath = resolveBundledPath(appDir, pathname) } catch { return new Response('Forbidden', { status: 403 }) }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html')
      } else if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) {
        filePath = `${filePath}.html`
      }

      if (!fs.existsSync(filePath)) {
        filePath = path.join(appDir, '404.html')
      }

      const resource = await net.fetch(url.pathToFileURL(filePath).toString())
      if (path.extname(filePath).toLowerCase() === '.html') {
        const html = await resource.text()
        const headers = new Headers(resource.headers)
        headers.set('Content-Security-Policy', productionContentPolicy(html))
        return new Response(html, { status: resource.status, headers })
      }
      return resource
    })
  })
} else if (!auditUserDataDir) {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

// =========================================================================
// VANHMEDIA PROTOCOL — stream file media local cho trình xem trước
// Xử lý header Range để <video> seek được (206 Partial Content).
// URL dạng: vanhmedia://local/<encodeURIComponent(đường_dẫn_file)>
// =========================================================================

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const selectedMediaFiles = new Set<string>()
const selectedMediaDirectories = new Set<string>()
function rememberSelection(files: string[]): string[] {
  for (const file of files) {
    if (fs.statSync(file).isDirectory()) selectedMediaDirectories.add(file)
    else selectedMediaFiles.add(file)
  }
  return files
}
function getMediaGrants() {
  const files = new Set(selectedMediaFiles), directories = new Set(selectedMediaDirectories)
  for (const task of TaskStore.getAll()) {
    for (const file of [task.filePath, task.audioPath, task.srtPath, task.translatedSrtPath, task.outputPath, task.dubbedVideoPath, task.ttsMergedAudioPath]) if (file) files.add(file)
    for (const dir of [task.projectDir, task.ttsAudioDir]) if (dir) directories.add(dir)
  }
  const config = getAiStudioStore().store
  for (const project of config.savedProjects || []) {
    if (project.outputDir) directories.add(project.outputDir)
    if (/^[a-zA-Z0-9_-]{1,128}$/.test(project.id)) directories.add(path.join(process.cwd(), 'flow_outputs', 'projects', project.id))
  }
  const catalog = resolveAiStudioSessionsRoot()
  if (fs.existsSync(catalog)) for (const name of fs.readdirSync(catalog)) {
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue
    try {
      const state = JSON.parse(fs.readFileSync(path.join(catalog, name), 'utf8'))
      if (state.sessionId !== name.slice(0, -5) || !config.savedProjects?.some(project => project.id === state.ownerProjectId)) continue
      const workspace = state.workspaceDir || state.outputDir
      const checkpoint = JSON.parse(fs.readFileSync(path.join(workspace, 'session.json'), 'utf8'))
      if (checkpoint.sessionId !== state.sessionId || checkpoint.ownerProjectId !== state.ownerProjectId) continue
      for (const dir of [workspace, state.mediaDir, state.artifacts?.mediaDir]) if (typeof dir === 'string') directories.add(dir)
    } catch { /* A corrupt/unowned checkpoint cannot grant file access. */ }
  }
  for (const sample of VoiceSampleStore.list()) { const file = VoiceSampleStore.getPath(sample.name); if (file) files.add(file) }
  directories.add(path.join(app.getPath('temp'), 'vanhsub_workflow'))
  return { files, directories }
}

app.whenReady().then(() => {
  protocol.handle('vanhmedia', async (request) => {
    try {
      const requestUrl = new URL(request.url)
      if (requestUrl.hostname !== 'local') return new Response('Forbidden', { status: 403 })
      let rawPath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ''))

      // Bóc tách tiền tố file:/// hoặc file:// nếu truyền nhầm
      if (rawPath.startsWith('file:///')) {
        rawPath = rawPath.replace(/^file:\/\/\//, '')
      } else if (rawPath.startsWith('file://')) {
        rawPath = rawPath.replace(/^file:\/\//, '')
      }

      // Chuẩn hóa định dạng ổ đĩa Windows có dấu gạch chéo đầu (ví dụ /D:/ -> D:/)
      if (/^\/[a-zA-Z]:/.test(rawPath)) {
        rawPath = rawPath.slice(1)
      }

      const resolvedFilePath = resolveGrantedMedia(rawPath, getMediaGrants())

      const stat = fs.statSync(resolvedFilePath)
      const mime = MIME_BY_EXT[path.extname(resolvedFilePath).toLowerCase()] || 'application/octet-stream'
      const rangeHeader = request.headers.get('Range')

      // Hỗ trợ HTTP 206 Partial Content cho các yêu cầu tua (seek) video / audio
      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
        if (match) {
          let start = match[1] ? parseInt(match[1], 10) : 0
          let end = match[2] ? parseInt(match[2], 10) : stat.size - 1
          if (Number.isNaN(start) || start < 0) start = 0
          if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1

          if (start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }

          const stream = Readable.toWeb(
            fs.createReadStream(resolvedFilePath, { start, end })
          ) as unknown as BodyInit

          return new Response(stream, {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
            },
          })
        }
      }

      // Cho các yêu cầu nạp toàn bộ file (ví dụ thẻ <img> nạp ảnh PNG/JPG):
      // Ưu tiên sử dụng net.fetch với file:// URL để Chromium tự giải mã stream C++ gốc
      const fileUrl = url.pathToFileURL(resolvedFilePath).toString()
      try {
        const fetchRes = await net.fetch(fileUrl)
        if (fetchRes.ok) {
          return fetchRes
        }
      } catch {}

      // Fallback nếu net.fetch không khả dụng
      const stream = Readable.toWeb(fs.createReadStream(resolvedFilePath)) as unknown as BodyInit
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch (err: any) {
      if (err?.message === 'MEDIA_FORBIDDEN' || err?.message === 'MEDIA_AMBIGUOUS') return new Response('Forbidden or ambiguous media', { status: 403 })
      console.error('[vanhmedia] Error serving media:', err)
      return new Response(`Lỗi stream media: ${err?.message || err}`, { status: 500 })
    }
  })
})

let mainWindow: any = null

function broadcastTasksUpdate() {
  if (mainWindow && !mainWindow.isDestroyed())  {
    mainWindow.webContents.send('tasks:updated', TaskStore.getAll())
  }
}

;(async () => {
  await app.whenReady()


  // Run only after Windows safeStorage is ready. Failures leave the old store untouched.
  for (const migrate of [() => SettingsStore.migrateLegacySecrets(), migrateAiStudioLegacySecrets]) {
    try { migrate(); }
    catch { console.warn('[Secrets] Chưa thể nâng cấp mã hóa cấu hình cũ; dữ liệu cũ được giữ nguyên.'); }
  }

  // Khởi động đồng bộ session Google Flow / Veo từ phân vùng Electron
  try {
    await GoogleVeoSessionManager.getInstance().init()
  } catch (veoInitErr) {
    console.warn('Không thể khởi tạo session Google Veo ban đầu:', veoInitErr)
  }

  // Khởi động WebSocket Bridge Server để kết nối với Chrome Extension (VanhSub Flow Bridge)
  try {
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    if (process.env.VANHSUB_DISABLE_FLOW_BRIDGE !== '1') {
      const bridge = getFlowBridgeServer();
      bridge.configurePairing(path.join(app.getPath('userData'), 'flow-bridge-pairing.json'));
      // Isolated runtime acceptance must not occupy the user's bridge ports.
      bridge.start(auditUserDataDir && process.env.VANHSUB_AUDIT_BRIDGE_EPHEMERAL === '1' ? 0 : undefined);
    }
  } catch (bridgeErr) {
    console.warn('[FlowBridgeServer] Không thể khởi động WebSocket Server:', bridgeErr);
  }

  // Gỡ kẹt task còn dính trạng thái "đang chạy" của phiên trước (crash/đóng app):
  // đánh dấu error để chạy lại được — pipeline vẫn bỏ qua các bước đã có kết quả
  const staleFixed = TaskStore.resetStaleRunning()
  if (staleFixed.length > 0) {
    console.log(`[Boot] Đã gỡ kẹt ${staleFixed.length} task bị gián đoạn từ phiên trước`)
  }

  mainWindow = createWindow('main', {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webSecurity: true,
    },
  })


  if (isProd) {
    trustRenderer(mainWindow.webContents, 'app://./home')
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2] || '8888'
    trustRenderer(mainWindow.webContents, `http://localhost:${port}/home`)
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }
})()

app.on('window-all-closed', () => {
  app.quit()
})

// =========================================================================
// WORKFLOW MODE IPC HANDLERS
// =========================================================================
registerWorkflowIpc()

// =========================================================================
// AI VIDEO STUDIO IPC HANDLERS
// =========================================================================
registerAiStudioIpc((file, extensions) => resolveGrantedMedia(file, getMediaGrants(), extensions))
setAiStudioPipelineEngine(new AiStudioPipelineEngine())

handleRendererIpc('bridge:create-pairing-code', async () => {
  const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
  return getFlowBridgeServer().createPairingCode();
})
handleRendererIpc('bridge:revoke-pairing', async () => {
  const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
  getFlowBridgeServer().revokePairing();
  return true;
})

// =========================================================================
// TASK MANAGEMENT IPC HANDLERS
// =========================================================================

handleRendererIpc('tasks:getAll', async () => {
  return TaskStore.getAll()
})

handleRendererIpc('tasks:get', async (_event, id: string) => {
  return TaskStore.getById(id)
})

// Phân tích liên kết video (Douyin, YouTube, Bilibili, TikTok...)
handleRendererIpc('downloader:inspect', async (_event, rawUrl: string) => {
  try {
    return await inspectMediaUrl(rawUrl);
  } catch (err: any) {
    throw new Error(err.message || 'Không thể phân tích video từ liên kết này');
  }
});

// Lấy thư mục lưu trữ mặc định hiện tại
handleRendererIpc('downloader:getDefaultDir', async () => {
  try {
    return resolveBaseFolder();
  } catch (err: any) {
    console.error('[downloader:getDefaultDir] Lỗi:', err);
    return '';
  }
});

// Tải video MP4 từ liên kết và tự động tạo Task trong thư mục dự án
handleRendererIpc('downloader:download', async (_event, options: { url: string; quality?: any; noWatermarkUrl?: string; outputDir?: string; customFileName?: string; downloadId?: string; cleanMetadata?: boolean }) => {
  try {
    const result = await downloadVideoFromUrl({
      url: options.url,
      quality: options.quality,
      noWatermarkUrl: options.noWatermarkUrl,
      outputDir: options.outputDir,
      customFileName: options.customFileName,
      downloadId: options.downloadId,
      cleanMetadata: options.cleanMetadata,
      onProgress: (progress) => {
        mainWindow?.webContents.send('downloader:progress', progress);
      },
    });

    const task = TaskStore.create({
      fileName: result.fileName,
      filePath: result.filePath,
      fileSize: result.fileSize || '0 MB',
      workflow: 'fast-transcribe',
      status: 'queued',
      progress: 0,
      projectDir: result.projectDir,
      originalFilePath: result.originalFilePath,
      mediaInspection: result.inspection,
      cleanTechnicalMetadata: result.inspection ? options.cleanMetadata !== false : undefined,
      stageDescription: 'Đã tải từ link — sẵn sàng làm việc',
    });

    broadcastTasksUpdate();
    return { task, result };
  } catch (err: any) {
    if (isCancelledError(err)) {
      throw new Error('Đã huỷ tải video');
    }
    throw new Error(err.message || 'Lỗi khi tải video từ liên kết');
  }
});

const mediaCheckJobs = new Map<string, { cancelled: boolean }>();
handleRendererIpc('downloader:checkTask', async (_event, taskId: string, target: 'source' | 'output') => {
  const task = TaskStore.getById(taskId);
  if (!task || !['source', 'output'].includes(target)) throw new Error('Tác vụ kiểm tra không hợp lệ.');
  if (mediaCheckJobs.has(taskId)) throw new Error('Tác vụ này đang được kiểm tra.');
  if (['exporting', 'dubbing'].includes(task.status)) throw new Error('Hãy đợi xuất video hoàn tất rồi kiểm tra.');
  const filePath = target === 'output' ? task.outputPath : task.filePath;
  if (!filePath) throw new Error('Chưa có file để kiểm tra.');
  const job = { cancelled: false };
  mediaCheckJobs.set(taskId, job);
  try {
    return await awaitTaskOperation(taskId, async () => {
      const report = await inspectMediaFile(filePath, {
        cleanMetadata: false,
        reportDirectory: getOrCreateProjectDir(task),
        source: task.mediaInspection?.source,
        shouldStop: () => job.cancelled || cancelledOperations.has(taskId),
      });
      const current = TaskStore.getById(taskId);
      if (!current || (target === 'output' ? current.outputPath : current.filePath) !== filePath || ['exporting', 'dubbing'].includes(current.status)) {
        throw new Error('File tác vụ đã thay đổi trong lúc kiểm tra. Hãy kiểm tra lại file mới.');
      }
      TaskStore.update(taskId, target === 'output' ? { outputInspection: report } : { mediaInspection: report });
      broadcastTasksUpdate();
      return report;
    });
  } finally { mediaCheckJobs.delete(taskId); }
});
handleRendererIpc('downloader:cancelCheck', (_event, taskId: string) => {
  const job = mediaCheckJobs.get(taskId);
  if (job) job.cancelled = true;
  return Boolean(job);
});

// Huỷ tiến trình tải video
handleRendererIpc('downloader:cancel', async (_event, downloadId?: string) => {
  try {
    return cancelDownload(downloadId);
  } catch (err: any) {
    console.error('[downloader:cancel] Lỗi huỷ download:', err);
    return false;
  }
});

// Chạy cả quy trình còn thiếu: phiên âm → dịch → tạo giọng → ghép video.
// Mỗi bước chỉ chạy khi kết quả của nó chưa tồn tại (resume được), và pipeline
// dừng ngay nếu bước nào bị lỗi hoặc bị huỷ. Chạy nền — UI tự cập nhật qua broadcast.
//
// Batch: nhiều pipeline chạy SONG SONG nhưng qua hàng đợi, tối đa
// MAX_PARALLEL_PIPELINES task cùng lúc — whisper/TTS đều ngốn GPU/CPU nên
// chạy vô giới hạn sẽ tranh tài nguyên làm chậm cả nhóm.
const MAX_PARALLEL_PIPELINES = 2;
const pipelineActive = new Set<string>();
const pipelineQueued: string[] = [];
const pipelineReleases = new Map<string, () => void>();
const cancelledOperations = new Set<string>();

function finishTaskOperation(id: string, release: () => void): void {
  try {
    if (cancelledOperations.delete(id)) {
      TaskStore.update(id, { status: 'cancelled', stageDescription: 'Đã huỷ tác vụ' });
    }
  } finally { release(); }
  broadcastTasksUpdate();
}

function launchTaskOperation(id: string, work: () => Promise<unknown>): boolean {
  const task = TaskStore.getById(id);
  if (!task) throw new Error('Không tìm thấy tác vụ.');
  assertProjectIsolation(task);
  const release = reserveTaskOperation(id);
  void Promise.resolve().then(() => cancelledOperations.has(id) ? undefined : work()).catch((error) => {
    if (!cancelledOperations.has(id)) {
      TaskStore.update(id, { status: 'error', errorMessage: error?.message || String(error),
        stageDescription: 'Không thể xử lý tác vụ' });
    }
  }).finally(() => finishTaskOperation(id, release)).catch(error => console.error('[Task] Cannot persist final state:', error));
  return true;
}

async function awaitTaskOperation<T>(id: string, work: () => Promise<T>): Promise<T> {
  const task = TaskStore.getById(id);
  if (!task) throw new Error('Không tìm thấy tác vụ.');
  assertProjectIsolation(task);
  const release = reserveTaskOperation(id);
  try { return await work(); } finally { finishTaskOperation(id, release); }
}

function enqueuePipeline(id: string): boolean {
  const task = TaskStore.getById(id);
  if (!task) return false;
  assertProjectIsolation(task);
  if (['transcribing', 'translating', 'dubbing', 'exporting'].includes(task.status)) return false;
  if (pipelineActive.has(id) || pipelineQueued.includes(id)) return false;
  if (isTaskOperationActive(id)) return false;
  pipelineReleases.set(id, reserveTaskOperation(id));
  pipelineQueued.push(id);
  return true;
}

function drainPipelines(): void {
  while (pipelineActive.size < MAX_PARALLEL_PIPELINES && pipelineQueued.length > 0) {
    const id = pipelineQueued.shift()!;
    pipelineActive.add(id);
    void executePipeline(id).catch(error => console.error('[Pipeline] Failed:', error)).finally(() => {
      pipelineActive.delete(id);
      finishTaskOperation(id, pipelineReleases.get(id) || (() => {}));
      pipelineReleases.delete(id);
      drainPipelines();
    });
  }
}

async function executePipeline(id: string): Promise<void> {
  // enqueuePipeline already owns the lease, including its queued lifetime.
  await executePipelineStages(id);
}

async function executePipelineStages(id: string): Promise<void> {
  const onUpdate = () => broadcastTasksUpdate()
  const stop = (t: Task | undefined, label: string): boolean => {
    if (cancelledOperations.has(id)) return true
    if (!t || t.status === 'error' || t.status === 'cancelled') {
      console.log(`[Pipeline] Dừng ở bước ${label} (status: ${t?.status || 'unknown'})`)
      return true
    }
    return false
  }

  try {
    console.log(`[Pipeline] Bắt đầu chạy cả quy trình cho task ${id}`)

    // 1. Phiên âm (bỏ qua nếu đã có SRT)
    let current = TaskStore.getById(id)!
    if (!current.srtPath) {
      current = (await TaskRunner.runTask(id, onUpdate))!
      if (stop(current, 'phiên âm')) return
    }

    // 2. Dịch (bỏ qua nếu đã có bản dịch hoặc chưa có Gemini key)
    if (!current.translatedSrtPath && SettingsStore.hasGeminiKey()) {
      current = (await TranslateRunner.runTranslate(id, undefined, onUpdate))!
      if (stop(current, 'dịch thuật')) return
    }

    // 3. Tạo giọng đọc (bỏ qua nếu đã có audio TTS)
    current = TaskStore.getById(id)!
    if (current.srtPath && (!current.ttsAudioDir || current.ttsNeedsRegeneration)) {
      current = (await TTSRunner.runTTS(id, undefined, undefined, onUpdate))!
      if (stop(current, 'tạo lồng tiếng')) return
    }

    // 4. Ghép audio vào video
    current = TaskStore.getById(id)!
    if (current.srtPath && current.ttsAudioDir) {
      const preferences = normalizeDubbingPreferences(current.dubbingPreferences)
      await DubbingRunner.runDubbing(id, preferences.replaceAudio, onUpdate, preferences)
    }
    console.log(`[Pipeline] Hoàn tất quy trình cho task ${id}`)
  } catch (err) {
    console.error('[Pipeline] Lỗi không mong muốn:', err)
    if (!cancelledOperations.has(id)) TaskStore.update(id, { status: 'error', errorMessage: String(err) })
  }
}

handleRendererIpc('tasks:runPipeline', async (_event, id: string, opts?: { replaceAudio?: boolean }) => {
  const enqueued = enqueuePipeline(id)
  if (enqueued && opts?.replaceAudio !== undefined) {
    const task = TaskStore.getById(id)!
    TaskStore.update(id, { dubbingPreferences: normalizeDubbingPreferences({ ...task.dubbingPreferences,
      replaceAudio: opts.replaceAudio }) })
  }
  if (enqueued) drainPipelines()
  return enqueued
})

// Batch: enqueue nhiều task cùng lúc — hàng đợi sẽ chạy tối đa
// MAX_PARALLEL_PIPELINES task song song, task sau tự vào khi task trước xong
handleRendererIpc('tasks:runPipelineBatch', async (_event, ids: string[]) => {
  let enqueued = 0
  for (const id of ids || []) {
    try {
      if (enqueuePipeline(id)) enqueued++
    } catch (error: any) {
      TaskStore.update(id, { status: 'error', errorMessage: error?.message || String(error),
        stageDescription: 'Không thể thêm vào hàng đợi' })
    }
  }
  drainPipelines()
  console.log(`[Pipeline] Batch: nhận ${enqueued}/${ids?.length || 0} tác vụ vào hàng đợi`)
  return enqueued
})

handleRendererIpc('tasks:create', async (_event, input: CreateTaskInput) => {
  const task = TaskStore.create(input)
  broadcastTasksUpdate()
  return task
})

handleRendererIpc('tasks:update', async (_event, id: string, updates: Partial<Task>) => {
  assertTaskAvailable(id)
  const task = TaskStore.update(id, updates)
  broadcastTasksUpdate()
  return task
})

function cancelTaskExecution(id: string): boolean {
  // 1. Gỡ khỏi hàng đợi pipeline nếu đang chờ
  const qIdx = pipelineQueued.indexOf(id)
  if (qIdx !== -1) {
    pipelineQueued.splice(qIdx, 1)
    pipelineReleases.get(id)?.()
    pipelineReleases.delete(id)
  }
  const activeOperation = isTaskOperationActive(id)
  if (activeOperation) cancelledOperations.add(id)

  // 2. Huỷ bỏ các runner có thể đang chạy
  const asrCancelled = TaskRunner.cancel(id)
  const ocrCancelled = OcrRunner.cancel(id)
  const hybridCancelled = HybridRunner.cancel(id)
  const translateCancelled = TranslateRunner.cancel(id)
  const ttsCancelled = TTSRunner.cancel(id)
  const exportCancelled = ExportRunner.cancel(id)
  const dubbingCancelled = DubbingRunner.cancel(id)
  const stemsCancelled = StemExportRunner.cancel(id)

  // 3. Cập nhật trạng thái Store nếu task đang trong quá trình chạy
  const currentTask = TaskStore.getById(id)
  if (currentTask && (qIdx !== -1 || activeOperation || ['queued', 'transcribing', 'ocr', 'translating', 'dubbing', 'exporting'].includes(currentTask.status))) {
    TaskStore.update(id, {
      status: 'cancelled',
      stageDescription: 'Đã huỷ tác vụ',
    })
  }

  return qIdx !== -1 || activeOperation || asrCancelled || ocrCancelled || hybridCancelled || translateCancelled || ttsCancelled || exportCancelled || dubbingCancelled || stemsCancelled
}

handleRendererIpc('tasks:delete', async (_event, id: string) => {
  if (isTaskOperationActive(id)) throw new Error('Hãy hủy và đợi tác vụ dừng hẳn trước khi xóa.');
  cancelTaskExecution(id)
  const result = TaskStore.delete(id)
  broadcastTasksUpdate()
  return result
})

handleRendererIpc('tasks:start', async (_event, id: string) => {
  return launchTaskOperation(id, () => TaskRunner.runTask(id, () => {
    broadcastTasksUpdate()
  }))
})

// Huỷ tác vụ đang chạy hoặc đang chờ trong hàng đợi
handleRendererIpc('tasks:cancel', async (_event, id: string) => {
  const cancelled = cancelTaskExecution(id)
  broadcastTasksUpdate()
  return cancelled
})

// Chạy kết hợp kép Whisper ASR + Quét OCR (R2 - Độ chính xác tuyệt đối)
handleRendererIpc('tasks:startHybrid', async (_event, id: string, options?: HybridRunOptions) => {
  return launchTaskOperation(id, () => HybridRunner.runHybrid(id, options, () => {
    broadcastTasksUpdate()
  }))
})

// Huỷ tác vụ kết hợp Whisper + OCR
handleRendererIpc('tasks:cancelHybrid', async (_event, id: string) => {
  return HybridRunner.cancel(id)
})

handleRendererIpc('tasks:readSrt', async (_event, srtPath: string) => {
  srtPath = resolveGrantedMedia(srtPath, getMediaGrants(), new Set(['.srt']))
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File SRT không tồn tại: ${srtPath}`)
  }
  return fs.readFileSync(srtPath, 'utf-8')
})

handleRendererIpc('tasks:writeSrt', async (_event, srtPath: string, content: string) => {
  srtPath = resolveGrantedMedia(srtPath, getMediaGrants(), new Set(['.srt']))
  saveTaskSubtitle(srtPath, content)
  broadcastTasksUpdate()
  return true
})

// Nhập file SRT có sẵn cho task (video đã có phụ đề, bỏ qua bước phiên âm):
// copy vào thư mục video để hiệu đính không đụng vào file gốc của người dùng
handleRendererIpc('tasks:importSrt', async (_event, id: string, sourceSrtPath: string) => {
  const updated = importTaskSubtitle(id, sourceSrtPath)
  broadcastTasksUpdate()
  return updated
})

// =========================================================================
// SETTINGS & AI IPC HANDLERS
// =========================================================================

const SETTING_KEYS: Array<keyof AppSettings> = [
  'geminiApiKey',
  'geminiModel',
  'targetLanguage',
  'asrModel',
  'asrEngine',
  'asrDevice',
  'enableDiarization',
  'hfToken',
  'pythonPath',
  'exportDir',
  'translateBatchSize',
  'translateConcurrency',
  'autoTranslateAfterAsr',
  'vietTtsEndpoint',
  'ttsVoice',
  'ttsSpeed',
  'ttsAllowShortening',
  'ocrLanguage',
  'ocrFps',
  'ocrMode',
  'ocrCustomRegion',
  'ocrRegion',
  'ocrDualEngine',
  'glossary',
  'translationStyleGuide',
  'onboardingCompleted',
  'veoMode',
  'veoSessionCookie',
  'veoSessionAuthToken',
  'veoAccountEmail',
  'veoSessionStatus',
  'veoLastChecked',
  'veoCooldownSeconds',
  'veoFlowCredits',
  'veoFlowCreditsCheckedAt',
]

handleRendererIpc('settings:get', async (_event, key: keyof AppSettings) => {
  if (!SETTING_KEYS.includes(key)) {
    throw new Error(`Setting key không hợp lệ: ${key}`)
  }
  return SettingsStore.get(key)
})

handleRendererIpc('settings:set', async (_event, key: keyof AppSettings, value: any) => {
  if (!SETTING_KEYS.includes(key)) {
    throw new Error(`Setting key không hợp lệ: ${key}`)
  }
  SettingsStore.set(key, value)
  mainWindow?.webContents.send('settings:changed', key)
  return true
})

// "Sửa câu bằng AI": hiệu đính 1 câu phụ đề bằng Gemini, kèm ngữ cảnh câu trước/sau
handleRendererIpc('ai:polishLine', async (_event, payload: { text: string; prev?: string; next?: string }) => {
  return polishSubtitleLine(payload)
})

// Dịch nhanh 1 câu phụ đề bằng Gemini
handleRendererIpc(
  'ai:translateLine',
  async (_event, payload: { text: string; targetLanguage?: string; prev?: string; next?: string }) => {
    return translateSubtitleLine(payload)
  }
)

// Dọn dẹp & lọc trùng lặp phụ đề OCR bằng Gemini AI
handleRendererIpc('ai:cleanSubtitles', async (_event, items: any[]) => {
  return cleanAndDeduplicateSubtitles(items)
})

// Chuẩn hóa file phụ đề SRT lỗi OCR (SRT OCR Normalizer)
handleRendererIpc('subtitles:normalize', async (_event, input: string | any[], options?: any) => {
  if (Array.isArray(input)) {
    return normalizeSrtLines(input, options)
  } else if (typeof input === 'string') {
    return normalizeSrt(input, options)
  }
  return input
})

// Quét phụ đề cứng (hardsub) trong video bằng OCR — kết quả là file .srt
// như phiên âm, nên sau đó dịch / tạo lồng tiếng / ghép video chạy bình thường
handleRendererIpc('ocr:start', async (_event, id: string, options?: any) => {
  return launchTaskOperation(id, () => OcrRunner.runOcr(id, options, () => {
    broadcastTasksUpdate()
  }))
})

// Huỷ quét OCR đang chạy (hiệu lực trước khung hình kế tiếp)
handleRendererIpc('ocr:cancel', async (_event, id: string) => {
  return OcrRunner.cancel(id)
})

// Dịch thuật AI qua TranslateRunner
handleRendererIpc('translate:start', async (_event, id: string, targetLanguage?: string) => {
  return launchTaskOperation(id, () => TranslateRunner.runTranslate(id, targetLanguage, () => {
    broadcastTasksUpdate()
  }))
})

// Huỷ dịch đang chạy (hiệu lực sau khi batch hiện tại xong)
handleRendererIpc('translate:cancel', async (_event, id: string) => {
  return TranslateRunner.cancel(id)
})

// Xuất video qua ExportRunner (mask: tùy chọn che vùng phụ đề cũ khi hardsub)
handleRendererIpc(
  'export:start',
  async (
    _event,
    id: string,
    mode: 'hardsub' | 'softsub',
    mask?: MaskRegion | null,
    style?: SubtitleStyle | null,
    advancedOptions?: AdvancedExportOptions | null
  ) => {
    return launchTaskOperation(id, () => ExportRunner.runExport(
      id,
      mode,
      mask,
      () => {
        broadcastTasksUpdate()
      },
      style ?? null,
      advancedOptions ?? null
    ))
  }
)

// Tách nhạc nền / giọng khỏi video bằng AI Demucs — xuất 2 file mp3 cạnh video gốc
handleRendererIpc('export:separateStems', async (_event, id: string) => {
  return launchTaskOperation(id, () => StemExportRunner.runStemExport(id, () => {
    broadcastTasksUpdate()
  }))
})

// Tạo lồng tiếng bằng VietTTS hoặc TikTok TTS (voiceOverrides: gán giọng riêng theo dòng)
handleRendererIpc(
  'tts:start',
  async (
    _event,
    id: string,
    voice?: string,
    speed?: number,
    voiceOverrides?: Record<string, string>,
    engine?: 'viettts' | 'tiktok' | 'edge'
  ) => {
    return launchTaskOperation(id, () => TTSRunner.runTTS(id, voice, speed, () => {
      broadcastTasksUpdate()
    }, voiceOverrides, engine))
  }
)

// Lấy danh sách giọng nói có sẵn
handleRendererIpc('tts:voices', async () => {
  return getAvailableVoices()
})

// Huỷ tạo lồng tiếng đang chạy (hiệu lực sau khi câu hiện tại xong)
handleRendererIpc('tts:cancel', async (_event, id: string) => {
  return TTSRunner.cancel(id)
})

// Tạo lại audio cho 1 dòng phụ đề (sau khi sửa text / đổi giọng)
handleRendererIpc('tts:regenerateLine', async (_event, id: string, lineIndex: number, options?: {
  voice?: string; speed?: number; engine?: 'edge' | 'tiktok' | 'viettts'; voiceOverrides?: Record<string, string>
}) => {
  const result = await awaitTaskOperation(id, () => TTSRunner.regenerateLine(id, lineIndex, options?.voice, options?.speed,
    options?.engine, options?.voiceOverrides, broadcastTasksUpdate))
  broadcastTasksUpdate()
  return result
})

// Ghép lại hoặc xuất file MP3 tổng hợp chính xác theo timeline cho dự án
handleRendererIpc(
  'tts:export-merged-audio',
  async (_event, id: string, targetPath?: string, mode?: 'strict' | 'flexible') => {
    const res = await awaitTaskOperation(id, () => TTSRunner.exportMergedAudio(id, targetPath, mode))
    broadcastTasksUpdate()
    return res
  }
)

// Kiểm tra kết nối VietTTS
handleRendererIpc('tts:check-connection', async () => {
  return checkVietTtsConnection()
})

// Lấy danh sách giọng đọc Edge TTS tiếng Việt miễn phí
handleRendererIpc('tts:getEdgeVoices', async () => {
  return getEdgeVoices()
})

// =========================================================================
// TIKTOK TTS (THỬ NGHIỆM) — sessionid do người dùng tự cung cấp, lưu mã hoá
// bằng safeStorage. Sessionid KHÔNG BAO GIỜ được trả về renderer — mọi IPC
// chỉ trả trạng thái/đường dẫn file/kết quả validate (text mô tả).
// =========================================================================

const tikTokProvider = getSharedTikTokProvider()

/** Bọc lỗi thành payload an toàn — không bao giờ chứa sessionid */
function tiktokErrorPayload(err: unknown): { ok: false; error: string } {
  if (err instanceof TikTokTTSError) return { ok: false, error: err.message }
  const message = err instanceof Error ? err.message : 'Lỗi TikTok TTS không xác định'
  return { ok: false, error: message.replace(/sessionid=[^;\s"']+/gi, 'sessionid=[REDACTED]') }
}

// Trạng thái session — chỉ boolean, không trả giá trị sessionid
handleRendererIpc('tiktok-tts:status', async () => {
  return { hasSession: tikTokProvider.hasSession() }
})

// Lưu sessionid mới — validate format qua manager, chỉ trả { ok }, không echo giá trị
handleRendererIpc('tiktok-tts:save-session', async (_event, sessionId: string) => {
  try {
    tikTokProvider.saveSession(String(sessionId || ''))
    return { ok: true }
  } catch (err) {
    return tiktokErrorPayload(err)
  }
})

handleRendererIpc('tiktok-tts:remove-session', async () => {
  try {
    tikTokProvider.clearSession()
    return { ok: true }
  } catch (err) {
    return tiktokErrorPayload(err)
  }
})

// Kiểm tra session còn hạn không — trả { valid, detail }, detail là mô tả, không chứa session
handleRendererIpc('tiktok-tts:validate', async () => {
  try {
    return await tikTokProvider.validateSession()
  } catch (err) {
    return { valid: false, detail: tiktokErrorPayload(err).error }
  }
})

// Danh sách voice TikTok (catalog tĩnh — xem TikTokVoiceService)
handleRendererIpc('tiktok-tts:voices', async () => {
  try {
    return { ok: true, voices: await tikTokProvider.getVoices() }
  } catch (err) {
    return tiktokErrorPayload(err)
  }
})

// Tổng hợp audio và lưu ra userData/tiktok-tts — trả đường dẫn file, không trả audio base64
handleRendererIpc('tiktok-tts:synthesize', async (_event, text: string, voice: string) => {
  try {
    const stamp = Date.now().toString(36)
    const outPath = path.join(
      app.getPath('userData'),
      'tiktok-tts',
      `tts-${stamp}.mp3`,
    )
    const filePath = await tikTokProvider.saveAudio(String(text || ''), String(voice || ''), outPath)
    return { ok: true, filePath }
  } catch (err) {
    return tiktokErrorPayload(err)
  }
})

// =========================================================================
// GOOGLE VEO SESSION & ANTI-SPAM GUARD IPC HANDLERS
// =========================================================================

handleRendererIpc('veo:open-lobby', async () => {
  try {
    await GoogleVeoSessionManager.getInstance().openLobbyWindow(mainWindow)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Không thể mở sảnh Google Veo' }
  }
})

handleRendererIpc('veo:status', async () => {
  return GoogleVeoSessionManager.getInstance().getStatus()
})

handleRendererIpc('veo:validate', async () => {
  return await GoogleVeoSessionManager.getInstance().validateSession()
})

handleRendererIpc('veo:save-session', async (_event, rawInput: string) => {
  try {
    const result = await GoogleVeoSessionManager.getInstance().saveManualSession(rawInput)
    return { ok: true, result }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Không thể lưu session' }
  }
})

handleRendererIpc('veo:clear-session', async () => {
  try {
    await GoogleVeoSessionManager.getInstance().clearSession()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Lỗi khi xóa session' }
  }
})

handleRendererIpc('veo:get-anti-spam-status', async () => {
  const guard = GoogleVeoAntiSpamGuard.getInstance()
  return {
    status: guard.getStatus(),
    guidelines: GoogleVeoAntiSpamGuard.getSafetyGuidelines(),
  }
})

handleRendererIpc('veo:set-mode', async (_event, mode: any) => {
  GoogleVeoSessionManager.getInstance().setMode(mode)
  return { ok: true }
})

handleRendererIpc('veo:get-credits', async (_event, maxAgeMs?: number) => {
  return GoogleVeoSessionManager.getInstance().getCachedOrFreshCredits(maxAgeMs);
})

handleRendererIpc('veo:show-lobby-debug', async () => {
  return GoogleVeoSessionManager.getInstance().showLobbyForDebug();
})

handleRendererIpc('veo:hide-lobby-offscreen', async () => {
  return GoogleVeoSessionManager.getInstance().hideLobbyOffscreen();
})

handleRendererIpc('veo:is-lobby-debug', async () => {
  return GoogleVeoSessionManager.getInstance().isLobbyDebug();
})

// =========================================================================
// GOOGLE FLOW DIAGNOSTIC & DEBUG BUNDLES (PHASE 8 - STEP 4)
// =========================================================================

handleRendererIpc('flow:export-debug-bundle', async (_event, options?: any) => {
  const { FlowDebugBundleExporter } = await import('./workflow/flow-engine/FlowDebugBundleExporter');
  return FlowDebugBundleExporter.getInstance().exportBundle(options);
});

handleRendererIpc('flow:list-debug-bundles', async () => {
  const { FlowDebugBundleExporter } = await import('./workflow/flow-engine/FlowDebugBundleExporter');
  return FlowDebugBundleExporter.getInstance().listBundles();
});

handleRendererIpc('flow:delete-debug-bundle', async (_event, bundleId: string) => {
  const { FlowDebugBundleExporter } = await import('./workflow/flow-engine/FlowDebugBundleExporter');
  return FlowDebugBundleExporter.getInstance().deleteBundle(bundleId);
});

// =========================================================================
// GIỌNG ĐỌC CLONE TỪ FILE MẪU (voice sample)
// =========================================================================

handleRendererIpc('tts:voice-samples', async () => {
  return VoiceSampleStore.list()
})

// Mở dialog chọn file audio giọng mẫu rồi lưu với tên do người dùng đặt
handleRendererIpc('tts:add-voice-sample', async (_event, name: string) => {
  if (!mainWindow) return { error: 'Ứng dụng chưa sẵn sàng.' }
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn file audio giọng mẫu (khuyên 5–15 giây, rõ tiếng, ít nhiễu)',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'mp4', 'webm'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    const sample = VoiceSampleStore.add({ name, sourcePath: result.filePaths[0] })
    return { sample, samples: VoiceSampleStore.list() }
  } catch (err: any) {
    return { error: err?.message || 'Không thể thêm giọng mẫu.' }
  }
})

handleRendererIpc('tts:remove-voice-sample', async (_event, name: string) => {
  VoiceSampleStore.remove(name)
  return VoiceSampleStore.list()
})

// Thêm giọng mẫu từ link video công khai (TikTok, YouTube, …) — yt-dlp tải audio
// ra file tạm rồi lưu như giọng mẫu thường. yt-dlp tự tải về lần đầu tiên.
handleRendererIpc('tts:add-voice-sample-from-url', async (_event, name: string, url: string) => {
  try {
    if (!/^https?:\/\//i.test(url || '')) {
      throw new Error('Link không hợp lệ — phải bắt đầu bằng http(s)://')
    }
    const tmpAudioPath = path.join(app.getPath('temp'), `vanhsub-voice-${Date.now()}.mp3`)
    await extractAudioFromUrl(url.trim(), tmpAudioPath)
    const sample = VoiceSampleStore.add({ name, sourcePath: tmpAudioPath })
    if (fs.existsSync(tmpAudioPath)) fs.unlinkSync(tmpAudioPath)
    return { sample, samples: VoiceSampleStore.list() }
  } catch (err: any) {
    return { error: err?.message || 'Không thể tải audio từ link.' }
  }
})

// Nghe thử giọng đọc TTS (1 câu ngắn) — trả base64 mp3 cho renderer phát trực tiếp
handleRendererIpc('tts:preview', async (_event, text: string, voice?: string, speed?: number, engine?: 'viettts' | 'tiktok') => {
  const sampleText = (text || '').trim().slice(0, 300) || 'Xin chào! Đây là giọng đọc thử nghiệm của VanhStudio.'
  return previewTts(sampleText, voice, speed, engine)
})

// Dubbing video (mux audio vào video)
// options: syncMode = 'strict' (audio nén theo timeline SRT, mặc định) |
//          'flexible' (cho audio tràn vào khoảng lặng, tối đa 3s) |
//          'video-stretch' (kéo giãn video để khớp audio, hệ số ≤ 1.25)
//          mixOriginalAudio = giữ nhạc nền/th âm gốc, mix nhỏ dưới lời thoại
handleRendererIpc(
  'dubbing:start',
  async (
    _event,
    id: string,
    replaceAudio: boolean = true,
    options?: { syncMode?: 'strict' | 'flexible' | 'video-stretch'; mixOriginalAudio?: boolean; vocalSeparation?: boolean }
  ) => {
    return launchTaskOperation(id, () => DubbingRunner.runDubbing(id, replaceAudio, () => {
      broadcastTasksUpdate()
    }, options))
  }
)

// Quản lý model Whisper
function getModelsDirectory() {
  const devPath = path.resolve(__dirname, '..', 'node_modules/nodejs-whisper/cpp/whisper.cpp/models');
  if (fs.existsSync(devPath)) return devPath;

  const appPath = path.resolve(app.getAppPath(), 'node_modules/nodejs-whisper/cpp/whisper.cpp/models');
  if (fs.existsSync(appPath)) return appPath;

  const prodPath = path.resolve(process.resourcesPath, 'app.asar.unpacked/node_modules/nodejs-whisper/cpp/whisper.cpp/models');
  if (fs.existsSync(prodPath)) return prodPath;

  return devPath;
}

// Lấy thông tin hệ thống (RAM, CPU cores, etc.)
handleRendererIpc('system:info', async () => {
  try {
    const memory = await si.mem();
    const cpu = await si.cpu();
    const osInfo = await si.osInfo();

    return {
      totalMemory: Math.round(memory.total / (1024 * 1024)), // Convert to MB
      freeMemory: Math.round(memory.available / (1024 * 1024)), // Convert to MB
      cpuCores: cpu.cores || 1,
      cpuModel: cpu.brand + ' ' + cpu.model,
      platform: osInfo.platform,
    };
  } catch (err) {
    console.error('Error getting system info:', err);
    return {
      totalMemory: 0,
      freeMemory: 0,
      cpuCores: 1,
      cpuModel: 'Unknown',
      platform: 'unknown',
    };
  }
});

handleRendererIpc('models:list', async () => {
  const dir = getModelsDirectory();
  if (!fs.existsSync(dir)) {
    return [];
  }
  try {
    const files = fs.readdirSync(dir);
    const models = files
      .filter((file) => file.startsWith('ggml-') && file.endsWith('.bin'))
      .map((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const sizeMb = (stat.size / (1024 * 1024)).toFixed(1) + ' MB';
        const name = file.substring(5, file.length - 4);
        return { name, fileName: file, size: sizeMb, filePath };
      });
    return models;
  } catch (err) {
    console.error('Lỗi khi đọc danh sách model:', err);
    return [];
  }
})

// Đường dẫn thư mục lưu model Whisper trên đĩa (hiển thị ở Cài đặt)
handleRendererIpc('models:directory', async () => {
  const dir = getModelsDirectory();
  return { path: dir, exists: fs.existsSync(dir) };
})

handleRendererIpc('models:delete', async (_event, modelName: string) => {
  const dir = getModelsDirectory();
  const file = `ggml-${validateModelName(modelName)}.bin`;
  const filePath = path.join(dir, file);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      console.error(`Lỗi khi xoá model ${modelName}:`, err);
      throw err;
    }
  }
  return false;
})

handleRendererIpc('asr:checkFasterWhisper', async () => {
  return checkFasterWhisperAvailable();
})

handleRendererIpc('system:probePythonEnv', async () => {
  return probePythonEnv();
})


// =========================================================================
// NATIVE DIALOG & SHELL IPC HANDLERS
// =========================================================================

handleRendererIpc('dialog:openMediaFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file Video hoặc Audio',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Video & Audio',
        extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'mp3', 'wav', 'm4a', 'flac', 'aac'],
      },
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac'] },
      { name: 'Tất cả file', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return rememberSelection(result.filePaths)
})

handleRendererIpc('dialog:showInFolder', async (_event, filePath: string) => {
  if (!filePath) return
  if (fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        await shell.openPath(filePath)
      } else {
        shell.showItemInFolder(filePath)
      }
    } catch {
      shell.showItemInFolder(filePath)
    }
  } else {
    const parent = path.dirname(filePath)
    if (fs.existsSync(parent)) {
      await shell.openPath(parent)
    }
  }
})

handleRendererIpc('dialog:openFolder', async (_event, folderPath: string) => {
  if (!folderPath) return
  if (fs.existsSync(folderPath)) {
    await shell.openPath(folderPath)
  } else {
    const parent = path.dirname(folderPath)
    if (fs.existsSync(parent)) {
      await shell.openPath(parent)
    }
  }
})

handleRendererIpc('files:readImageAsDataUrl', async (_event, filePath: string) => {
  if (!filePath || typeof filePath !== 'string') return null
  try {
    filePath = resolveGrantedMedia(filePath, getMediaGrants(), IMAGE_EXTENSIONS)
    if (!fs.existsSync(filePath)) return null
    if (fs.statSync(filePath).size > 64 * 1024 * 1024) return null
    const ext = path.extname(filePath).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
    const buf = fs.readFileSync(filePath)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[readImageAsDataUrl] Lỗi đọc ảnh:', err)
    return null
  }
})

// Chọn file .srt có sẵn (dùng cho "Nhập phụ đề" trên task)
handleRendererIpc('dialog:openSrtFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file phụ đề .srt',
    properties: ['openFile'],
    filters: [
      { name: 'Phụ đề SubRip', extensions: ['srt'] },
      { name: 'Tất cả file', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return rememberSelection(result.filePaths)[0]
})

// Chọn file ảnh (logo, watermark, workflow reference image)
handleRendererIpc('dialog:openImageFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn ảnh tham chiếu / Watermark / Logo',
    properties: ['openFile'],
    filters: [
      { name: 'Hình ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif'] },
      { name: 'Tất cả file', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return rememberSelection(result.filePaths)[0]
})

// Chọn nhạc nền cho AI Studio
handleRendererIpc('dialog:openAudioFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file âm thanh (giọng đọc hoặc nhạc nền)',
    properties: ['openFile'],
    filters: [{ name: 'Âm thanh', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return rememberSelection(result.filePaths)[0]
})

// Chọn 1 file video (dùng cho node Tải Video / Workflow)
handleRendererIpc('dialog:openVideoFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file Video nguồn',
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv'] },
      { name: 'Tất cả file', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return rememberSelection(result.filePaths)[0]
})

// Chọn thư mục (dùng cho cài đặt thư mục xuất mặc định ở trang Settings)
handleRendererIpc('dialog:chooseDirectory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục lưu file xuất',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return rememberSelection(result.filePaths)[0]
})

// ── [DEBUG] Giai đoạn 1 RPC Test ────────────────────────────────────────────
// Xóa handler này sau khi P1+P4 đã xác nhận thành công.
// Gọi từ DevTools Console của renderer:
//   await window.electronAPI.ipcRenderer.invoke('debug:test-rpc-phase1', 'YOUR_PROJECT_UUID')
handleRendererIpc('debug:test-rpc-phase1', async (_event, projectId: string) => {
  try {
    const { testRpcPhase1 } = await import('./workflow/flow-engine/rpc/test_rpc_phase1')
    const win = GoogleVeoSessionManager.getInstance().getLobbyWindow()
    if (!win || win.isDestroyed()) {
      return { success: false, errors: ['lobbyWindow chưa mở hoặc đã bị destroy. Hãy mở app đến bước vào project Flow trước.'] }
    }
    const result = await testRpcPhase1(win, projectId)
    return result
  } catch (e: any) {
    return { success: false, errors: [`Uncaught: ${e?.message ?? e}`] }
  }
})

handleRendererIpc('debug:test-upload-image', async (_event, filePath?: string, projectId?: string) => {
  try {
    const { getFlowRpcClient, getFlowBridgeServer } = await import('./workflow/flow-engine/rpc')
    const bridge = getFlowBridgeServer()
    const win = GoogleVeoSessionManager.getInstance().getLobbyWindow()
    if (!bridge.isConnected() && (!win || win.isDestroyed())) {
      return { success: false, error: 'Chưa có kết nối: Vui lòng mở Chrome Extension (VanhSub Flow Bridge) HOẶC gọi openLobby() trước.' }
    }

    let targetProjectId = projectId;
    if (bridge.isConnected()) {
      const tabInfo = await bridge.getFlowTabInfo();
      if (!targetProjectId && tabInfo?.projectId) {
        targetProjectId = tabInfo.projectId;
        console.log(`[debug:test-upload-image] 🎯 Tự động phát hiện Project ID từ tab Chrome: ${targetProjectId}`);
      }
    }

    if (!targetProjectId) {
      return {
        success: false,
        error: 'Chưa có Project ID hợp lệ! Trên tab Google Chrome, vui lòng bấm vào 1 Dự án (Project) bất kỳ hoặc bấm "+ New project" để vào project page.',
      };
    }

    let targetFile = filePath;
    if (!targetFile) {
      targetFile = path.join(app.getAppPath(), 'app', 'images', 'logo.png');
      if (!fs.existsSync(targetFile)) {
        targetFile = path.join(process.cwd(), 'app', 'images', 'logo.png');
      }
    }

    const client = getFlowRpcClient()
    const result = await client.uploadReferenceImage(win || null, targetFile, targetProjectId)
    return { success: true, mediaId: result.mediaId, projectId: targetProjectId }
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) }
  }
})

handleRendererIpc('debug:test-gen-image', async (_event, prompt: string, projectId?: string, refMediaIds?: string[]) => {
  try {
    const { getFlowRpcClient } = await import('./workflow/flow-engine/rpc')
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer')
    const bridge = getFlowBridgeServer()
    const win = GoogleVeoSessionManager.getInstance().getLobbyWindow()
    if (!bridge.isConnected() && (!win || win.isDestroyed())) {
      return { success: false, error: 'Chưa có kết nối: Vui lòng mở Chrome Extension (VanhSub Flow Bridge) HOẶC gọi openLobby() trước.' }
    }

    let targetProjectId = projectId;
    if (bridge.isConnected()) {
      const tabInfo = await bridge.getFlowTabInfo();
      if (!targetProjectId && tabInfo?.projectId) {
        targetProjectId = tabInfo.projectId;
        console.log(`[debug:test-gen-image] 🎯 Tự động phát hiện Project ID từ tab Chrome: ${targetProjectId}`);
      }
    }

    if (!targetProjectId) {
      return {
        success: false,
        error: 'Chưa có Project ID hợp lệ! Trên tab Google Chrome, vui lòng bấm vào 1 Dự án (Project) bất kỳ hoặc bấm "+ New project" để vào project page trước khi tạo ảnh.',
      };
    }

    const client = getFlowRpcClient()
    const images = await client.generateImage(win || null, {
      prompt: prompt || 'a cinematic cute red panda in autumn forest',
      aspectRatio: '16:9',
      outputCount: 1,
      projectId: targetProjectId,
      imageModel: 'GEM_PIX_2',
      referenceMediaIds: refMediaIds || [],
    })
    return { success: true, projectId: targetProjectId, images }
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) }
  }
})

handleRendererIpc('debug:test-fsm-image', async (_event, prompt: string, projectId: string) => {
  try {
    const sessionMgr = GoogleVeoSessionManager.getInstance();
    const resolvedProjectId =
      projectId?.trim() ||
      getAiStudioStore().store?.flowEngine?.projectId?.trim() ||
      sessionMgr.getCurrentProjectId() ||
      undefined;
    const result = await sessionMgr.generateImageViaBrowserContext(
      {
        prompt: prompt || 'a futuristic floating city at sunset, highly detailed',
        aspectRatio: '16:9',
        outputCount: 1,
        projectId: resolvedProjectId,
        imageEngine: 'nano-banana',
      },
      (pct: number, msg?: string) => console.log(`[FSM Progress ${pct}%] ${msg}`)
    );
    return { success: true, result };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
});

handleRendererIpc('debug:test-fsm-video', async (_event, prompt: string, projectId?: string, sourceImagePath?: string) => {
  try {
    const sessionMgr = GoogleVeoSessionManager.getInstance();
    const resolvedProjectId =
      projectId?.trim() ||
      getAiStudioStore().store?.flowEngine?.projectId?.trim() ||
      sessionMgr.getCurrentProjectId() ||
      undefined;
    const result = await sessionMgr.generateVideoViaBrowserContext(
      {
        prompt: prompt || 'a calm ocean at sunset, cinematic camera pan',
        initFrameUrl: sourceImagePath,
        aspectRatio: '16:9',
        durationSeconds: 4,
        projectId: resolvedProjectId,
      },
      (pct: number, msg?: string) => console.log(`[FSM Video Progress ${pct}%] ${msg}`)
    );
    return { success: true, result };
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
});

handleRendererIpc('debug:test-gen-video', async (_event, prompt: string, projectId?: string, sourceImagePath?: string) => {
  try {
    const { getFlowRpcClient } = await import('./workflow/flow-engine/rpc');
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    const { pollAndGetMediaUrl } = await import('./workflow/flow-engine/rpc/FlowOperationPoller');
    const bridge = getFlowBridgeServer();
    const win = GoogleVeoSessionManager.getInstance().getLobbyWindow();

    if (!bridge.isConnected() && (!win || win.isDestroyed())) {
      return {
        success: false,
        error: 'Chưa có kết nối nào khả dụng: Vui lòng mở Chrome Extension (VanhSub Flow Bridge) HOẶC gọi window.vanhsub.veo.openLobby() trước.',
      };
    }

    let targetProjectId = projectId;
    if (bridge.isConnected()) {
      const tabInfo = await bridge.getFlowTabInfo();
      if (!targetProjectId && tabInfo?.projectId) {
        targetProjectId = tabInfo.projectId;
        console.log(`[debug:test-gen-video] 🎯 Tự động phát hiện Project ID từ tab Chrome: ${targetProjectId}`);
      }
    }

    if (!targetProjectId) {
      return {
        success: false,
        error: 'Chưa có Project ID hợp lệ! Trên tab Google Chrome, vui lòng bấm vào 1 Dự án (Project) bất kỳ hoặc bấm "+ New project" để vào project page trước khi tạo video.',
      };
    }

    if (bridge.isConnected()) {
      console.log(`[debug:test-gen-video] 🌐 Chrome Extension Bridge đã kết nối! Project ID: ${targetProjectId}`);
    } else if (win && !win.isDestroyed()) {
      const currentUrl = win.webContents?.getURL?.() || '';
      console.log(`[debug:test-gen-video] 🌐 lobbyWindow URL hiện tại: "${currentUrl}"`);
      try {
        if (win.isMinimized()) win.restore();
        win.focus();
      } catch {}
    }

    const client = getFlowRpcClient();

    let opStatus: any;

    if (sourceImagePath === 'text' || sourceImagePath === 't2v') {
      console.log(`[debug:test-gen-video] 🚀 Calling Text-to-Video RPC YhhmEf (projectId=${targetProjectId})...`);
      opStatus = await client.generateVideoText(win || null, {
        prompt: prompt || 'a drone shot over ocean waves, 8k cinematic',
        aspectRatio: '16:9',
        durationSeconds: 8,
        videoModel: 'veo_3_1_t2v_lite',
        projectId: targetProjectId,
      });
    } else {
      let imageMediaId = '';
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isPlaceholder = sourceImagePath === '4fc09da7-3a00-4e60-989c-a509a37c7fe5';

      if (sourceImagePath && UUID_RE.test(sourceImagePath.trim()) && !isPlaceholder) {
        imageMediaId = sourceImagePath.trim();
        console.log(`[debug:test-gen-video] 🎯 Sử dụng trực tiếp mediaId UUID đã có: ${imageMediaId}`);
      } else if (sourceImagePath && !isPlaceholder) {
        console.log(`[debug:test-gen-video] 📤 Uploading source image for I2V: ${sourceImagePath}`);
        const uploadRes = await client.uploadReferenceImage(win || null, sourceImagePath, targetProjectId);
        imageMediaId = uploadRes.mediaId;
      } else {
        // Tự động dùng logo.png có sẵn nếu người dùng không truyền ảnh hoặc truyền placeholder
        let defaultImg = path.join(app.getAppPath(), 'app', 'images', 'logo.png');
        if (!fs.existsSync(defaultImg)) {
          defaultImg = path.join(process.cwd(), 'app', 'images', 'logo.png');
        }
        if (fs.existsSync(defaultImg)) {
          console.log(`[debug:test-gen-video] 📤 Tự động upload ảnh mặc định cho I2V: ${defaultImg}`);
          const uploadRes = await client.uploadReferenceImage(win || null, defaultImg, targetProjectId);
          imageMediaId = uploadRes.mediaId;
        }
      }

      if (!imageMediaId) {
        return { success: false, error: 'Không tìm thấy hoặc không upload được source image cho Video RPC' };
      }

      console.log(`[debug:test-gen-video] 🚀 Calling Image-to-Video RPC MZZa6b (imageMediaId=${imageMediaId}, projectId=${targetProjectId})...`);
      opStatus = await client.generateVideo(win || null, {
        imageMediaId,
        prompt: prompt || 'cho cô gái di chuyển, cinematic camera push in',
        aspectRatio: '16:9',
        durationSeconds: 8,
        videoModel: 'veo_3_1_r2v_lite',
        projectId: targetProjectId,
      });
    }

    console.log(`[debug:test-gen-video] ⏳ Operation started: ${opStatus?.operationId || 'none'}. Polling status...`);
    if (!opStatus || !opStatus.operationId) {
      return { success: false, error: 'Không nhận được operationId từ Video RPC response', opStatus };
    }

    // Nếu __TRIGGER_GEN__ đã trả về kết quả hoàn chỉnh (done=true + videoUrl), không cần poll
    if (opStatus.done && opStatus.videoUrl) {
      console.log(`[debug:test-gen-video] ✅ Video đã hoàn thành ngay (UI gen), videoUrl: ${opStatus.videoUrl.slice(0, 80)}`);
      return { success: true, projectId: targetProjectId, opStatus, pollRes: { videoUrl: opStatus.videoUrl, mediaId: opStatus.mediaId } };
    }

    const pollRes = await pollAndGetMediaUrl(
      opStatus.operationId,
      targetProjectId,
      undefined,
      (pct, msg) => console.log(`[debug:test-gen-video] [${pct}%] ${msg}`)
    );

    return { success: true, projectId: targetProjectId, opStatus, pollRes };
  } catch (e: any) {
    let detail: any = undefined;
    try {
      const match = (e?.message || '').match(/failed:\s*(\{.*\})/);
      if (match) {
        detail = JSON.parse(match[1]);
      }
    } catch {}
    return { success: false, error: e?.message ?? String(e), detail };
  }
});

/**
 * debug:diagnose-lobby — Kiểm tra toàn bộ trạng thái của lobbyWindow.
 * Chạy trong DevTools: await window.electron.ipcRenderer.invoke('debug:diagnose-lobby')
 */
handleRendererIpc('debug:diagnose-lobby', async () => {
  try {
    const win = GoogleVeoSessionManager.getInstance().getLobbyWindow();
    if (!win || win.isDestroyed()) {
      return { ok: false, error: 'lobbyWindow chưa mở. Gọi openLobby() trước.' };
    }

    const { session } = require('electron');
    const ses = session.fromPartition('persist:google_veo');

    // 1. Cookie check
    const flowCookies = await ses.cookies.get({ domain: 'flow.google.com' });
    const googleCookies = await ses.cookies.get({ domain: '.google.com' });
    const hasSID = googleCookies.some((c: Electron.Cookie) => c.name === 'SID') || flowCookies.some((c: Electron.Cookie) => c.name === 'SID');
    const hasSecure1PSID = googleCookies.some((c: Electron.Cookie) => c.name === '__Secure-1PSID') || flowCookies.some((c: Electron.Cookie) => c.name === '__Secure-1PSID');
    const hasSAPS = googleCookies.some((c: Electron.Cookie) => c.name === 'SAPS') || flowCookies.some((c: Electron.Cookie) => c.name === 'SAPS');

    // 2. Page state check via executeJavaScript
    const pageState = await win.webContents.executeJavaScript(`
      (function() {
        const wiz = window.WIZ_global_data || {};
        return {
          url: window.location.href,
          hasSNlM0e: !!(wiz['SNlM0e']),
          SNlM0ePrefix: wiz['SNlM0e'] ? String(wiz['SNlM0e']).slice(0, 20) : null,
          hasXZbWve: !!(wiz['xZbWve']),
          xZbWve: wiz['xZbWve'] || null,
          hasFdrFJe: !!(wiz['FdrFJe']),
          FdrFJe: wiz['FdrFJe'] || null,
          cfb2h: wiz['cfb2h'] || null,
          hasGrecaptcha: !!(window.grecaptcha),
          hasGrecaptchaEnterprise: !!(window.grecaptcha && window.grecaptcha.enterprise),
          wizKeys: Object.keys(wiz).slice(0, 20),
          cookieCount: document.cookie ? document.cookie.split(';').length : 0,
          readyState: document.readyState,
        };
      })()
    `);

    // 3. Quick CAPTCHA mint test (nếu grecaptcha available)
    let captchaTestResult: any = null;
    if (pageState.hasGrecaptchaEnterprise && pageState.xZbWve) {
      try {
        captchaTestResult = await win.webContents.executeJavaScript(`
          window.grecaptcha.enterprise.execute(${JSON.stringify(pageState.xZbWve)}, { action: 'IMAGE_GENERATION' })
            .then(t => ({ ok: true, length: t.length, prefix: t.slice(0, 20) }))
            .catch(e => ({ ok: false, error: e.message }))
        `);
      } catch (e: any) {
        captchaTestResult = { ok: false, error: e.message };
      }
    }

    return {
      ok: true,
      lobbyWindowUrl: win.webContents.getURL(),
      isMinimized: win.isMinimized(),
      isFocused: win.isFocused(),
      // Cookie status
      cookies: {
        flowCookieCount: flowCookies.length,
        googleCookieCount: googleCookies.length,
        hasSID,
        hasSecure1PSID,
        hasSAPS,
        isLikelyLoggedIn: hasSID || hasSecure1PSID,
      },
      // Page state
      page: pageState,
      // CAPTCHA test
      captchaTest: captchaTestResult,
      // Auth summary
      authSummary: {
        '1_hasCookies': hasSID || hasSecure1PSID,
        '2_hasXSRFToken': pageState.hasSNlM0e,
        '3_hasCAPTCHAReady': pageState.hasGrecaptchaEnterprise,
        '4_captchaWorks': captchaTestResult?.ok ?? null,
        '🔑_conclusion': (hasSID || hasSecure1PSID) && pageState.hasSNlM0e && (captchaTestResult?.ok ?? false)
          ? '✅ TẤT CẢ SẴN SÀNG — Video RPC sẽ hoạt động'
          : '❌ Còn vấn đề — xem từng field ở trên để debug',
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
});


/**
 * debug:prewarm-lobby — Điều hướng lobbyWindow vào project page và chờ grecaptcha load.
 * Gọi cái này TRƯỚC testGenVideo để reCAPTCHA có thời gian thu thập behavioral signals.
 *
 * Chạy trong DevTools:
 *   await window.debug.prewarmLobby('5d3caf29-6c9d-49d8-a452-91036ea16a7d')
 */
handleRendererIpc('debug:prewarm-lobby', async (_event, projectId: string) => {
  try {
    const win = GoogleVeoSessionManager.getInstance().getLobbyWindow();
    if (!win || win.isDestroyed()) {
      return { ok: false, error: 'lobbyWindow chưa mở. Gọi openLobby() trước.' };
    }

    // Show window thật sự để reCAPTCHA score cao hơn
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch {}

    const targetUrl = `https://flow.google.com/project/${projectId}`;
    const currentUrl = win.webContents.getURL();

    if (!currentUrl.includes(projectId)) {
      console.log(`[debug:prewarm-lobby] 🔄 Điều hướng từ "${currentUrl}" → "${targetUrl}"`);
      const { getFlowRpcClient } = await import('./workflow/flow-engine/rpc');
      getFlowRpcClient().invalidateAtTokenCache();
      await win.loadURL(targetUrl);
    } else {
      console.log(`[debug:prewarm-lobby] ✅ Đã ở project page: ${currentUrl}`);
    }

    // Poll chờ grecaptcha.enterprise
    const captchaReady = await win.webContents.executeJavaScript(`
      new Promise(function(resolve) {
        var elapsed = 0;
        var interval = setInterval(function() {
          elapsed += 500;
          if (window.grecaptcha && window.grecaptcha.enterprise) {
            clearInterval(interval);
            resolve({ ready: true, elapsed: elapsed, url: window.location.href,
              hasSNlM0e: !!(window.WIZ_global_data && window.WIZ_global_data['SNlM0e']) });
          } else if (elapsed >= 30000) {
            clearInterval(interval);
            resolve({ ready: false, elapsed: elapsed, url: window.location.href });
          }
        }, 500);
      })
    `);

    console.log('[debug:prewarm-lobby] 📍 grecaptcha status:', captchaReady);

    return {
      ok: captchaReady?.ready ?? false,
      captchaReady,
      message: captchaReady?.ready
        ? `✅ Window đã ở project page và grecaptcha.enterprise sẵn sàng sau ${captchaReady.elapsed}ms.\n` +
          `🖱️ Di chuột qua cửa sổ Flow (${captchaReady.url}) trong 2-3 giây để tăng CAPTCHA score.\n` +
          `Sau đó gọi: window.debug.testGenVideo(...)`
        : `❌ grecaptcha không load được sau 30s. URL: ${captchaReady?.url}`,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
});

handleRendererIpc('bridge:status', async (_event, options?: { dumpSniffer?: boolean }) => {
  try {
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    const bridge = getFlowBridgeServer();
    const serverStatus = bridge.getStatus();
    const tabInfo = await bridge.getFlowTabInfo();

    if (options?.dumpSniffer && tabInfo?.diag?.snifferHistory) {
      try {
        fs.writeFileSync(
          path.join(process.cwd(), 'sniffer_dump.json'),
          JSON.stringify(tabInfo.diag.snifferHistory, null, 2),
          'utf-8'
        );
        console.log(`[FlowBridgeServer] 💾 Đã lưu ${tabInfo.diag.snifferHistory.length} gói tin vào sniffer_dump.json`);
      } catch (err: any) {
        console.warn('[FlowBridgeServer] Lỗi ghi file sniffer_dump.json:', err.message);
      }
    }

    return { ...serverStatus, chromeTab: tabInfo };
  } catch (e: any) {
    return { running: false, connected: false, error: e?.message };
  }
});

handleRendererIpc('bridge:reload', async () => {
  try {
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    return await getFlowBridgeServer().reloadExtension();
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
});

handleRendererIpc('bridge:reload-tab', async () => {
  try {
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    return await getFlowBridgeServer().reloadTab();
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
});

handleRendererIpc('bridge:eval', async (_event, code: string) => {
  try {
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    return await getFlowBridgeServer().tabEval(code);
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
});

handleRendererIpc('bridge:inspect-dom', async () => {
  try {
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    return await getFlowBridgeServer().inspectDom();
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
});

/** @deprecated DOM Native UI Trigger đã bị loại bỏ hoàn toàn, ưu tiên Pure RPC qua sendBatchRpc */
handleRendererIpc('bridge:trigger-ui-gen', async (_event, prompt: string) => {
  try {
    const { getFlowBridgeServer } = await import('./workflow/flow-engine/rpc/FlowBridgeServer');
    return await getFlowBridgeServer().triggerUiGen(prompt);
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
});

handleRendererIpc('bridge:open-chrome', async (_event, url = 'https://flow.google.com/') => {
  const { shell } = require('electron');
  const { spawn } = require('child_process');
  try {
    const safeUrl = validateFlowBrowserUrl(url);
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    const foundPath = chromePaths.find((p) => p && fs.existsSync(p));
    if (foundPath) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(foundPath, [safeUrl], { windowsHide: true, detached: true, stdio: 'ignore', shell: false });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      return { ok: true, launchedPath: foundPath };
    }
    await shell.openExternal(safeUrl);
    return { ok: true, fallback: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

handleRendererIpc('bridge:open-extension-folder', async () => {
  const { shell } = require('electron');
  try {
    const extDir = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.resolve(process.cwd(), 'extension');
    if (fs.existsSync(extDir)) {
      await shell.openPath(extDir);
      return { ok: true, path: extDir };
    }
    return { ok: false, error: `Thư mục extension không tồn tại: ${extDir}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

handleRendererIpc('bridge:open-chrome-extensions-page', async () => {
  const { exec } = require('child_process');
  try {
    exec('start chrome chrome://extensions/');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// ── [END DEBUG] ──────────────────────────────────────────────────────────────

ipcMain.on('message', async (event, arg) => {
  if (!isTrustedRendererEvent(event)) return;
  event.reply('message', `${arg} World!`)
})
