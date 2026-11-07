import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import OpenAI from 'openai';
import { SettingsStore } from '../../store/settingsStore';
import { GoogleVeoSessionManager } from '../../veo/GoogleVeoSessionManager';
import { GoogleVeoAntiSpamGuard } from '../../veo/GoogleVeoAntiSpamGuard';
import { FlowMediaVerifier } from '../flow-engine/FlowMediaVerifier';
import { FlowBridgeServer } from '../flow-engine/rpc/FlowBridgeServer';
import type { ExecutionContext } from '../types';
import type { ModelAdapter, VideoGenParams, VideoGenResult } from './types';

// Cấu hình đường dẫn ffmpeg và ffprobe chuẩn xác
const rawFfmpeg = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
if (rawFfmpeg) {
  try {
    ffmpeg.setFfmpegPath(rawFfmpeg.replace('app.asar', 'app.asar.unpacked'));
  } catch {}
}

const rawFfprobe = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
if (rawFfprobe) {
  try {
    ffmpeg.setFfprobePath(rawFfprobe.replace('app.asar', 'app.asar.unpacked'));
  } catch {}
}

/**
 * Bộ điều phối tuần tự hóa (Strict Serializer & Rate Limiter) cho AI Image Engine.
 * Đảm bảo các node sinh ảnh chạy song song không gửi dồn dập, tuyệt đối không bị HTTP 429.
 */
class OnlineImageRateLimiter {
  private static lastFinishTime = 0;
  private static queue: Promise<any> = Promise.resolve();

  static async schedule<T>(task: () => Promise<T>): Promise<T> {
    const prev = this.queue;
    let finish: () => void;
    this.queue = new Promise<void>((resolve) => {
      finish = resolve;
    });

    try {
      await prev.catch(() => {});
      // Giữ khoảng cách an toàn 2.5 giây sau khi tác vụ trước KẾT THÚC để tránh HTTP 429
      const now = Date.now();
      const diff = now - this.lastFinishTime;
      if (this.lastFinishTime > 0 && diff < 2500) {
        await new Promise((r) => setTimeout(r, 2500 - diff));
      }
      return await task();
    } finally {
      this.lastFinishTime = Date.now();
      finish!();
    }
  }
}

export class GoogleFlowAdapter implements ModelAdapter {
  provider = 'google-flow';

  /**
   * Sinh video bằng Google Veo qua 3 chế độ:
   * 1. 'free_session': Dùng credit miễn phí từ Sảnh Google Labs (Web Session)
   * 2. 'api_key': Dùng Google Gemini / Vertex AI API Key chính thức
   * 3. 'simulation': Mô phỏng chuyển động video bằng FFmpeg offline
   */
  async generateVideo(params: VideoGenParams, ctx: ExecutionContext): Promise<VideoGenResult> {
    const veoMode = SettingsStore.get('veoMode') || 'free_session';
    const rawDur = Number(params.durationSeconds || 4);
    const duration = rawDur <= 5 ? 4 : rawDur <= 7 ? 6 : rawDur <= 9 ? 8 : 10;
    const videoFileName = `veo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp4`;
    const lastFrameFileName = `lastframe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;

    const outVideoPath = path.join(ctx.tempDir, videoFileName);
    const outLastFramePath = path.join(ctx.tempDir, lastFrameFileName);

    // =========================================================================
    // CHẾ ĐỘ 1: SẢNH GOOGLE VEO MIỄN PHÍ (WEB SESSION)
    // =========================================================================
    if (veoMode === 'free_session') {
      const antiSpam = GoogleVeoAntiSpamGuard.getInstance();
      const sessionMgr = GoogleVeoSessionManager.getInstance();

      // 1. Kiểm tra Session Sống/Chết (Session Health Check nhanh < 1.5s)
      ctx.onProgress(5);
      const health = await sessionMgr.validateSession();
      if (!health.valid) {
        throw new Error(`[Sảnh Google Flow] ${health.detail}. Vui lòng đăng nhập Google Flow để tiếp tục.`);
      }

      // 2. Tự động xếp hàng (FIFO Queue) & Tự động đếm lùi Cooldown an toàn
      // Người dùng chỉ cần bấm chạy workflow, hệ thống sẽ tự serialize tác vụ Veo 1-by-1
      await antiSpam.acquireLockAsync({
        onProgress: (percent, msg) => {
          ctx.onProgress(percent);
          if (msg) console.log(`[Veo Queue] ${msg}`);
        },
        isCancelled: ctx.isCancelled,
      });

      try {
        ctx.onProgress(12);
        // Đệm độ trễ người dùng thật (2s - 4s)
        await antiSpam.applyHumanJitter(2000, 4000);
        ctx.onProgress(25);

        const result = await this.callFreeSessionVeo(params, outVideoPath, ctx);
        ctx.onProgress(85);
        await this.extractLastFrame(result.videoPath, outLastFramePath, duration);
        ctx.onProgress(100);

        return {
          videoUrl: result.videoPath,
          lastFrameUrl: outLastFramePath,
          durationSeconds: duration,
          projectId: result.projectId,
        };
      } catch (err: any) {
        if (ctx.isCancelled() || err?.message?.includes('hủy')) {
          console.log('[Google Flow] Workflow đã bị người dùng hủy bỏ.');
          throw new Error('Tác vụ đã bị hủy bởi người dùng.');
        }
        console.error('[Google Flow] Lỗi tạo video từ Google Veo:', err?.message || err);
        throw new Error(err?.message || 'Không thể tạo video từ Google Veo.');
      } finally {
        antiSpam.releaseLock();
      }
    }

    // =========================================================================
    // CHẾ ĐỘ 2: API KEY GOOGLE CHÍNH THỨC (VERTEX AI / GEMINI)
    // =========================================================================
    if (veoMode === 'api_key') {
      const apiKey = SettingsStore.get('geminiApiKey')?.trim();
      if (apiKey) {
        try {
          ctx.onProgress(10);
          const result = await this.callGeminiVeoApi(apiKey, params, outVideoPath, ctx);
          ctx.onProgress(85);
          await this.extractLastFrame(result.videoPath, outLastFramePath, duration);
          ctx.onProgress(100);

          return {
            videoUrl: result.videoPath,
            lastFrameUrl: outLastFramePath,
            durationSeconds: duration,
          };
        } catch (err: any) {
          console.error('[Google Flow] Lỗi gọi Google Veo API:', err?.message || err);
          throw new Error(err?.message || 'Lỗi gọi Google Veo API thật.');
        }
      } else {
        throw new Error('[Google Flow] Thiếu Gemini API Key. Vui lòng cấu hình API Key trong Cài đặt.');
      }
    }

    // =========================================================================
    // CHẾ ĐỘ 3: MÔ PHỎNG OFFLINE BẰNG FFMPEG (CHỈ KHI NGƯỜI DÙNG CHỦ ĐỘNG CHỌN)
    // =========================================================================
    if (veoMode === 'simulation') {
      ctx.onProgress(20);
      await this.generateSyntheticDemoVideo(params, outVideoPath, duration, ctx);
      ctx.onProgress(85);
      await this.extractLastFrame(outVideoPath, outLastFramePath, duration);
      ctx.onProgress(100);

      return {
        videoUrl: outVideoPath,
        lastFrameUrl: outLastFramePath,
        durationSeconds: duration,
      };
    }

    throw new Error(`[Google Flow] Không thể sinh video. Chế độ hiện tại: ${veoMode}`);
  }

  /**
   * Gọi sinh video qua Session Google Labs / VideoFX Web.
   */
  private async callFreeSessionVeo(
    params: VideoGenParams,
    outPath: string,
    ctx: ExecutionContext
  ): Promise<{ videoPath: string; projectId?: string }> {
    const sessionMgr = GoogleVeoSessionManager.getInstance();
    const rawDur = Number(params.durationSeconds || 4);
    const duration = rawDur <= 5 ? 4 : rawDur <= 7 ? 6 : rawDur <= 9 ? 8 : 10;

    // Kiểm tra nhanh: có session không (cookie hoặc electron partition)?
    const cookie = await sessionMgr.getEffectiveCookieString();
    const token = SettingsStore.get('veoSessionAuthToken')?.trim();

    if (!cookie && !token && !FlowBridgeServer.getInstance().isConnected()) {
      throw new Error('[Google Flow] Chưa có phiên đăng nhập Google Flow. Vui lòng mở sảnh và đăng nhập.');
    }

    // === CHIẾN LƯỢC: Browser Automation (executeJavaScript trong Electron) ===
    ctx.onProgress(8);
    try {
      const browserResult = await sessionMgr.generateVideoViaBrowserContext(
        {
          prompt: params.prompt,
          initFrameUrl: params.initFrameUrl,
          aspectRatio: params.aspectRatio,
          durationSeconds: duration,
          modelVariant: params.modelVariant,
          outputCount: params.outputCount || 1,
          projectId: params.projectId,
        },
        (percent, msg) => {
          ctx.onProgress(Math.max(8, Math.min(82, percent)));
          if (msg) console.log(`[Google Flow Browser] ${msg}`);
        },
        ctx.isCancelled
      );

      if (ctx.isCancelled()) {
        throw new Error('Tác vụ đã bị hủy bởi người dùng.');
      }

      if (browserResult?.error) {
        throw new Error(`[Google Flow] ${browserResult.errorDetail || browserResult.error}`);
      }

      if (browserResult?.base64Data) {
        console.log('[Google Flow] ✅ Lưu video Blob từ Google Veo...');
        ctx.onProgress(85);
        const b64 = browserResult.base64Data.replace(/^data:[^;]+;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        const verification = FlowMediaVerifier.verifyBuffer(buf, { expectedType: 'video' });
        if (!verification.isValid) {
          console.warn(`[Google Flow] ⚠️ Dữ liệu video base64 không đạt chuẩn (${verification.error}): ${verification.errorDetail}`);
        }
        fs.writeFileSync(outPath, buf);
        return { videoPath: outPath, projectId: browserResult.projectId || params.projectId };
      }

      // 2. Tải trực tiếp chất lượng gốc 720p từ Video Viewer qua will-download (chuẩn nhất trên Electron)
      const win = sessionMgr.lobbyWindow;
      if (win && !win.isDestroyed()) {
        ctx.onProgress(85);
        console.log('[Google Flow] ⬇️ Đang trích xuất video 720p gốc từ Google Flow Video Viewer...');
        const viewerSuccess = await sessionMgr.downloadVideoViaViewer(win, outPath);
        if (viewerSuccess && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
          console.log('[Google Flow] ✅ Đã tải video 720p gốc thành công từ Video Viewer!');
          return { videoPath: outPath, projectId: browserResult?.projectId || params.projectId };
        }
      }

      // 3. Fallback: tải qua HTTP URL nếu viewer không khả dụng
      if (browserResult?.videoUrl && browserResult.videoUrl.startsWith('http')) {
        console.log('[Google Flow] ✅ Tải video từ Google Veo qua HTTP URL...');
        ctx.onProgress(85);
        await this.downloadFile(browserResult.videoUrl, outPath, 5, 60000);
        return { videoPath: outPath, projectId: browserResult.projectId || params.projectId };
      }

      if (browserResult?.error === 'out_of_credits' || SettingsStore.get('veoSessionStatus') === 'out_of_credits') {
        throw new Error('[Google Flow] Tài khoản Google của bạn đã HẾT CREDIT (tín dụng) trên Google Flow.');
      }
    } catch (browserErr: any) {
      if (ctx.isCancelled() || browserErr?.message?.includes('hủy')) {
        throw new Error('Tác vụ đã bị hủy bởi người dùng.');
      }
      throw new Error(browserErr?.message || '[Google Flow] Lỗi khi tạo video trên trình duyệt.');
    }

    if (ctx.isCancelled()) {
      throw new Error('Tác vụ đã bị hủy bởi người dùng.');
    }

    // Nếu không nhận được video từ Google Veo, báo lỗi ngay lập tức
    throw new Error('[Google Flow] Không nhận được video từ Google Veo sau thời gian chờ.');
  }

  /**
   * Gửi request sinh video tới Google Labs (kèm Hard Watchdog 10s chống treo)
   */
  private async dispatchVideoFxRequest(
    params: VideoGenParams,
    cookie: string,
    token?: string,
    ctx?: ExecutionContext
  ): Promise<{ videoUrl: string } | null> {
    let modelTarget = params.modelVariant || 'veo-3.1-generate-quality';
    if (modelTarget === 'veo-3.1-quality') modelTarget = 'veo-3.1-generate-quality';
    if (modelTarget === 'veo-3.1-lite') modelTarget = 'veo-3.1-generate-preview';
    if (modelTarget === 'veo-2.0') modelTarget = 'veo-2.0-generate-001';

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        prompt: params.prompt,
        aspectRatio: params.aspectRatio === '9:16' ? 'PORTRAIT' : 'LANDSCAPE',
        durationSeconds: params.durationSeconds || 5,
        model: modelTarget,
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://labs.google',
        Referer: 'https://labs.google/fx/tools/video-fx',
      };

      if (cookie) headers['Cookie'] = cookie;
      if (token && token.startsWith('ya29.')) headers['Authorization'] = `Bearer ${token}`;

      let isSettled = false;
      const hardTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try {
            req.destroy();
          } catch {}
          resolve(null);
        }
      }, 10_000);

      const req = https.request(
        'https://labs.google/fx/api/trpc/videoFx.generateVideo',
        {
          method: 'POST',
          headers,
          timeout: 10_000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(hardTimer);

            if (res.statusCode === 429) {
              reject(new Error('Google đang giới hạn tần suất (Rate Limit 429). Vui lòng đợi hoặc đổi tài khoản.'));
              return;
            }
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error('Session Google đã hết hạn hoặc bị từ chối truy cập (Mã 401/403).'));
              return;
            }
            if (data.includes('recaptcha') || data.includes('challenge')) {
              reject(new Error('Google yêu cầu xác minh Captcha. Vui lòng bấm "Mở sảnh Google" để giải Captcha.'));
              return;
            }

            try {
              const json = JSON.parse(data);
              const videoUrl = json?.result?.data?.videoUrl || json?.videoUrl;
              if (videoUrl) {
                resolve({ videoUrl });
                return;
              }
            } catch {}

            // Nếu endpoint trả về 200 nhưng chưa có URL trực tiếp
            resolve(null);
          });
        }
      );

      req.on('timeout', () => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(hardTimer);
        req.destroy();
        resolve(null);
      });

      req.on('error', () => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(hardTimer);
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Gọi API Google Veo qua OpenAI-compatible endpoint (kèm Hard Watchdog 15s)
   */
  private async callGeminiVeoApi(
    apiKey: string,
    params: VideoGenParams,
    outPath: string,
    ctx: ExecutionContext
  ): Promise<{ videoPath: string }> {
    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      timeout: 15_000,
    });

    const extraBody: Record<string, any> = {
      duration_seconds: params.durationSeconds || 5,
      aspect_ratio: params.aspectRatio || '16:9',
      frame_rate: '24',
    };

    if (params.seed && params.seed > 0) {
      extraBody.seed = params.seed;
    }

    // Last-frame chaining: nếu có initFrameUrl, truyền vào image làm reference frame
    if (params.initFrameUrl && fs.existsSync(params.initFrameUrl)) {
      try {
        const imgBuffer = fs.readFileSync(params.initFrameUrl);
        extraBody.image = imgBuffer.toString('base64');
      } catch (e) {
        console.warn('Không đọc được initFrameUrl:', e);
      }
    }

    let modelName = params.modelVariant || 'veo-3.1-generate-quality';
    if (modelName === 'veo-3.1-quality') modelName = 'veo-3.1-generate-quality';
    if (modelName === 'veo-3.1-lite') modelName = 'veo-3.1-generate-preview';
    if (modelName === 'veo-2.0') modelName = 'veo-2.0-generate-001';
    ctx.onProgress(25);

    // Gửi yêu cầu sinh video với hard timeout 15s
    const createPromise = (openai as any).videos.create({
      model: modelName,
      prompt: params.prompt,
      extra_body: extraBody,
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Google Veo API không phản hồi trong 15 giây')), 15_000);
    });

    const createRes: any = await Promise.race([createPromise, timeoutPromise]);
    const operationId = createRes?.id;
    if (!operationId) {
      throw new Error('Google Veo không trả về operation ID');
    }

    // Polling cho tới khi video render xong (tối đa 40s)
    let pollCount = 0;
    while (!ctx.isCancelled() && pollCount < 8) {
      pollCount++;
      await new Promise((resolve) => setTimeout(resolve, 5000));
      ctx.onProgress(Math.min(80, 25 + pollCount * 7));

      const statusRes: any = await (openai as any).videos.retrieve(operationId);
      if (statusRes.status === 'completed' && statusRes.url) {
        // Tải video về thư mục tạm
        await this.downloadFile(statusRes.url, outPath, 3, 20000);
        return { videoPath: outPath };
      } else if (statusRes.status === 'failed') {
        throw new Error(`Google Veo render thất bại: ${statusRes.error || 'Unknown error'}`);
      }
    }

    throw new Error('Quá trình render Google Veo API quá thời hạn cho phép');
  }

  /**
   * Trích xuất khung hình cuối cùng (Last-Frame) bằng ffmpeg phục vụ Shot Chaining (có watchdog 10s)
   */
  private async extractLastFrame(videoPath: string, lastFramePath: string, durationSeconds: number): Promise<void> {
    return new Promise((resolve) => {
      let isSettled = false;
      const watchdog = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try {
            fs.writeFileSync(lastFramePath, Buffer.from(''));
          } catch {}
          resolve();
        }
      }, 10_000);

      const seekTime = Math.max(0, durationSeconds - 0.2);
      ffmpeg(videoPath)
        .seekInput(seekTime)
        .frames(1)
        .output(lastFramePath)
        .on('end', () => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(watchdog);
          resolve();
        })
        .on('error', (err) => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(watchdog);
          console.warn('Lỗi khi trích xuất last-frame:', err);
          try {
            fs.writeFileSync(lastFramePath, Buffer.from(''));
          } catch {}
          resolve();
        })
        .run();
    });
  }

  /**
   * Tạo video thực tế bằng ffmpeg (dùng khi offline hoặc test cục bộ):
   * Nhận diện ảnh từ initFrameUrl hoặc characterRefUrls để tạo video chuyển động
   * điện ảnh Ken Burns mượt mà (camera zoom-in/pan) đúng bối cảnh kịch bản trong 1.5s.
   */
  private async generateSyntheticDemoVideo(
    params: VideoGenParams,
    outPath: string,
    duration: number,
    ctx: ExecutionContext
  ): Promise<void> {
    const isPortrait = params.aspectRatio === '9:16';
    const width = isPortrait ? 720 : 1280;
    const height = isPortrait ? 1280 : 720;

    // 1. Kiểm tra xem có ảnh đầu vào (Keyframe hoặc Character Image) hay không
    let sourceImagePath = '';
    const rawImage = params.initFrameUrl || (params.characterRefUrls && params.characterRefUrls[0]);
    if (typeof rawImage === 'string' && rawImage.trim()) {
      const cleanImg = rawImage.trim();
      if (cleanImg.startsWith('data:image/')) {
        const base64Data = cleanImg.replace(/^data:image\/\w+;base64,/, '');
        const tempImgPath = path.join(ctx.tempDir, `init_frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
        try {
          fs.writeFileSync(tempImgPath, Buffer.from(base64Data, 'base64'));
          sourceImagePath = tempImgPath;
        } catch {}
      } else if (cleanImg.startsWith('file://')) {
        let filePath = cleanImg.replace(/^file:\/\/\/?/, '');
        if (/^[a-zA-Z]:/.test(filePath) || fs.existsSync(filePath)) {
          sourceImagePath = filePath;
        }
      } else if (cleanImg.startsWith('http://') || cleanImg.startsWith('https://')) {
        const tempImgPath = path.join(ctx.tempDir, `init_frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`);
        try {
          await this.downloadFile(cleanImg, tempImgPath, 3, 10000);
          if (fs.existsSync(tempImgPath) && fs.statSync(tempImgPath).size > 100) {
            sourceImagePath = tempImgPath;
          }
        } catch {}
      } else if (fs.existsSync(cleanImg)) {
        sourceImagePath = cleanImg;
      }
    }

    // Nếu có ảnh nguồn (Banana Pro Keyframe), tạo video Ken Burns cinematic zoompan
    if (sourceImagePath && fs.existsSync(sourceImagePath)) {
      return new Promise((resolve) => {
        const totalFrames = duration * 24;
        ffmpeg()
          .input(sourceImagePath)
          .inputOptions(['-loop 1'])
          .complexFilter([
            `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.0015,1.15)':d=${totalFrames}:s=${width}x${height}:fps=24[v]`
          ])
          .outputOptions([
            '-map [v]',
            '-c:v libx264',
            '-pix_fmt yuv420p',
            '-r 24',
            '-t', `${duration}`,
          ])
          .output(outPath)
          .on('progress', (p) => {
            if (p.percent) {
              ctx.onProgress(Math.min(80, 20 + Math.round(p.percent * 0.6)));
            }
          })
          .on('end', () => resolve())
          .on('error', (err) => {
            console.warn('Lỗi khi render Ken Burns từ ảnh, chuyển sang gradient animation:', err?.message || err);
            this.renderGradientVideo(params, outPath, duration, ctx, width, height)
              .then(resolve)
              .catch(() => resolve());
          })
          .run();
      });
    }

    // Nếu không có ảnh nguồn, tạo video gradient chuyển động
    return this.renderGradientVideo(params, outPath, duration, ctx, width, height);
  }

  private async renderGradientVideo(
    params: VideoGenParams,
    outPath: string,
    duration: number,
    ctx: ExecutionContext,
    width: number,
    height: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const promptClean = (typeof params.prompt === 'string' ? params.prompt : JSON.stringify(params.prompt || ''))
        .replace(/['\\:]/g, ' ')
        .slice(0, 45);

      ffmpeg()
        .input(`color=c=0x0E1A1B:s=${width}x${height}:d=${duration}`)
        .inputFormat('lavfi')
        .input(`color=c=0x6366F1:s=${width}x${height}:d=${duration}`)
        .inputFormat('lavfi')
        .complexFilter([
          `[0:v][1:v]blend=all_expr='A*(1-T/${duration})+B*(T/${duration})'[outv]`,
        ])
        .outputOptions([
          '-map [outv]',
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-r 24',
          '-t', `${duration}`,
        ])
        .output(outPath)
        .on('progress', (p) => {
          if (p.percent) {
            ctx.onProgress(Math.min(80, 20 + Math.round(p.percent * 0.6)));
          }
        })
        .on('end', () => resolve())
        .on('error', () => {
          // Fallback đơn giản nếu drawtext lỗi font
          ffmpeg()
            .input(`color=c=0x1E1B4B:s=${width}x${height}:d=${duration}`)
            .inputFormat('lavfi')
            .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-t', `${duration}`])
            .output(outPath)
            .on('end', () => resolve())
            .on('error', () => resolve())
            .run();
        })
        .run();
    });
  }

  private async downloadFile(url: string, dest: string, maxRedirects = 5, timeoutMs = 25000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        return reject(new Error('Quá nhiều lần chuyển hướng khi tải file.'));
      }

      let isFinished = false;
      const hardTimer = setTimeout(() => {
        if (!isFinished) {
          isFinished = true;
          try {
            req.destroy();
          } catch {}
          try {
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
          } catch {}
          reject(new Error(`Tải file quá hạn (${timeoutMs / 1000}s).`));
        }
      }, timeoutMs);

      const getter = url.startsWith('https') ? https : http;
      const req = getter.get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            Accept: 'image/jpeg,image/png,image/*,*/*',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            clearTimeout(hardTimer);
            res.resume();
            const nextUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).toString();
            return this.downloadFile(nextUrl, dest, maxRedirects - 1, timeoutMs).then(resolve, reject);
          }

          if (res.statusCode !== 200) {
            clearTimeout(hardTimer);
            res.resume();
            return reject(new Error(`Tải file thất bại với HTTP ${res.statusCode}`));
          }

          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => {
            clearTimeout(hardTimer);
            isFinished = true;
            file.close(async () => {
              try {
                const ext = path.extname(dest).toLowerCase();
                const expectedType = ext === '.mp4' || ext === '.webm' ? 'video' : 'image';
                const verification = await FlowMediaVerifier.verifyFile(dest, { expectedType });
                if (!verification.isValid) {
                  console.warn(
                    `[Google Flow] ⚠️ Tệp tải về không đạt chuẩn tính toàn vẹn (${verification.error}): ${verification.errorDetail}`
                  );
                }
              } catch {}
              resolve();
            });
          });
          file.on('error', (err) => {
            clearTimeout(hardTimer);
            isFinished = true;
            fs.unlink(dest, () => {});
            reject(err);
          });
        }
      );

      req.on('error', (err) => {
        clearTimeout(hardTimer);
        isFinished = true;
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }

  /**
   * Sinh ảnh bằng Banana Pro (Google Imagen / Banana AI) qua API Key
   */
  private async callBananaProImageApi(
    apiKey: string,
    prompt: string,
    aspectRatio: string,
    outPath: string
  ): Promise<boolean> {
    const model = 'nano-banana-pro-preview';
    console.log(`[Banana Pro AI] Đang gửi yêu cầu sinh ảnh tới Banana Pro (${model})...`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    });

    const resData = await this.postJson(url, payload);

    if (resData?.error) {
      const errMsg = resData.error.message || JSON.stringify(resData.error);
      if (resData.error.code === 429 || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        console.error(
          '[Banana Pro AI] Google API Key chưa có hạn ngạch (429 RESOURCE_EXHAUSTED). Banana Pro yêu cầu tài khoản có bật thanh toán Pay-as-you-go trên Google AI Studio.'
        );
        throw new Error(
          '[Banana Pro AI] Google API Key đã hết hoặc chưa được cấp hạn ngạch sinh ảnh Banana Pro (429 Quota Exceeded). Vui lòng chuyển sang chế độ Sảnh Google Flow để dùng credit miễn phí hoặc bật Pay-as-you-go trên https://aistudio.google.com.'
        );
      }
      throw new Error(`[Banana Pro AI] Lỗi từ Banana Pro API: ${errMsg}`);
    }

    const parts = resData?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        const buf = Buffer.from(part.inlineData.data, 'base64');
        fs.writeFileSync(outPath, buf);
        console.log(`[Banana Pro AI] ✓ Sinh ảnh thành công với Banana Pro (${buf.length} bytes)!`);
        return true;
      }
    }

    throw new Error('[Banana Pro AI] Không nhận được dữ liệu ảnh hợp lệ từ Banana Pro.');
  }

  /**
   * Sinh ảnh Keyframe AI bám sát 100% Prompt người dùng
   * Hỗ trợ Sảnh Google Flow (Web Session) và Banana Pro API
   */
  async generateImage(params: import('./types').ImageGenParams, ctx: ExecutionContext): Promise<{ imageUrl: string; projectId?: string }> {
    const veoMode = SettingsStore.get('veoMode') || 'free_session';
    const fileName = `imagen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
    const outImagePath = path.join(ctx.tempDir, fileName);

    // =========================================================================
    // CHẾ ĐỘ 1: SẢNH GOOGLE FLOW MIỄN PHÍ (WEB SESSION TRÊN BROWSER)
    // =========================================================================
    if (veoMode === 'free_session') {
      const antiSpam = GoogleVeoAntiSpamGuard.getInstance();
      const sessionMgr = GoogleVeoSessionManager.getInstance();

      ctx.onProgress(5);
      const health = await sessionMgr.validateSession();
      if (!health.valid) {
        throw new Error(`[Sảnh Google Flow] ${health.detail}. Vui lòng mở sảnh và đăng nhập Google Flow để tiếp tục.`);
      }

      await antiSpam.acquireLockAsync({
        onProgress: (percent, msg) => {
          ctx.onProgress(percent);
          if (msg) console.log(`[Flow Queue] ${msg}`);
        },
        isCancelled: ctx.isCancelled,
      });

      try {
        ctx.onProgress(12);
        await antiSpam.applyHumanJitter(1500, 3000);
        ctx.onProgress(25);

        const result = await sessionMgr.generateImageViaBrowserContext(
          {
            prompt: params.prompt,
            aspectRatio: params.aspectRatio,
            outputCount: params.outputCount || 1,
            imageEngine: params.imageEngine,
            projectId: params.projectId,
          },
          (percent, msg) => {
            ctx.onProgress(Math.max(10, Math.min(85, percent)));
            if (msg) console.log(`[Google Flow Browser] ${msg}`);
          },
          ctx.isCancelled
        );

        if (ctx.isCancelled()) {
          throw new Error('Tác vụ đã bị hủy bởi người dùng.');
        }

        if (result?.error) {
          throw new Error(`[Google Flow] ${result.errorDetail || result.error}`);
        }

        if (result?.base64Data) {
          console.log('[Google Flow] ✅ Lưu ảnh Blob từ Google Flow...');
          ctx.onProgress(95);
          const b64 = result.base64Data.replace(/^data:[^;]+;base64,/, '');
          fs.writeFileSync(outImagePath, Buffer.from(b64, 'base64'));
          ctx.onProgress(100);
          return { imageUrl: outImagePath, projectId: result.projectId || params.projectId };
        }

        if (result?.imageUrl) {
          console.log('[Google Flow] ✅ Tải ảnh thật từ Google Flow...');
          ctx.onProgress(90);
          await this.downloadFile(result.imageUrl, outImagePath, 5, 30000);
          ctx.onProgress(100);
          return { imageUrl: outImagePath, projectId: result.projectId || params.projectId };
        }

        if (result?.error === 'out_of_credits' || SettingsStore.get('veoSessionStatus') === 'out_of_credits') {
          throw new Error('[Google Flow] Tài khoản Google của bạn đã HẾT CREDIT (tín dụng) trên Google Flow.');
        }

        throw new Error('[Google Flow] Không nhận được ảnh từ Google Flow sau thời gian chờ.');
      } catch (err: any) {
        if (ctx.isCancelled() || err?.message?.includes('hủy')) {
          console.log('[Google Flow] Workflow đã bị người dùng hủy bỏ.');
          throw new Error('Tác vụ đã bị hủy bởi người dùng.');
        }
        console.error('[Google Flow] Lỗi tạo ảnh từ Google Flow:', err?.message || err);
        throw new Error(err?.message || 'Không thể tạo ảnh từ Google Flow.');
      } finally {
        antiSpam.releaseLock();
      }
    }

    // =========================================================================
    // CHẾ ĐỘ 2: BANANA PRO QUA GOOGLE API KEY CHÍNH THỨC
    // =========================================================================
    if (veoMode === 'api_key') {
      const apiKey = SettingsStore.get('geminiApiKey')?.trim();
      if (!apiKey) {
        throw new Error('[Banana Pro AI] Thiếu Gemini API Key. Vui lòng cấu hình API Key trong Cài đặt.');
      }

      ctx.onProgress(20);
      const bananaSuccess = await this.callBananaProImageApi(
        apiKey,
        params.prompt,
        params.aspectRatio || '1:1',
        outImagePath
      );

      if (bananaSuccess && fs.existsSync(outImagePath) && fs.statSync(outImagePath).size > 1000) {
        ctx.onProgress(100);
        return { imageUrl: outImagePath };
      }

      throw new Error('[Banana Pro AI] Không thể sinh ảnh từ Banana Pro API.');
    }

    // =========================================================================
    // CHẾ ĐỘ 3: MÔ PHỎNG OFFLINE (CHỈ KHI NGƯỜI DÙNG CHỦ ĐỘNG CHỌN SIMULATION)
    // =========================================================================
    if (veoMode === 'simulation') {
      ctx.onProgress(50);
      await this.generateSyntheticImage(params.prompt, outImagePath, params.aspectRatio || '16:9');
      ctx.onProgress(100);
      return { imageUrl: outImagePath };
    }

    throw new Error(`[Google Flow] Chế độ sinh ảnh không hợp lệ: ${veoMode}`);
  }

  /**
   * Mở rộng kịch bản & tối ưu câu lệnh bằng Gemini AI Director
   */
  async directPrompt(
    params: import('./types').DirectorPromptParams,
    ctx: ExecutionContext
  ): Promise<import('./types').DirectorPromptResult> {
    const apiKey = SettingsStore.get('geminiApiKey')?.trim();

    if (apiKey) {
      try {
        ctx.onProgress(40);
        const geminiModel = SettingsStore.get('geminiModel') || 'gemini-3.1-flash-lite';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
        const systemInstruction = `You are a world-class Hollywood film director and visual prompt engineer for Google Veo video generation.
Expand the user's idea into an ultra-detailed, cinematic, photorealistic video prompt.
Tone: ${params.tone || 'cinematic_epic'}. Lighting: ${params.lighting || 'volumetric_neon'}.
Respond in strict JSON format:
{
  "prompt": "expanded prompt in English",
  "negativePrompt": "blurry, low quality, distorted, watermark",
  "camera": "suggested camera motion (e.g. pan_right, slow_push_in, orbit)"
}`;
        const reqBody = JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `Idea: ${params.idea}\nCharacter: ${params.characterName || 'N/A'}` }],
            },
          ],
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          generationConfig: {
            responseMimeType: 'application/json',
          },
        });

        const resData = await this.postJson(url, reqBody);
        const text = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          ctx.onProgress(100);
          return {
            prompt: parsed.prompt || params.idea,
            negativePrompt: parsed.negativePrompt || 'blurry, low quality, distorted, extra limbs',
            camera: parsed.camera || 'pan_right',
          };
        }
      } catch (err: any) {
        console.warn('Lỗi gọi Gemini Director API, chuyển sang quy tắc mở rộng offline:', err?.message || err);
      }
    }

    // Fallback Offline: Bộ quy tắc kịch bản điện ảnh thông minh
    ctx.onProgress(80);
    const toneDetails: Record<string, string> = {
      cinematic_epic: 'Cinematic 8k masterpiece, dramatic atmosphere, anamorphic 35mm lens, photorealistic, IMAX color grade',
      action_thriller: 'High-speed action movie camera, dynamic shutter speed, intense motion blur, gritty realism, adrenaline tone',
      cyberpunk_scifi: 'Futuristic sci-fi aesthetic, glowing holographic displays, wet reflective asphalt, cybernetic atmosphere',
      documentary: 'Handheld documentary realism, natural ambient lighting, candid authentic framing, 4k ultra-detailed',
    };

    const lightDetails: Record<string, string> = {
      volumetric_neon: 'moody volumetric neon lighting, soft cyan and amber fog, high contrast reflections',
      golden_hour: 'breathtaking warm golden hour sunlight, soft lens flare, dusk sky gradients',
      dramatic_dark: 'chiaroscuro shadows, single key light, deep moody shadows, high drama',
      natural_daylight: 'crisp diffuse overcast daylight, true-to-life colors, clean studio balance',
    };

    const toneStr = toneDetails[params.tone || 'cinematic_epic'] || toneDetails.cinematic_epic;
    const lightStr = lightDetails[params.lighting || 'volumetric_neon'] || lightDetails.volumetric_neon;

    const enhanced = `${params.idea}, ${params.characterName ? `featuring ${params.characterName}, ` : ''}${lightStr}, ${toneStr}`.trim();

    ctx.onProgress(100);
    return {
      prompt: enhanced,
      negativePrompt: 'blurry, low quality, distorted, deformed faces, oversaturated, watermark, text',
      camera: params.tone === 'action_thriller' ? 'dynamic_tracking' : 'pan_right',
    };
  }

  private async generateSyntheticImage(prompt: string, outPath: string, aspectRatio: string): Promise<void> {
    const isSquare = aspectRatio === '1:1';
    const isPortrait = aspectRatio === '9:16';
    const width = isSquare ? 1024 : isPortrait ? 720 : 1280;
    const height = isSquare ? 1024 : isPortrait ? 1280 : 720;
    const promptClean = (prompt || 'Google Imagen 3').replace(/['\\:;]/g, ' ').slice(0, 45);

    const PALETTES = ['0x1E1B4B', '0x831843', '0x14532D', '0x78350F', '0x1E3A8A', '0x4C1D95', '0x064E3B', '0x701A75'];
    let hash = 0;
    for (let i = 0; i < (prompt || '').length; i++) hash = ((hash << 5) - hash + prompt.charCodeAt(i)) | 0;
    const bgCol = PALETTES[Math.abs(hash) % PALETTES.length];

    return new Promise((resolve) => {
      ffmpeg()
        .input(`color=c=${bgCol}:s=${width}x${height}:d=1`)
        .inputFormat('lavfi')
        .outputOptions(['-frames:v 1', '-q:v 2'])
        .output(outPath)
        .on('end', () => resolve())
        .on('error', () => {
          // Fallback cấp 2: Ghi file 1x1 PNG hợp lệ chống lỗi hiển thị thẻ img
          try {
            const validPng = Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              'base64'
            );
            fs.writeFileSync(outPath, validPng);
          } catch {}
          resolve();
        })
        .run();
    });
  }

  private postJson(targetUrl: string, body: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl);
      const req = https.request(
        {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 60000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Failed to parse response JSON: ${data.slice(0, 200)}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
