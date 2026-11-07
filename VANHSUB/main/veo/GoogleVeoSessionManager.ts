import path from 'path';
import https from 'https';
import { SettingsStore } from '../store/settingsStore';
import { GoogleVeoAntiSpamGuard } from './GoogleVeoAntiSpamGuard';
import { GoogleFlowBrowserMutex } from '../workflow/dispatcher/GoogleFlowBrowserMutex';
import {
  FlowStateMachine,
  FlowImageGenerationStatePipeline,
  FlowVideoGenerationStatePipeline,
  FlowElementFinder,
  FlowSmartWait,
  FlowClipboardGuard,
  FlowBridgeServer,
  getGoogleFlowRpcClient,
  type FlowStateContext,
} from '../workflow/flow-engine';
import type {
  VeoMode,
  VeoSessionStatus,
  VeoSessionValidationResult,
  VeoStatusPayload,
} from './types';


const GOOGLE_FLOW_LOBBY_URL = 'https://flow.google.com';
const VIDEO_FX_FALLBACK_URL = 'https://labs.google/fx/tools/video-fx';
const GOOGLE_AUTH_COOKIE_NAMES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
];

export const OFFSCREEN_X = -3000;
export const OFFSCREEN_Y = -3000;

/**
 * Chuẩn hóa tên dự án trước khi đặt cho Google Flow.
 * Loại bỏ ký tự đặc biệt không an toàn cho DOM/File, chuẩn hóa khoảng trắng, giới hạn tối đa 60 ký tự.
 */
export function sanitizeProjectName(name?: string): string {
  if (!name || typeof name !== 'string') return 'Video Project';
  let cleaned = name
    .replace(/<[^>]*>/g, '') // loại bỏ HTML tags
    .replace(/[\r\n\t]/g, ' ') // loại bỏ newline, tab
    .replace(/["\\/|?*<>:]/g, '-') // thay ký tự không hợp lệ bằng gạch ngang
    .replace(/\s+/g, ' ') // chuẩn hóa khoảng trắng
    .trim();

  if (cleaned.length > 60) {
    cleaned = cleaned.slice(0, 60).trim();
  }
  return cleaned || 'Video Project';
}

export class GoogleVeoSessionManager {
  private static instance: GoogleVeoSessionManager | null = null;
  public lobbyWindow: any = null;
  public isLobbyDebugVisible = false;
  private _webRequestListenerAttached = false;
  private currentProjectId: string | null = null;
  private lastPermissionConfirmedAt = 0;
  private isRecreatingLobby = false;
  private recentCrashTimes: number[] = [];

  private constructor() {}

  public getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  public setCurrentProjectId(id: string | null): void {
    this.currentProjectId = id;
  }

  public resetCurrentProjectId(): void {
    this.currentProjectId = null;
  }

  static getInstance(): GoogleVeoSessionManager {
    if (!this.instance) {
      this.instance = new GoogleVeoSessionManager();
    }
    return this.instance;
  }

  /**
   * Khôi phục cookie từ SettingsStore vào partition Electron nếu partition đang thiếu auth cookie
   */
  public async restoreCookiesToPartition(ses?: any): Promise<number> {
    try {
      let targetSes = ses;
      if (!targetSes) {
        const electron = require('electron');
        targetSes = electron?.session?.fromPartition('persist:google_veo');
      }
      if (!targetSes) return 0;

      const storedCookie = SettingsStore.get('veoSessionCookie')?.trim();
      if (!storedCookie) return 0;

      // Kiểm tra xem partition đã có đầy đủ auth cookies chưa
      const existing = await targetSes.cookies.get({ domain: '.google.com' });
      const hasAuth = existing.some((c: any) => GOOGLE_AUTH_COOKIE_NAMES.includes(c.name));
      if (hasAuth) {
        return existing.length;
      }

      console.log('[GoogleVeoSessionManager] 🔄 Đang nạp lại cookie từ SettingsStore vào phân vùng persist:google_veo...');
      const parts = storedCookie.split(';').map((p) => p.trim()).filter(Boolean);
      let count = 0;

      for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx <= 0) continue;
        const name = part.slice(0, eqIdx).trim();
        const value = part.slice(eqIdx + 1).trim();
        if (!name || !value) continue;

        const isHost = name.startsWith('__Host-');
        const isSecure = true; // Google cookies chạy qua HTTPS, bắt buộc cho SameSite=no_restriction
        const isHttpOnly = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'].includes(name) || name.includes('SID');

        // Nạp cho .google.com
        try {
          const cookieDetail: any = {
            url: 'https://google.com',
            name,
            value,
            path: '/',
            secure: isSecure,
            httpOnly: isHttpOnly,
            sameSite: 'no_restriction',
          };
          if (!isHost) {
            cookieDetail.domain = '.google.com';
          }
          await targetSes.cookies.set(cookieDetail);
          count++;
        } catch {}

        // Nạp riêng cho flow.google.com
        try {
          const flowCookieDetail: any = {
            url: 'https://flow.google.com',
            name,
            value,
            path: '/',
            secure: isSecure,
            httpOnly: isHttpOnly,
            sameSite: 'no_restriction',
          };
          if (!isHost) {
            flowCookieDetail.domain = '.google.com';
          }
          await targetSes.cookies.set(flowCookieDetail);
        } catch {}
      }

      if (typeof targetSes.cookies.flushStore === 'function') {
        await targetSes.cookies.flushStore();
      }

      console.log(`[GoogleVeoSessionManager] ✅ Đã nạp thành công ${count} cookies vào phân vùng Electron.`);
      return count;
    } catch (e) {
      console.warn('[GoogleVeoSessionManager] Lỗi khi nạp cookie vào partition:', e);
      return 0;
    }
  }

  /**
   * Khởi động và tự động đồng bộ cookie hai chiều giữa SettingsStore và phân vùng Electron
   */
  async init(): Promise<void> {
    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        // 1. Phục hồi cookie từ SettingsStore nếu phân vùng Electron đang trống
        await this.restoreCookiesToPartition(ses);

        // 2. Đồng bộ cookie mới nhất từ phân vùng
        await this.syncCookiesFromPartition(ses);

        ses.cookies.on('changed', async (_event: any, cookie: any, _cause: any, removed: boolean) => {
          if (!removed && (GOOGLE_AUTH_COOKIE_NAMES.includes(cookie.name) || cookie.domain?.includes('google'))) {
            await this.syncCookiesFromPartition(ses);
          }
        });
      }
    } catch (e) {
      console.warn('GoogleVeoSessionManager init warning:', e);
    }
  }

  /**
   * Chuẩn hóa và loại bỏ cookie trùng lặp (tránh lỗi Google accounts.google.com/CookieMismatch)
   */
  static cleanAndDeduplicateCookies(rawCookieStr: string): string {
    if (!rawCookieStr) return '';
    const cookieMap = new Map<string, string>();
    const parts = rawCookieStr.split(';').map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const key = part.slice(0, eqIdx).trim();
        const val = part.slice(eqIdx + 1).trim();
        if (key && val) {
          cookieMap.set(key, val);
        }
      }
    }
    return Array.from(cookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Lấy cookie session đã lưu hoặc từ phân vùng Electron
   */
  async getEffectiveCookieString(): Promise<string> {
    // 1. Thử đọc từ SettingsStore trước
    const storedCookie = SettingsStore.get('veoSessionCookie')?.trim();
    if (storedCookie) {
      return GoogleVeoSessionManager.cleanAndDeduplicateCookies(storedCookie);
    }

    // 2. Thử đọc từ Electron session partition nếu có
    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        const cookies = await ses.cookies.get({});
        const authCookies = cookies.filter((c: any) =>
          GOOGLE_AUTH_COOKIE_NAMES.includes(c.name) ||
          (c.domain && (c.domain.includes('google') || c.domain.includes('flow')))
        );

        if (authCookies.length > 0) {
          const rawJoined = authCookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
          return GoogleVeoSessionManager.cleanAndDeduplicateCookies(rawJoined);
        }
      }
    } catch {}

    return '';
  }

  /**
   * Mở cửa sổ Sảnh Google Veo / Flow để người dùng đăng nhập tài khoản thật
   * Hỗ trợ options { uiMode?: 'offscreen' | 'live_window'; forceRecreate?: boolean }
   * hoặc legacy parentWindow
   */
  async openLobbyWindow(
    optionsOrParent?: { uiMode?: 'offscreen' | 'live_window'; forceRecreate?: boolean } | any
  ): Promise<void> {
    let electron: any;
    try {
      electron = require('electron');
    } catch {
      throw new Error('Chức năng mở cửa sổ chỉ hoạt động trong môi trường ứng dụng Electron.');
    }

    const { BrowserWindow, session } = electron;
    if (!BrowserWindow) {
      throw new Error('Không tìm thấy BrowserWindow trong Electron.');
    }

    // Xác định uiMode và forceRecreate
    let targetUiMode: 'offscreen' | 'live_window' = 'offscreen';
    let forceRecreate = false;

    if (optionsOrParent && typeof optionsOrParent === 'object') {
      if ('uiMode' in optionsOrParent || 'forceRecreate' in optionsOrParent) {
        targetUiMode = optionsOrParent.uiMode || 'offscreen';
        forceRecreate = Boolean(optionsOrParent.forceRecreate);
      } else if (optionsOrParent.webContents || typeof optionsOrParent.isDestroyed === 'function') {
        // Tương thích ngược: mở từ menu UI hoặc dialog chính (cần hiển thị cho người dùng)
        targetUiMode = 'live_window';
      }
    }

    const isLive = targetUiMode === 'live_window';
    this.isLobbyDebugVisible = isLive;

    // Tái tạo cửa sổ nếu yêu cầu forceRecreate
    if (forceRecreate && this.lobbyWindow && !this.lobbyWindow.isDestroyed()) {
      try {
        this.lobbyWindow.destroy();
      } catch {}
      this.lobbyWindow = null;
    }

    // Nếu cửa sổ đang mở thì cập nhật kích thước / vị trí tương ứng với uiMode
    if (this.lobbyWindow && !this.lobbyWindow.isDestroyed()) {
      this.lobbyWindow.setSize(1440, 900);
      try {
        this.lobbyWindow.webContents?.setZoomFactor(1.0);
      } catch {}

      if (isLive) {
        this.lobbyWindow.setPosition(100, 60);
        this.lobbyWindow.show();
        this.lobbyWindow.focus();
      } else {
        this.lobbyWindow.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
        if (typeof this.lobbyWindow.showInactive === 'function') {
          this.lobbyWindow.showInactive();
        }
      }
      return;
    }

    const ses = session.fromPartition('persist:google_veo');

    // Preserve Chromium identity/client hints; do not mask the embedded browser.

    const initWidth = 1440;
    const initHeight = 900;
    const posX = isLive ? 100 : OFFSCREEN_X;
    const posY = isLive ? 60 : OFFSCREEN_Y;

    this.lobbyWindow = new BrowserWindow({
      width: initWidth,
      height: initHeight,
      minWidth: 1024,
      minHeight: 720,
      x: posX,
      y: posY,
      show: false,
      title: 'Sảnh Google Flow / Veo - Đăng nhập tài khoản Google để nhận Credit miễn phí',
      // Không đặt parent để sảnh là cửa sổ độc lập, thu nhỏ (-) xuống taskbar thoải mái không bị đóng
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:google_veo',
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    if (isLive) {
      this.lobbyWindow.show();
      this.lobbyWindow.focus();
    } else {
      if (typeof this.lobbyWindow.showInactive === 'function') {
        this.lobbyWindow.showInactive();
      }
    }

    // Thiết lập User-Agent cho webContents
    // No user-agent override.

    // Gắn Crash Watchdog (AC-7)
    this.attachCrashWatchdog(this.lobbyWindow);

    // Xóa cờ automation webdriver và chèn CSS khắc phục đè chồng giao diện
    this.lobbyWindow.webContents.on('dom-ready', () => {
      // Khắc phục lỗi đè chồng tiêu đề dự án và menu Tất cả nội dung nghe nhìn ở góc trên bên trái
      this.lobbyWindow?.webContents?.insertCSS(`
        flow-navigation-header {
          position: relative !important;
          z-index: 20 !important;
        }
        flow-tile-view-header {
          margin-top: 56px !important;
        }
        mat-sidenav.project-sidenav {
          margin-top: 56px !important;
          height: calc(100% - 56px) !important;
        }
      `).catch(() => {});
    });

    // Lắng nghe cookie thay đổi để tự động lưu session
    ses.cookies.on('changed', async (_event: any, cookie: any, _cause: any, removed: boolean) => {
      if (!removed && (GOOGLE_AUTH_COOKIE_NAMES.includes(cookie.name) || cookie.domain?.includes('google'))) {
        await this.syncCookiesFromPartition(ses);
      }
    });

    // Lắng nghe điều hướng URL: đổi User-Agent linh hoạt giữa trang Auth và trang Labs/Flow
    this.lobbyWindow.webContents.on('did-navigate', async (_event: any, url: string) => {

      if (
        url.includes('flow.google.com') ||
        url.includes('labs.google') ||
        url.includes('aitestkitchen') ||
        url.includes('google.com')
      ) {
        await this.syncCookiesFromPartition(ses);
        await this.validateSession();
      }
    });

    this.lobbyWindow.on('closed', () => {
      this.lobbyWindow = null;
      this.isLobbyDebugVisible = false;
      // Khi người dùng đóng cửa sổ, chỉ sync cookie; KHÔNG gọi validateSession()
      // vì validateSession() có thể hang nếu mạng chậm và không có ai await nó đúng cách
      this.syncCookiesFromPartition(ses).catch(() => {});
    });

    // Đảm bảo nạp đầy đủ cookie xác thực từ SettingsStore vào partition trước khi mở trang Flow
    await this.restoreCookiesToPartition(ses);

    // Bọc loadURL bằng timeout nghiêm ngặt 8.000ms để không bao giờ treo vô hạn khi mở Sảnh ngầm
    const loadUrlWithTimeout = async (targetUrl: string, timeoutMs = 8000) => {
      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          this.lobbyWindow.loadURL(targetUrl),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timeout loading URL (${timeoutMs}ms)`)), timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      await loadUrlWithTimeout(GOOGLE_FLOW_LOBBY_URL, 8000);
    } catch {
      // Fallback nếu không tải được URL chính
      try {
        await loadUrlWithTimeout(VIDEO_FX_FALLBACK_URL, 5000);
      } catch {}
    }
  }

  /**
   * Gắn Chromium Watchdog vào lobbyWindow để tự động phát hiện và phục hồi khi renderer bị crash (AC-7)
   */
  private attachCrashWatchdog(win: any): void {
    if (!win) return;

    if (win.webContents && typeof win.webContents.on === 'function') {
      win.webContents.on('render-process-gone', async (_event: any, details: any) => {
        const reason = details?.reason || 'unknown';
        const exitCode = details?.exitCode ?? -1;
        console.error(
          `[Google Flow Watchdog] 💥 Renderer Process Gone! Lý do: ${reason}, exitCode: ${exitCode}`
        );

        // Bỏ qua trường hợp tắt bình thường
        if (reason === 'clean-exit') return;

        // Kiểm tra crash loop (tối đa 3 lần trong 30 giây)
        const now = Date.now();
        this.recentCrashTimes = this.recentCrashTimes.filter((t) => now - t < 30000);
        this.recentCrashTimes.push(now);

        if (this.recentCrashTimes.length > 3) {
          console.error(
            '[Google Flow Watchdog] 🚨 CẢNH BÁO: Phát hiện vòng lặp renderer crash (>3 lần trong 30s). Tạm dừng tự động tái tạo để tránh vòng lặp vô hạn.'
          );
          return;
        }

        await this.handleRendererCrash(details);
      });
    }

    if (typeof win.on === 'function') {
      win.on('unresponsive', () => {
        console.warn(
          '[Google Flow Watchdog] ⚠️ lobbyWindow đang trong trạng thái Unresponsive (treo / phản hồi chậm)!'
        );
      });

      win.on('responsive', () => {
        console.log('[Google Flow Watchdog] 💚 lobbyWindow đã phản hồi bình thường trở lại.');
      });
    }
  }

  /**
   * Xử lý khi Renderer Process bị crash hoặc cần phục hồi tự động (AC-7)
   */
  public async handleRendererCrash(details?: { reason?: string; exitCode?: number }): Promise<any> {
    if (this.isRecreatingLobby) {
      console.warn('[Google Flow Watchdog] Đang trong quá trình tái tạo lobbyWindow, bỏ qua sự kiện duplicate.');
      return null;
    }
    this.isRecreatingLobby = true;
    console.warn(
      `[Google Flow Watchdog] Bắt đầu quy trình tự phục hồi & tái tạo lobbyWindow... (Lý do: ${details?.reason || 'manual/unspecified'})`
    );

    try {
      if (this.lobbyWindow) {
        try {
          if (!this.lobbyWindow.isDestroyed()) {
            this.lobbyWindow.destroy();
          }
        } catch (destroyErr) {
          console.warn('[Google Flow Watchdog] Lỗi khi destroy cửa sổ hỏng:', destroyErr);
        }
        this.lobbyWindow = null;
      }

      await this.openLobbyWindow();
      console.log('[Google Flow Watchdog] ✅ Tái tạo lobbyWindow thành công sau renderer crash!');
      return this.lobbyWindow;
    } catch (err) {
      console.error('[Google Flow Watchdog] ❌ Thất bại khi tái tạo lobbyWindow sau crash:', err);
      return null;
    } finally {
      this.isRecreatingLobby = false;
    }
  }

  /**
   * Yêu cầu tái tạo lại lobbyWindow (hữu ích khi crash hoặc phục hồi khẩn cấp)
   */
  public async recreateLobbyWindow(): Promise<any> {
    return await this.handleRendererCrash({ reason: 'manual-recreate', exitCode: 0 });
  }

  public isLobbyRecreating(): boolean {
    return this.isRecreatingLobby;
  }

  public getCrashCount(): number {
    return this.recentCrashTimes.length;
  }

  public resetCrashHistory(): void {
    this.recentCrashTimes = [];
  }

  /**
   * Đồng bộ cookie từ phân vùng Electron vào SettingsStore
   */
  private async syncCookiesFromPartition(ses: any): Promise<void> {
    try {
      const cookies = await ses.cookies.get({});
      const authCookies = cookies.filter((c: any) =>
        GOOGLE_AUTH_COOKIE_NAMES.includes(c.name) || (c.domain && c.domain.includes('google'))
      );

      if (authCookies.length > 0) {
        const cookieStr = authCookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
        SettingsStore.set('veoSessionCookie', cookieStr);
        SettingsStore.set('veoSessionAuthToken', '');
        SettingsStore.set('veoSessionStatus', 'active');
      }
    } catch (err) {
      console.warn('Không thể đồng bộ cookie từ partition:', err);
    }
  }

  /**
   * Nhập cookie hoặc token thủ công do người dùng dán vào
   */
  async saveManualSession(rawInput: string): Promise<VeoSessionValidationResult> {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) {
      throw new Error('Vui lòng dán chuỗi Cookie hoặc Bearer Token phiên làm việc của Google.');
    }

    if (trimmed.startsWith('ya29.')) {
      // Bearer OAuth token chuẩn của Google
      SettingsStore.set('veoSessionAuthToken', trimmed);
      SettingsStore.set('veoSessionCookie', '');
    } else {
      // Kiểm tra người dùng có chỉ dán mỗi giá trị chuỗi SID (thiếu "SID=" hoặc thiếu các cookie bảo mật khác)
      if (!trimmed.includes('=')) {
        throw new Error(
          'Bạn chỉ mới dán GIÁ TRỊ của cookie mà thiếu tên và các cookie bảo mật bắt buộc của Google. Google yêu cầu đủ bộ cookie (SID, HSID, SSID, __Secure-1PSID). Vui lòng dùng nút "Mở Sảnh Google" để đăng nhập tự động, hoặc copy toàn bộ dòng Header "Cookie" từ F12 Network.'
        );
      }

      const cookieNames = trimmed.split(';').map((p) => p.trim().split('=')[0].trim());
      const hasSid = cookieNames.includes('SID');
      const hasCompanion =
        cookieNames.includes('HSID') ||
        cookieNames.includes('SSID') ||
        cookieNames.includes('__Secure-1PSID') ||
        cookieNames.includes('__Secure-3PSID');

      if (hasSid && !hasCompanion) {
        throw new Error(
          'Chuỗi cookie chỉ chứa SID đơn lẻ mà thiếu các cookie bảo mật bắt buộc (HSID, SSID, __Secure-1PSID). Google sẽ từ chối xác thực nếu chỉ có SID. Vui lòng bấm "Mở Sảnh Google" để đăng nhập tự động, hoặc copy toàn bộ Cookie header từ F12.'
        );
      }

      const cleanCookie = GoogleVeoSessionManager.cleanAndDeduplicateCookies(trimmed);
      SettingsStore.set('veoSessionCookie', cleanCookie);
      SettingsStore.set('veoSessionAuthToken', ''); // Xóa auth token rác để tránh xung đột

      // Thử inject vào Electron partition nếu có
      try {
        const electron = require('electron');
        const session = electron?.session;
        if (session?.fromPartition) {
          const ses = session.fromPartition('persist:google_veo');
          const pairs = cleanCookie.split(';').map((p) => p.trim());
          for (const pair of pairs) {
            const idx = pair.indexOf('=');
            if (idx > 0) {
              const name = pair.slice(0, idx).trim();
              const value = pair.slice(idx + 1).trim();
              const isSecure = name.startsWith('__Secure-') || name.startsWith('__Host-') || name === 'SSID';
              await ses.cookies.set({
                url: 'https://flow.google.com',
                name,
                value,
                domain: '.google.com',
                path: '/',
                secure: isSecure,
              });
            }
          }
        }
      } catch {}
    }

    return this.validateSession();
  }

  /**
   * Xóa toàn bộ session đăng nhập
   */
  async clearSession(): Promise<void> {
    SettingsStore.set('veoSessionCookie', '');
    SettingsStore.set('veoSessionAuthToken', '');
    SettingsStore.set('veoAccountEmail', '');
    SettingsStore.set('veoSessionStatus', 'unauthenticated');
    SettingsStore.set('veoLastChecked', Date.now());

    this.currentProjectId = null;
    this.lastPermissionConfirmedAt = 0;

    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        await ses.clearStorageData();
      }
    } catch {}
  }

  /**
   * KIỂM TRA SESSION HOẠT ĐỘNG (SESSION HEALTH CHECK)
   * Gửi probe request siêu nhẹ đến Google để xác nhận cookie còn sống không.
   * Trả về kết quả trong < 1.5s để người dùng không mất thời gian vô ích.
   */
  async validateSession(): Promise<VeoSessionValidationResult> {
    const HARD_TIMEOUT_MS = 8000;
    let timer: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<VeoSessionValidationResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          valid: false,
          status: 'unauthenticated',
          detail: 'Quá hạn kiểm tra phiên Google Flow (Timeout 8s). Vui lòng mở Sảnh đăng nhập hoặc kết nối Chrome Bridge.',
          lastChecked: Date.now(),
        });
      }, HARD_TIMEOUT_MS);
    });

    const executionPromise = (async (): Promise<VeoSessionValidationResult> => {
      const cookie = await this.getEffectiveCookieString();
      let token = SettingsStore.get('veoSessionAuthToken')?.trim();

      // Chỉ chấp nhận Bearer token nếu bắt đầu bằng ya29.
      if (token && !token.startsWith('ya29.')) {
        SettingsStore.set('veoSessionAuthToken', '');
        token = '';
      }

      const now = Date.now();
      const bridgeConnected = FlowBridgeServer.getInstance().isConnected();

      // 0. Nếu Chrome Extension Bridge đang kết nối trực tiếp, phiên làm việc được uỷ quyền qua Chrome thật
      if (bridgeConnected && (!cookie && !token)) {
        const res: VeoSessionValidationResult = {
          valid: true,
          status: 'active',
          detail: 'Đã kết nối trực tiếp qua Chrome Extension Bridge (VanhSub Flow Bridge).',
          lastChecked: now,
        };
        SettingsStore.set('veoSessionStatus', res.status);
        SettingsStore.set('veoLastChecked', now);
        return res;
      }

      // 1. Kiểm tra ban đầu: nếu chưa hề có cookie hay token
      if (!cookie && !token) {
        const res: VeoSessionValidationResult = {
          valid: false,
          status: 'unauthenticated',
          detail: 'Chưa có phiên đăng nhập Google Veo. Vui lòng bấm "Mở sảnh Google Veo" hoặc kết nối Chrome Extension Bridge.',
          lastChecked: now,
        };
        SettingsStore.set('veoSessionStatus', res.status);
        SettingsStore.set('veoLastChecked', now);
        return res;
      }

      // 2. Kiểm tra xem các cookie cốt lõi có hiện diện không
      const hasCoreCookies = cookie.includes('SID=') || cookie.includes('__Secure-1PSID=') || Boolean(token);
      if (!hasCoreCookies) {
        if (bridgeConnected) {
          const res: VeoSessionValidationResult = {
            valid: true,
            status: 'active',
            detail: 'Đã kết nối trực tiếp qua Chrome Extension Bridge (VanhSub Flow Bridge).',
            lastChecked: now,
          };
          SettingsStore.set('veoSessionStatus', res.status);
          SettingsStore.set('veoLastChecked', now);
          return res;
        }
        const res: VeoSessionValidationResult = {
          valid: false,
          status: 'expired',
          detail: 'Thiếu cookie nhận diện SID/__Secure-1PSID của Google. Session đã hết hạn hoặc không đủ quyền.',
          lastChecked: now,
        };
        SettingsStore.set('veoSessionStatus', res.status);
        SettingsStore.set('veoLastChecked', now);
        return res;
      }

      // 3. Thực hiện probe request kiểm tra kết nối với Google
      try {
        const probeResult = await this.executeHealthProbe(cookie, token);
        SettingsStore.set('veoSessionStatus', probeResult.status);
        SettingsStore.set('veoLastChecked', now);
        if (probeResult.email) {
          SettingsStore.set('veoAccountEmail', probeResult.email);
        }
        return probeResult;
      } catch (err: any) {
        // Khi offline hoặc lỗi mạng
        const res: VeoSessionValidationResult = {
          valid: hasCoreCookies, // nếu có cookie thì tạm coi là ok nhưng cảnh báo mạng
          status: hasCoreCookies ? 'active' : 'unknown',
          detail: hasCoreCookies
            ? 'Đã lưu session (chưa thể kiểm tra với server do mạng yếu hoặc offline).'
            : `Lỗi kiểm tra session: ${err?.message || err}`,
          lastChecked: now,
        };
        SettingsStore.set('veoSessionStatus', res.status);
        SettingsStore.set('veoLastChecked', now);
        return res;
      }
    })();

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Gửi request probe siêu nhẹ đến Google Flow / Labs.
   * Có hard timeout toàn bộ 8s để tuyệt đối không hang.
   */
  private async executeHealthProbe(cookie: string, token?: string): Promise<VeoSessionValidationResult> {
    const hasCoreCookies = cookie.includes('SID=') || cookie.includes('__Secure-1PSID=') || Boolean(token);
    const now = Date.now();

    // Hard outer timeout — đảm bảo hàm này LUÔN kết thúc trong tối đa 8 giây
    const HARD_TIMEOUT_MS = 8000;

    const probePromise = new Promise<VeoSessionValidationResult>((resolve) => {
      const headers: Record<string, string> = {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
        Connection: 'close',
      };

      if (cookie) headers['Cookie'] = cookie;
      if (token && token.startsWith('ya29.')) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let settled = false;
      const done = (result: VeoSessionValidationResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      const sendRequest = (targetUrl: string, hopCount = 0) => {
        if (hopCount > 3) {
          done({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: 'Quá nhiều lần chuyển hướng, nhưng cookie phiên vẫn còn hiệu lực.',
            lastChecked: Date.now(),
          });
          return;
        }

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(targetUrl);
        } catch {
          done({ valid: hasCoreCookies, status: hasCoreCookies ? 'active' : 'unknown', detail: 'URL probe không hợp lệ.', lastChecked: Date.now() });
          return;
        }

        const req = https.request(
          {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers,
            timeout: 6000,
          },
          (res) => {
            const statusCode = res.statusCode || 0;
            const location = res.headers['location'] || '';

            // Phải consume body để socket không bị treo
            const drainAndDone = (result: VeoSessionValidationResult) => {
              res.resume(); // drain ngay, không đọc nội dung
              done(result);
            };

            // Redirect tới trang login → session expired
            if (
              statusCode >= 300 && statusCode < 400 &&
              (location.includes('accounts.google.com') || location.includes('ServiceLogin') || location.includes('signin'))
            ) {
              drainAndDone({
                valid: false,
                status: 'expired',
                detail: 'Phiên Google đã hết hạn hoặc đã đăng xuất. Vui lòng mở lại sảnh để đăng nhập.',
                lastChecked: Date.now(),
              });
              return;
            }

            // Redirect nội bộ an toàn → follow
            if (statusCode >= 300 && statusCode < 400 && location) {
              res.resume(); // drain redirect response (thường không có body)
              const nextUrl = location.startsWith('http') ? location : new URL(location, targetUrl).toString();
              sendRequest(nextUrl, hopCount + 1);
              return;
            }

            // Rate limited
            if (statusCode === 429) {
              drainAndDone({
                valid: false,
                status: 'rate_limited',
                detail: 'Google đang hạn chế tần suất (Rate Limit 429). Vui lòng đợi hoặc đổi tài khoản.',
                lastChecked: Date.now(),
              });
              return;
            }

            // Forbidden / Unauthorized
            if (statusCode === 401 || statusCode === 403) {
              drainAndDone({
                valid: false,
                status: 'expired',
                detail: 'Tài khoản không có quyền truy cập hoặc session không hợp lệ (Mã 403/401).',
                lastChecked: Date.now(),
              });
              return;
            }

            // Đọc một phần body để check Captcha, có giới hạn dung lượng
            let data = '';
            res.on('data', (chunk) => {
              data += chunk.toString();
              if (data.length > 20000) {
                res.destroy(); // Đã đọc đủ, ngắt
              }
            });

            res.on('end', () => {
              if (
                data.includes('google.com/sorry') ||
                data.includes('Unusual traffic') ||
                data.includes('g-recaptcha-response')
              ) {
                done({
                  valid: false,
                  status: 'captcha_required',
                  detail: 'Google yêu cầu giải Captcha chống bot. Vui lòng mở sảnh để hoàn tất.',
                  lastChecked: Date.now(),
                });
                return;
              }

              done({
                valid: true,
                status: 'active',
                detail: 'Session Google Flow / Veo đang hoạt động! Sẵn sàng sử dụng credit miễn phí.',
                lastChecked: Date.now(),
              });
            });

            res.on('error', () => {
              done({
                valid: hasCoreCookies,
                status: hasCoreCookies ? 'active' : 'unknown',
                detail: 'Kết nối probe bị ngắt, nhưng cookie vẫn sẵn sàng.',
                lastChecked: Date.now(),
              });
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          done({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session (kết nối kiểm tra quá hạn, cookie vẫn sẵn sàng).'
              : 'Kiểm tra quá hạn (timeout).',
            lastChecked: Date.now(),
          });
        });

        req.on('error', () => {
          done({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session Google Flow (mạng gián đoạn tạm thời).'
              : 'Không thể kết nối tới máy chủ Google Flow.',
            lastChecked: Date.now(),
          });
        });

        req.end();
      };

      sendRequest('https://flow.google.com');
    });

    const timeoutPromise = new Promise<VeoSessionValidationResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session (server phản hồi chậm, cookie vẫn hợp lệ).'
              : 'Không thể xác minh session (server không phản hồi).',
            lastChecked: now,
          }),
        HARD_TIMEOUT_MS
      )
    );

    return Promise.race([probePromise, timeoutPromise]);
  }

  /**
   * Lấy tổng quan trạng thái phục vụ hiển thị trên UI
   */
  getStatus(): VeoStatusPayload {
    const mode = (SettingsStore.get('veoMode') || 'free_session') as VeoMode;
    const bridgeConnected = FlowBridgeServer.getInstance().isConnected();
    const rawSessionStatus = (SettingsStore.get('veoSessionStatus') || 'unauthenticated') as VeoSessionStatus;
    const sessionStatus: VeoSessionStatus =
      bridgeConnected && (rawSessionStatus === 'unauthenticated' || rawSessionStatus === 'expired' || rawSessionStatus === 'unknown')
        ? 'active'
        : rawSessionStatus;
    const hasSession = SettingsStore.hasVeoSession() || bridgeConnected;
    const email = SettingsStore.get('veoAccountEmail') || undefined;
    const lastChecked = Number(SettingsStore.get('veoLastChecked')) || undefined;
    const credits = SettingsStore.get('veoFlowCredits') ?? null;
    const creditsCheckedAt = Number(SettingsStore.get('veoFlowCreditsCheckedAt')) || undefined;
    const antiSpam = GoogleVeoAntiSpamGuard.getInstance().getStatus();

    return {
      mode,
      hasSession,
      sessionStatus,
      email,
      credits,
      creditsCheckedAt,
      lastChecked,
      antiSpam,
    };
  }

  /** Đổi chế độ hoạt động: Sảnh Free vs API Key vs Mô phỏng */
  setMode(mode: VeoMode): void {
    SettingsStore.set('veoMode', mode);
  }

  // =========================================================================
  // BROWSER AUTOMATION — Sinh video qua fetchThật trong Electron BrowserWindow
  // =========================================================================

  /**
   * Thực thi JavaScript an toàn với Hard Watchdog timeout (tránh vĩnh viễn lỗi Mojo interface hang)
   */
  public async safeExecuteJs<T = any>(win: any, js: string, timeoutMs = 6000): Promise<T | null> {
    if (!win || win.isDestroyed()) return null;
    try {
      const execPromise = win.webContents.executeJavaScript(js, true);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('executeJavaScript timeout')), timeoutMs)
      );
      const raw = await Promise.race([execPromise, timeoutPromise]);
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return raw as any; }
      }
      return raw as T;
    } catch (err: any) {
      console.warn('[Google Flow Browser] safeExecuteJs warning:', err?.message || err);
      return null;
    }
  }

  /**
   * Đảm bảo lobby window đang mở và đã ở trang Google Flow (https://flow.google.com).
   */
  public async ensureLobbyAtFlow(options?: { uiMode?: 'offscreen' | 'live_window' }): Promise<boolean> {
    let electron: any;
    try {
      electron = require('electron');
    } catch {
      return false;
    }

    const { BrowserWindow } = electron;
    if (!BrowserWindow) return false;

    // Mở lobby window nếu chưa có hoặc nếu renderer đã bị crash
    const isRendererDead = Boolean(
      this.lobbyWindow?.webContents?.isCrashed && this.lobbyWindow.webContents.isCrashed()
    );

    if (!this.lobbyWindow || this.lobbyWindow.isDestroyed() || isRendererDead) {
      if (isRendererDead) {
        console.warn(
          '[Google Flow Browser] Phát hiện renderer của lobbyWindow bị crash trong ensureLobbyAtFlow, đang tái tạo...'
        );
        await this.handleRendererCrash({ reason: 'renderer-dead-in-ensure-lobby', exitCode: -1 });
      } else {
        try {
          await this.openLobbyWindow(options);
        } catch (e) {
          console.warn('[Google Flow Browser] Không thể mở lobby window:', e);
          return false;
        }
      }
    }

    const win = this.lobbyWindow;
    if (!win || win.isDestroyed()) return false;

    // Đợi load ban đầu nếu đang loading (tối đa 5s)
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        win.webContents.once('did-stop-loading', () => resolve());
        setTimeout(resolve, 5000);
      });
    }

    const currentUrl = (win.webContents.getURL() || '').toLowerCase();

    // Nếu chưa ở flow.google.com → chuyển đến flow.google.com trước
    if (!currentUrl.includes('flow.google.com')) {
      console.log('[Google Flow Browser] Đang mở https://flow.google.com...');
      try {
        await win.loadURL(GOOGLE_FLOW_LOBBY_URL);
        await new Promise<void>((resolve) => {
          win.webContents.once('did-stop-loading', () => resolve());
          setTimeout(resolve, 6000);
        });
      } catch (e) {
        console.warn('[Google Flow Browser] Không thể load flow.google.com:', e);
        return false;
      }
    }

    const finalUrl = (win.webContents.getURL() || '').toLowerCase();

    // Nếu sau khi mở flow.google.com mà bị chuyển hướng sang trang đăng nhập Google
    if (finalUrl.includes('accounts.google.com') || finalUrl.includes('servicelogin')) {
      console.warn('[Google Flow Browser] Cần đăng nhập tài khoản Google trên Sảnh Flow trước.');
      return false;
    }

    return !win.isDestroyed();
  }

  /**
   * Đọc số lượng credit Google Flow còn lại từ panel tài khoản Google (iframe accounts.google.com).
   * Luôn bọc trong try/catch và timeout 4s, trả về number | null, không throw lỗi.
   */
  private async readFlowCredits(win: any): Promise<number | null> {
    if (!win || win.isDestroyed()) return null;

    const readPromise = (async (): Promise<number | null> => {
      try {
        // 1. Click vào nút/avatar mở panel tài khoản Google trên trang chính
        const clickAvatarJs = `
          (function() {
            const selectors = [
              'a.gb_A',
              '[aria-label*="Google Account" i]',
              '[aria-label*="Tài khoản Google" i]',
              'a[href*="myaccount.google.com"]'
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                el.click();
                return true;
              }
            }
            return false;
          })()
        `;

        const clicked = await this.safeExecuteJs<boolean>(win, clickAvatarJs, 2000);
        // 2. Nếu không tìm thấy nút để click, trả về null ngay, không throw lỗi
        if (!clicked) {
          console.log('[Google Flow Credits] Không tìm thấy nút avatar tài khoản Google để mở panel.');
          return null;
        }

        // 3. Đợi khoảng 700-900ms để iframe panel kịp render
        await new Promise((r) => setTimeout(r, 800));
        if (win.isDestroyed()) return null;

        // 4. Duyệt qua win.webContents.mainFrame.framesInSubtree, tìm frame có url chứa accounts.google.com
        const frames: any[] = win.webContents?.mainFrame?.framesInSubtree || [];
        const accountFrames = frames.filter((f) => {
          const u = (f?.url || '').toLowerCase();
          return u.includes('accounts.google.com');
        });

        if (accountFrames.length === 0) {
          console.log('[Google Flow Credits] Không tìm thấy iframe accounts.google.com trong trang.');
          return null;
        }

        let foundCredits: number | null = null;

        // 5. Trong frame đó, gọi frame.executeJavaScript(...) để lấy document.body.innerText
        for (const frame of accountFrames) {
          try {
            const textPromise = frame.executeJavaScript('(document.body ? document.body.innerText : "") || ""');
            const frameTimeout = new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('frame timeout')), 1500)
            );
            const text: string = (await Promise.race([textPromise, frameTimeout]).catch(() => '')) || '';

            if (!text) continue;

            // Regex bắt số đứng trước cụm "tín dụng Google Flow" hoặc "Google Flow credits"
            // Loại bỏ dấu chấm/phẩy phân cách nghìn, parse thành số nguyên
            const matchBefore = text.match(/([0-9][0-9.,]*)\s*(?:tín\s*dụng\s*google\s*flow|google\s*flow\s*credits)/i);
            if (matchBefore && matchBefore[1]) {
              const cleanStr = matchBefore[1].replace(/[.,\s]/g, '');
              const val = parseInt(cleanStr, 10);
              if (!isNaN(val)) {
                foundCredits = val;
                break;
              }
            }

            // Fallback: hỗ trợ trường hợp số đứng sau cụm từ (ví dụ "Tín dụng Google Flow: 30")
            const matchAfter = text.match(/(?:tín\s*dụng\s*google\s*flow|google\s*flow\s*credits)[:\s]+([0-9][0-9.,]*)/i);
            if (matchAfter && matchAfter[1]) {
              const cleanStr = matchAfter[1].replace(/[.,\s]/g, '');
              const val = parseInt(cleanStr, 10);
              if (!isNaN(val)) {
                foundCredits = val;
                break;
              }
            }
          } catch {}
        }

        return foundCredits;
      } catch (err: any) {
        console.warn('[Google Flow Credits] Lỗi khi đọc credit từ panel:', err?.message || err);
        return null;
      } finally {
        // 6. Sau khi đọc xong (dù thành công hay thất bại), gửi phím Escape để đóng panel lại
        try {
          if (!win.isDestroyed()) {
            await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            await new Promise((r) => setTimeout(r, 60));
            await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          }
        } catch {}
      }
    })();

    // 7. Bọc toàn bộ trong timeout tổng thể không quá 4 giây
    const overallTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    return Promise.race([readPromise, overallTimeout]);
  }

  /**
   * Lấy số credit Google Flow từ cache hoặc mở panel đọc trực tiếp nếu cache hết hạn.
   * KHÔNG được gọi trong luồng generate chính để tránh tốn thời gian và can thiệp UI.
   * @param maxAgeMs Thời gian hợp lệ của cache (mặc định 20 phút = 20 * 60 * 1000 ms)
   */
  async getCachedOrFreshCredits(maxAgeMs = 20 * 60 * 1000): Promise<number | null> {
    const cachedCredits = SettingsStore.get('veoFlowCredits');
    const checkedAt = Number(SettingsStore.get('veoFlowCreditsCheckedAt')) || 0;

    // 1. Nếu đã có giá trị cache và Date.now() - veoFlowCreditsCheckedAt < maxAgeMs, trả thẳng giá trị cache
    if (cachedCredits !== null && typeof cachedCredits === 'number' && Date.now() - checkedAt < maxAgeMs) {
      return cachedCredits;
    }

    // 2. Ngược lại, truy cập lobbyWindow để đọc credit mới:
    // BẮT BUỘC tuần tự hóa qua GoogleFlowBrowserMutex để không can thiệp workflow đang chạy
    return await GoogleFlowBrowserMutex.getInstance().runExclusive(async () => {
      // Kiểm tra lại cache lần 2 (double-checked locking) phòng trường hợp tác vụ trước vừa cập nhật
      const freshCached = SettingsStore.get('veoFlowCredits');
      const freshCheckedAt = Number(SettingsStore.get('veoFlowCreditsCheckedAt')) || 0;
      if (freshCached !== null && typeof freshCached === 'number' && Date.now() - freshCheckedAt < maxAgeMs) {
        return freshCached;
      }

      const ready = await this.ensureLobbyAtFlow();
      if (!ready || !this.lobbyWindow || this.lobbyWindow.isDestroyed()) {
        return freshCached ?? null;
      }

      // 3. Gọi readFlowCredits, lưu kết quả + timestamp mới vào SettingsStore, trả về kết quả
      const freshCredits = await this.readFlowCredits(this.lobbyWindow);
      if (freshCredits !== null) {
        console.log(`[Google Flow Credits] Đã cập nhật số credit Google Flow: ${freshCredits}`);
        SettingsStore.set('veoFlowCredits', freshCredits);
        SettingsStore.set('veoFlowCreditsCheckedAt', Date.now());

        if (freshCredits === 0) {
          SettingsStore.set('veoSessionStatus', 'out_of_credits');
        }
        return freshCredits;
      }

      return freshCached ?? null;
    }, 'credit_access');
  }

  /**
   * Tạo một Dự án mới (New Project) sạch sẽ trên Google Flow.
   * Tuyệt đối không click vào các thẻ project cũ (flow-project-card).
   */
  public async createNewProject(
    win?: any,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean,
    targetProjectName?: string
  ): Promise<boolean> {
    const targetWin = win || this.lobbyWindow;
    if (!targetWin || targetWin.isDestroyed()) return false;

    const currentUrl = targetWin.webContents?.getURL?.() || '';

    // Nếu đang ở trong một project cũ, tải lại trang sảnh chính để reset sạch
    if (currentUrl.includes('/project/')) {
      console.log('[Google Flow Browser] Đang thoát khỏi project cũ để tạo project mới sạch sẽ...');
      onProgress?.(14, 'Đang điều hướng về trang chủ Google Flow...');
      try {
        await targetWin.loadURL('https://flow.google.com/');
      } catch {}
    }

    // Đảm bảo URL là flow.google.com và trang không còn đang loading
    for (let i = 0; i < 15; i++) {
      if (isCancelled?.()) return false;
      const url = targetWin.webContents?.getURL?.() || '';
      const isLoading = targetWin.webContents?.isLoading?.();
      if (url.includes('flow.google.com') && !url.includes('/project/') && !isLoading) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1000));

    onProgress?.(16, 'Đang tìm và nhấn nút Tạo dự án mới...');

    // Tìm và nhấn nút New Project qua FlowElementFinder (Tuyệt đối không click flow-project-card)
    let clickSucceeded = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (isCancelled?.()) return false;

      const finderRes = await FlowElementFinder.find(targetWin, FlowElementFinder.getNewProjectButtonSpec());
      if (finderRes.found && finderRes.selectedCandidate) {
        const cand = finderRes.selectedCandidate;
        const clickX = Math.round(cand.rect.x + cand.rect.width / 2);
        const clickY = Math.round(cand.rect.y + cand.rect.height / 2);
        console.log(
          `[Google Flow Browser] ✅ Đã tìm thấy nút New Project qua FlowElementFinder (Strategy: ${cand.strategy}, Confidence: ${cand.confidence}/100, Coords: (${clickX}, ${clickY}), lần thử ${attempt + 1})`
        );

        if (!targetWin.isDestroyed()) {
          try {
            targetWin.focus?.();
            targetWin.webContents.sendInputEvent({
              type: 'mouseMove',
              x: clickX,
              y: clickY,
            });
            await new Promise((r) => setTimeout(r, 40));
            targetWin.webContents.sendInputEvent({
              type: 'mouseDown',
              x: clickX,
              y: clickY,
              button: 'left',
              clickCount: 1,
            });
            await new Promise((r) => setTimeout(r, 50));
            targetWin.webContents.sendInputEvent({
              type: 'mouseUp',
              x: clickX,
              y: clickY,
              button: 'left',
              clickCount: 1,
            });

            // Fallback kích hoạt DOM click trên đúng candidate của FlowElementFinder để Angular Material nhận diện
            const selStr = JSON.stringify(cand.selector || 'button.new-project-button');
            await this.safeExecuteJs(
              targetWin,
              `(function() {
                try {
                  const el = document.querySelector(${selStr}) || document.querySelector('button.new-project-button, button[aria-label*="Tạo dự án" i]');
                  if (el) { el.click(); }
                } catch {}
              })()`,
              2000
            );

            clickSucceeded = true;
            break;
          } catch (e: any) {
            console.warn('[Google Flow Browser] Lỗi khi gửi sendInputEvent cho nút New Project:', e?.message || e);
          }
        }
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!clickSucceeded) {
      console.warn('[Google Flow Browser] ⚠️ Không tìm thấy nút New Project sau 10s.');
      return false;
    }

    // Đợi URL chuyển thành /project/<uuid> và editor sẵn sàng (tối đa 20s)
    onProgress?.(18, 'Đang chờ Google Flow khởi tạo workspace dự án mới...');
    for (let i = 0; i < 20; i++) {
      if (isCancelled?.()) return false;
      await new Promise((r) => setTimeout(r, 1000));

      const inProj = await this.safeExecuteJs<boolean>(targetWin, `Boolean(window.location.href.includes('/project/'))`, 1500);
      if (inProj) {
        const pageUrl = (await this.safeExecuteJs<string>(targetWin, 'window.location.href', 1500)) || targetWin.webContents?.getURL?.() || '';
        const match = pageUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          this.currentProjectId = match[1];
          console.log(`[Google Flow Browser] 📌 Đã lưu currentProjectId mới: ${this.currentProjectId}`);
        }
        console.log(`[Google Flow Browser] ✅ Dự án mới đã được khởi tạo (${pageUrl}), không gian làm việc sẵn sàng.`);

        // Nhóm B: Đổi tên project nếu có targetProjectName
        if (targetProjectName) {
          onProgress?.(19, `Đang cập nhật tên dự án thành "${targetProjectName}"...`);
          await this.renameCurrentProject(targetWin, targetProjectName);
        }

        return true;
      }
    }

    console.warn('[Google Flow Browser] ⚠️ Quá thời gian chờ khởi tạo dự án mới.');
    return false;
  }

  /**
   * Đảm bảo cửa sổ Flow đang ở trong một Phân cảnh (Scene) có sẵn khung soạn thảo prompt (.ProseMirror)
   * Tránh việc bị kẹt ở trang Thư viện Media ("Tất cả nội dung nghe nhìn") với thanh prompt rỗng.
   */
  public async ensureSceneContext(
    win: any,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    // Kiểm tra xem đã có sẵn ô prompt chưa
    const checkPromptJs = `Boolean(document.querySelector('.ProseMirror, [contenteditable="true"]:not([type="text"]), flow-prompt-box .ProseMirror'))`;
    let hasPrompt = await this.safeExecuteJs<boolean>(win, checkPromptJs, 2000);
    if (hasPrompt) return true;

    console.log('[Google Flow Browser] 🎬 Đang ở trang tổng thể dự án, kích hoạt vào Scene để mở khung Prompt...');
    onProgress?.(19, 'Đang mở không gian phân cảnh (Scene) để chuẩn bị prompt...');

    // Cách 1: Nếu đã có thẻ Scene trên trang, click vào Scene đầu tiên
    const clickExistingSceneJs = `
      (function() {
        const sceneCard = document.querySelector('a[href*="/scene/"], [class*="scene-card"], flow-scene-card, .scene-card-item');
        if (sceneCard) {
          sceneCard.click();
          return true;
        }
        return false;
      })()
    `;
    const clickedScene = await this.safeExecuteJs<boolean>(win, clickExistingSceneJs, 2000);
    if (clickedScene) {
      for (let i = 0; i < 10; i++) {
        if (isCancelled?.()) return false;
        await new Promise((r) => setTimeout(r, 800));
        hasPrompt = await this.safeExecuteJs<boolean>(win, checkPromptJs, 1500);
        if (hasPrompt) {
          console.log('[Google Flow Browser] ✅ Đã vào Scene hiện có thành công.');
          return true;
        }
      }
    }

    // Cách 2: Nhấn nút "+" trên thanh công cụ và chọn "Cảnh mới"
    const openAddMenuJs = `
      (function() {
        const addBtn = document.querySelector('button[aria-label*="thêm nội dung nghe nhìn" i], button[aria-label*="add" i], button.add-menu-trigger');
        if (addBtn) {
          addBtn.click();
          return true;
        }
        return false;
      })()
    `;
    const openedMenu = await this.safeExecuteJs<boolean>(win, openAddMenuJs, 2000);
    if (openedMenu) {
      await new Promise((r) => setTimeout(r, 600));
      const clickNewSceneMenuJs = `
        (function() {
          const items = Array.from(document.querySelectorAll('[role="menuitem"], .mat-mdc-menu-item, button'));
          const sceneBtn = items.find(el => (el.innerText || '').includes('Cảnh mới') || (el.innerText || '').includes('New scene'));
          if (sceneBtn) {
            sceneBtn.click();
            return true;
          }
          return false;
        })()
      `;
      await this.safeExecuteJs<boolean>(win, clickNewSceneMenuJs, 2000);

      for (let i = 0; i < 15; i++) {
        if (isCancelled?.()) return false;
        await new Promise((r) => setTimeout(r, 800));
        hasPrompt = await this.safeExecuteJs<boolean>(win, checkPromptJs, 1500);
        if (hasPrompt) {
          console.log('[Google Flow Browser] ✅ Đã tạo và vào Cảnh mới thành công, khung Prompt sẵn sàng.');
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Đổi tên project hiện tại trên Google Flow khớp với tên đề tài đã cấu hình.
   * Chạy an toàn, không bao giờ ném ngoại lệ làm gián đoạn luồng sinh media.
   */
  /**
   * Đổi tên project hiện tại trên Google Flow khớp với tên đề tài đã cấu hình.
   * Chạy an toàn, xác nhận thực tế (verify) trên DOM xem tên đã thực sự đổi chưa, không bao giờ ném ngoại lệ.
   */
  public async renameCurrentProject(win: any, targetName: string): Promise<boolean> {
    if (!win || win.isDestroyed() || !targetName) return false;
    const sanitized = sanitizeProjectName(targetName);
    console.log(`[Google Flow Browser] 🏷️ Đang thực hiện đổi tên dự án thành: "${sanitized}"...`);

    const renameScript = `
      (async function() {
        try {
          const targetText = ${JSON.stringify(sanitized)};
          const header = document.querySelector('header, [role="banner"], .top-bar, .app-bar, .header, nav');
          const root = header || document.body;

          const readCurrentTitle = () => {
            const inp = root.querySelector('input[aria-label*="tên" i], input[aria-label*="title" i], input[aria-label*="project" i], input.project-name, input.title-input, header input');
            if (inp && inp.value) return inp.value.trim();
            const titleEl = root.querySelector('h1, [role="heading"], [contenteditable="true"], .project-title, .title, [class*="project-name"]');
            return titleEl ? (titleEl.textContent || '').trim() : '';
          };

          let actionMethod = 'none';

          // 1. Kiểm tra nếu có sẵn input chỉnh sửa tên (input title/name)
          const existingInput = root.querySelector('input[aria-label*="tên" i], input[aria-label*="title" i], input[aria-label*="project" i], input.project-name, input.title-input, header input');
          if (existingInput) {
            existingInput.focus();
            existingInput.value = targetText;
            existingInput.dispatchEvent(new Event('input', { bubbles: true }));
            existingInput.dispatchEvent(new Event('change', { bubbles: true }));
            existingInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            existingInput.blur();
            actionMethod = 'existing_input';
          } else {
            // 2. Tìm phần tử văn bản tiêu đề của dự án
            const textElements = Array.from(root.querySelectorAll('h1, [role="heading"], button[aria-label*="tên" i], button[aria-label*="rename" i], [contenteditable], .project-title, .title, [class*="project-name"]'));
            let titleTarget = null;
            for (const el of textElements) {
              const txt = (el.textContent || '').trim();
              const aria = (el.getAttribute('aria-label') || '').trim();
              if (/tháng|untitled|dự án|project/i.test(txt) || /tên|rename|title/i.test(aria) || el.getAttribute('contenteditable') === 'true') {
                titleTarget = el;
                break;
              }
            }

            if (titleTarget) {
              if (titleTarget.getAttribute('contenteditable') === 'true') {
                titleTarget.focus();
                titleTarget.innerText = targetText;
                titleTarget.dispatchEvent(new Event('input', { bubbles: true }));
                titleTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                titleTarget.blur();
                actionMethod = 'contenteditable';
              } else {
                titleTarget.click();
                await new Promise(r => setTimeout(r, 400));

                const spawnedInput = root.querySelector('input:focus, input[type="text"], input, [contenteditable="true"]');
                if (spawnedInput) {
                  if (spawnedInput.tagName.toLowerCase() === 'input') {
                    spawnedInput.value = targetText;
                    spawnedInput.dispatchEvent(new Event('input', { bubbles: true }));
                    spawnedInput.dispatchEvent(new Event('change', { bubbles: true }));
                    spawnedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    spawnedInput.blur();
                  } else {
                    spawnedInput.innerText = targetText;
                    spawnedInput.dispatchEvent(new Event('input', { bubbles: true }));
                    spawnedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    spawnedInput.blur();
                  }
                  actionMethod = 'click_then_input';
                }
              }
            }
          }

          if (actionMethod === 'none') {
            return { ok: false, verified: false, reason: 'title_element_not_found', actualTitle: readCurrentTitle(), expectedTitle: targetText };
          }

          // Chờ DOM cập nhật sau thao tác đổi tên
          await new Promise(r => setTimeout(r, 600));
          const actualTitle = readCurrentTitle();
          const isVerified = actualTitle.toLowerCase() === targetText.toLowerCase() || actualTitle.toLowerCase().includes(targetText.toLowerCase());

          return {
            ok: isVerified,
            verified: isVerified,
            method: actionMethod,
            actualTitle,
            expectedTitle: targetText
          };
        } catch (e) {
          return { ok: false, verified: false, error: String(e) };
        }
      })()
    `;

    try {
      const res = await this.safeExecuteJs<any>(win, renameScript, 4500);
      if (res?.verified) {
        console.log(`[Google Flow Browser] ✅ [VERIFY PASS] Đã xác nhận đổi tên dự án Google Flow thành "${sanitized}" (thực tế trên DOM: "${res.actualTitle}", method: ${res.method})`);
        return true;
      } else {
        console.warn(`[Google Flow Browser] ⚠️ [VERIFY FAIL] Đổi tên dự án chưa thành công: Tiêu đề trên DOM là "${res?.actualTitle || 'không rõ'}", mong muốn "${sanitized}" (${res?.reason || res?.error || 'mismatch'}). Giữ nguyên tên hiện tại.`);
        return false;
      }
    } catch (err: any) {
      console.warn('[Google Flow Browser] ⚠️ Ngoại lệ khi đổi tên dự án (bỏ qua an toàn):', err?.message || err);
      return false;
    }
  }

  /**
   * Tìm và mở lại project đã có trên Google Flow dựa trên tên đề tài.
   * Dùng làm fallback (Ưu tiên 2) khi mở link URL trực tiếp thất bại, tránh tạo trùng lặp dự án.
   * Xử lý trường hợp có nhiều dự án trùng tên một cách thận trọng và minh bạch.
   */
  public async findAndOpenProjectByName(
    win: any,
    targetName: string,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<{ found: boolean; projectId?: string }> {
    if (!win || win.isDestroyed() || !targetName) return { found: false };
    const sanitized = sanitizeProjectName(targetName);
    const lowerTarget = sanitized.toLowerCase();
    onProgress?.(15, `Đang tìm dự án "${sanitized}" tại trang chủ Google Flow...`);
    console.log(`[Google Flow Browser] 🔍 Fallback: Tìm dự án theo tên "${sanitized}" tại sảnh chính...`);

    try {
      const currentUrl = win.webContents?.getURL?.() || '';
      if (!currentUrl.includes('flow.google.com') || currentUrl.includes('/project/')) {
        await win.loadURL('https://flow.google.com/');
      }

      // Chờ các card dự án hiển thị (tối đa 8s)
      for (let i = 0; i < 8; i++) {
        if (isCancelled?.()) return { found: false };
        await new Promise((r) => setTimeout(r, 1000));
        const hasCards = await this.safeExecuteJs<boolean>(
          win,
          `Boolean(document.querySelector('a[href*="/project/"], flow-project-card, [class*="project-card"], [role="listitem"]'))`,
          1500
        );
        if (hasCards) break;
      }

      const matchCardScript = `
        (function() {
          const target = ${JSON.stringify(lowerTarget)};
          const cards = Array.from(document.querySelectorAll('a[href*="/project/"], flow-project-card, [class*="project-card"], [role="listitem"]'));
          const matches = [];

          for (const card of cards) {
            const txt = (card.textContent || '').toLowerCase().trim();
            const href = card.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '';
            const match = href.match(/\\/project\\/([a-zA-Z0-9_-]+)/);
            const pId = match ? match[1] : null;

            if (txt.includes(target) || (target.length > 6 && target.includes(txt))) {
              const r = card.getBoundingClientRect();
              matches.push({
                projectId: pId,
                href,
                cardText: txt.slice(0, 80),
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2)
              });
            }
          }
          return { count: matches.length, matches };
        })()
      `;

      const matchRes = await this.safeExecuteJs<any>(win, matchCardScript, 2000);
      const count = matchRes?.count || 0;
      const matches = matchRes?.matches || [];

      if (count > 0) {
        if (count > 1) {
          console.warn(`[Google Flow Browser] ⚠️ CẢNH BÁO: Phát hiện ${count} dự án trùng tên "${sanitized}" trên Google Flow. Ưu tiên chọn dự án gần đây nhất (thẻ đầu tiên, ID: ${matches[0].projectId || 'unknown'}). Khuyến nghị: Cấu hình URL dự án chính xác trong Bước 3 của Thiết Lập Dự Án.`);
        } else {
          console.log(`[Google Flow Browser] 🎯 Tìm thấy duy nhất 1 dự án khớp tên: "${sanitized}" (projectId: ${matches[0].projectId || 'unknown'})`);
        }

        const chosen = matches[0];
        if (chosen.projectId) {
          this.currentProjectId = chosen.projectId;
          await win.loadURL(`https://flow.google.com/project/${chosen.projectId}`);
        } else if (chosen.href) {
          const fullHref = chosen.href.startsWith('http') ? chosen.href : `https://flow.google.com${chosen.href}`;
          await win.loadURL(fullHref);
        } else {
          await this.safeExecuteJs(
            win,
            `document.elementFromPoint(${chosen.x}, ${chosen.y})?.click()`,
            1000
          );
        }

        // Đợi project tải xong
        for (let i = 0; i < 15; i++) {
          if (isCancelled?.()) return { found: false };
          await new Promise((r) => setTimeout(r, 1000));
          const ready = await this.safeExecuteJs<boolean>(
            win,
            `Boolean(window.location.href.includes('/project/') && (document.querySelector('.ProseMirror, [contenteditable="true"], .prompt-input, flow-image-tile, flow-media-tile, flow-canvas, flow-prompt-box, .prompt-box-container') || document.querySelectorAll('button').length > 5))`,
            1500
          );
          if (ready) {
            const url = win.webContents?.getURL?.() || '';
            const m = url.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (m && m[1]) {
              this.currentProjectId = m[1];
            }
            console.log(`[Google Flow Browser] ✅ Resume thành công vào dự án: ${this.currentProjectId}`);
            return { found: true, projectId: this.currentProjectId || undefined };
          }
        }
      }
    } catch (err: any) {
      console.warn('[Google Flow Browser] ⚠️ Lỗi trong findAndOpenProjectByName:', err?.message || err);
    }

    return { found: false };
  }

  /**
   * Đảm bảo cửa sổ Flow đang ở đúng project context (theo URL hoặc mở mới)
   * - Nếu targetProjectId được truyền vào: Điều hướng/giữ nguyên đúng project đó.
   * - Nếu targetProjectId KHÔNG được truyền vào: Kiểm tra nếu cửa sổ đang ở trong một project hoặc có currentProjectId hợp lệ, tái sử dụng project đó.
   * - Nếu mở theo URL thất bại: Fallback tìm kiếm project theo tên đề tài trước khi tạo mới.
   * - Chỉ tạo project mới khi hoàn toàn chưa có dự án nào đang mở.
   */
  public async ensureProjectContext(
    win: any,
    targetProjectId?: string,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean,
    targetProjectName?: string
  ): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    const href = (await this.safeExecuteJs<string>(win, 'window.location.href', 2000)) || '';
    const currentUrl = href || win.webContents?.getURL?.() || '';

    // Quyết định projectId hiệu lực:
    // Bỏ qua nếu targetProjectId là ID cục bộ của AI Studio (bắt đầu bằng session_ hoặc proj_)
    const isLocalId = typeof targetProjectId === 'string' && (targetProjectId.startsWith('session_') || targetProjectId.startsWith('proj_') || targetProjectId.startsWith('default'));
    const safeTargetId = isLocalId ? undefined : targetProjectId;

    // 1. Kiểm tra nếu cửa sổ hiện tại đã ở trong một project Google Flow:
    const urlMatch = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
    if (urlMatch && urlMatch[1]) {
      const currentActiveId = urlMatch[1];
      if (safeTargetId && safeTargetId === currentActiveId) {
        this.currentProjectId = currentActiveId;
        console.log(`[Google Flow Browser] Đang ở đúng project Google Flow được chỉ định: ${currentActiveId}`);
        return true;
      }

      // Nếu KHÔNG có safeTargetId nhưng có targetProjectName cụ thể:
      // Phải kiểm tra xem project đang mở có thực sự khớp tên với targetProjectName không,
      // TRÁNH tái sử dụng nhầm project của đề tài trước đó!
      if (!safeTargetId && targetProjectName) {
        const currentProjectTitle = await this.safeExecuteJs<string>(
          win,
          `document.querySelector('input[aria-label*="project name" i], input[placeholder*="project name" i], input[aria-label*="Tên dự án" i], .project-title, header input')?.value || document.title || ''`,
          1000
        );
        const normCurrent = (currentProjectTitle || '').toLowerCase().trim();
        const normTarget = targetProjectName.toLowerCase().trim();
        if (normCurrent && (normCurrent.includes(normTarget) || normTarget.includes(normCurrent))) {
          this.currentProjectId = currentActiveId;
          console.log(`[Google Flow Browser] Project hiện tại khớp với tên "${targetProjectName}": ${currentActiveId}`);
          return true;
        }
        console.log(`[Google Flow Browser] ⚠️ Project hiện tại ("${currentProjectTitle}") không khớp tên "${targetProjectName}". Không tái sử dụng, sẽ tìm hoặc tạo mới.`);
      } else if (!safeTargetId && !targetProjectName) {
        this.currentProjectId = currentActiveId;
        console.log(`[Google Flow Browser] Tái sử dụng project hiện tại: ${currentActiveId}`);
        return true;
      }
    }

    const activeId = safeTargetId || this.currentProjectId;

    if (activeId) {
      this.currentProjectId = activeId;
      if (currentUrl.includes(`/project/${activeId}`)) {
        console.log(`[Google Flow Browser] Đã ở đúng project được chỉ định: ${activeId}`);
        return true;
      }
      onProgress?.(15, `Đang mở dự án ${activeId}...`);
      try {
        await win.loadURL(`https://flow.google.com/project/${activeId}`);
        for (let i = 0; i < 15; i++) {
          if (isCancelled?.()) return false;
          await new Promise((r) => setTimeout(r, 1000));
          const ready = await this.safeExecuteJs<boolean>(
            win,
            `Boolean(window.location.href.includes('/project/') && (document.querySelector('.ProseMirror, [contenteditable="true"], .prompt-input, flow-image-tile, flow-media-tile, flow-canvas, flow-prompt-box, .prompt-box-container') || document.querySelectorAll('button').length > 5))`,
            2000
          );
          if (ready) {
            console.log(`[Google Flow Browser] Đã tải xong project ${activeId} sau ${i + 1}s.`);
            return true;
          }
        }
      } catch {}
      console.warn(`[Google Flow Browser] ⚠️ Không mở được dự án ${activeId} trên Google Flow (có thể không tồn tại hoặc bị xóa).`);
      this.currentProjectId = null;

      // Ưu tiên 2 (Nhóm C): Fallback tìm lại project theo tên trước khi tạo mới!
      if (targetProjectName) {
        const fallbackRes = await this.findAndOpenProjectByName(win, targetProjectName, onProgress, isCancelled);
        if (fallbackRes.found) {
          return true;
        }
      }
    }

    // Trường hợp chưa có project hoặc mở project cũ thất bại -> Tạo project mới sạch sẽ
    return await this.createNewProject(win, onProgress, isCancelled, targetProjectName);
  }

  /**
   * Đồng bộ và thiết lập các thông số (Aspect Ratio, Output Count, Duration, Model)
   * trực tiếp vào Google Flow DOM (Prompt Box Settings Overlay, Settings Panel và LocalStorage).
   * Đảm bảo tính nhất quán 1:1 giữa cấu hình Node trong Workflow và kết quả sinh thực tế trên Google Flow.
   */
  public async configureGoogleFlowSettings(
    win: any,
    mode: 'image' | 'video',
    options: {
      outputCount?: number;
      aspectRatio?: string;
      durationSeconds?: number;
      modelVariant?: string;
      imageEngine?: string;
    }
  ): Promise<void> {
    if (!win || win.isDestroyed()) return;

    const count = Math.max(1, Math.min(4, Math.round(Number(options.outputCount || 1))));
    const aspect = (options.aspectRatio || '16:9').trim();

    // Chuẩn hóa thời lượng video theo 4 mức chuẩn của Google Flow Veo: 4, 6, 8, 10
    let duration = 4;
    if (mode === 'video') {
      const rawDur = Number(options.durationSeconds || 4);
      if (rawDur <= 5) duration = 4;
      else if (rawDur <= 7) duration = 6;
      else if (rawDur <= 9) duration = 8;
      else duration = 10;
    }

    console.log(`[Google Flow Browser] ⚙️ Đang áp dụng cấu hình Google Flow cho ${mode}: count=${count}, aspect=${aspect}${mode === 'video' ? `, duration=${duration}s` : ''}...`);

    // 1. Đồng bộ LocalStorage flow-prompt-box-settings làm lớp nền Idempotent redundancy
    try {
      await win.webContents.executeJavaScript(`
        (function() {
          try {
            const raw = localStorage.getItem('flow-prompt-box-settings');
            const settings = raw ? JSON.parse(raw) : {};
            settings.mode = ${JSON.stringify(mode.toUpperCase())};
            settings.Qp = ${count};
            const targetAspect = ${JSON.stringify(aspect)};
            if (${JSON.stringify(mode)} === 'video') {
              settings.AB = ${duration};
              settings.aspectRatio = targetAspect === '9:16' ? 'PORTRAIT' : 'LANDSCAPE';
            } else {
              if (targetAspect === '9:16') settings.aspectRatio = 'PORTRAIT';
              else if (targetAspect === '1:1') settings.aspectRatio = 'SQUARE';
              else if (targetAspect === '4:3') settings.aspectRatio = 'FOUR_THREE';
              else if (targetAspect === '3:4') settings.aspectRatio = 'THREE_FOUR';
              else settings.aspectRatio = 'LANDSCAPE';
            }
            localStorage.setItem('flow-prompt-box-settings', JSON.stringify(settings));
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'flow-prompt-box-settings',
              newValue: JSON.stringify(settings)
            }));
            return true;
          } catch (e) {
            return false;
          }
        })()
      `, true).catch(() => {});
    } catch {}

    // 2. Chuyển đổi Mode Tab (Image / Video) bằng FlowElementFinder
    try {
      const modeFinder = await FlowElementFinder.find(win, FlowElementFinder.getModeTabSpec(mode));
      if (modeFinder.found && modeFinder.selectedCandidate) {
        const c = modeFinder.selectedCandidate;
        const x = Math.round(c.rect.x + c.rect.width / 2);
        const y = Math.round(c.rect.y + c.rect.height / 2);
        console.log(`[Google Flow Settings] 🔘 Đã định vị Mode Tab [${mode}] qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
        if (this.isLobbyDebugVisible) {
          win.focus?.();
        }
        win.webContents?.focus?.();
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e: any) {
      console.warn('[Google Flow Settings] Gặp sự cố khi định vị Mode Tab:', e?.message || e);
    }

    // 3. Mở Settings Popover bằng FlowElementFinder
    let popoverOpened = false;
    try {
      const triggerFinder = await FlowElementFinder.find(win, FlowElementFinder.getSettingsTriggerSpec());
      if (triggerFinder.found && triggerFinder.selectedCandidate) {
        const c = triggerFinder.selectedCandidate;
        const x = Math.round(c.rect.x + c.rect.width / 2);
        const y = Math.round(c.rect.y + c.rect.height / 2);
        console.log(`[Google Flow Settings] ⚙️ Đã định vị Settings Trigger qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
        if (this.isLobbyDebugVisible) {
          win.focus?.();
        }
        win.webContents?.focus?.();
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        popoverOpened = true;
        await new Promise((r) => setTimeout(r, 450));
      }
    } catch (e: any) {
      console.warn('[Google Flow Settings] Gặp sự cố khi định vị Settings Trigger:', e?.message || e);
    }

    // 4. Nếu popover mở, tương tác với Mode (Image/Video), Aspect Ratio và Output Count
    if (popoverOpened) {
      // 4.0. Đồng bộ Mode (Hình ảnh / Video) ngay bên trong Popover
      try {
        const switchedMode = await this.safeExecuteJs<boolean>(
          win,
          `(function() {
            const pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
            if (!pane) return false;
            const isImage = ${JSON.stringify(mode === 'image')};
            const toggles = Array.from(pane.querySelectorAll('mat-button-toggle, [role="radio"], button'));
            for (const toggle of toggles) {
              const text = (toggle.innerText || toggle.textContent || '').toLowerCase();
              const matchesTarget = isImage
                ? (text.includes('hình ảnh') || text.includes('image'))
                : (text.includes('video') || text.includes('videocam'));
              if (matchesTarget) {
                const isChecked = toggle.classList.contains('mat-button-toggle-checked') || toggle.getAttribute('aria-checked') === 'true';
                if (!isChecked) {
                  const btn = toggle.tagName === 'BUTTON' ? toggle : (toggle.querySelector('button') || toggle);
                  btn.click();
                  return true;
                }
                return false;
              }
            }
            return false;
          })()`,
          1500
        );
        if (switchedMode) {
          console.log(`[Google Flow Settings] 🔘 Đã chuyển đổi thành công sang chế độ [${mode}] trong Settings Popover!`);
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (e: any) {
        console.warn('[Google Flow Settings] Gặp sự cố khi đồng bộ Mode trong Popover:', e?.message || e);
      }

      // A. Chọn Aspect Ratio qua FlowElementFinder
      try {
        const aspectFinder = await FlowElementFinder.find(win, FlowElementFinder.getAspectRatioSpec(aspect));
        if (aspectFinder.found && aspectFinder.selectedCandidate) {
          const c = aspectFinder.selectedCandidate;
          const x = Math.round(c.rect.x + c.rect.width / 2);
          const y = Math.round(c.rect.y + c.rect.height / 2);
          console.log(`[Google Flow Settings] 📐 Đã định vị Aspect Ratio [${aspect}] qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
          win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
          await new Promise((r) => setTimeout(r, 30));
          win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 40));
          win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch (e: any) {
        console.warn('[Google Flow Settings] Gặp sự cố khi định vị Aspect Ratio:', e?.message || e);
      }

      // B. Chọn Output Count qua FlowElementFinder
      try {
        const countFinder = await FlowElementFinder.find(win, FlowElementFinder.getOutputCountSpec(count));
        if (countFinder.found && countFinder.selectedCandidate) {
          const c = countFinder.selectedCandidate;
          const x = Math.round(c.rect.x + c.rect.width / 2);
          const y = Math.round(c.rect.y + c.rect.height / 2);
          console.log(`[Google Flow Settings] 🔢 Đã định vị Output Count [x${count}] qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
          win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
          await new Promise((r) => setTimeout(r, 30));
          win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 40));
          win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch (e: any) {
        console.warn('[Google Flow Settings] Gặp sự cố khi định vị Output Count:', e?.message || e);
      }

      // C. Đóng popover bằng cách click lại trigger button, backdrop hoặc Save button
      try {
        await this.safeExecuteJs(
          win,
          `(function() {
            const saveBtn = document.querySelector('button.settings-save-button') || Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Lưu');
            if (saveBtn) { saveBtn.click(); return 'clicked_save'; }
            const bd = document.querySelector('.cdk-overlay-backdrop');
            if (bd) { bd.click(); return 'clicked_backdrop'; }
            const trigger = document.querySelector('flow-prompt-box button.settings-trigger-button, flow-prompt-box button[aria-label*="Điều kiện kích hoạt" i]');
            if (trigger) { trigger.click(); return 'clicked_trigger'; }
          })()`,
          2000
        );
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await new Promise((r) => setTimeout(r, 200));
      } catch {}
    }
  }

    /**
   * Kích hoạt đọc và làm mới số dư Credit trong background (không block luồng chính).
   */
  public refreshCreditsInBackground(): void {
    setTimeout(async () => {
      try {
        await this.getCachedOrFreshCredits(0);
      } catch (e: any) {
        console.warn('[Google Flow Credits] Lỗi làm mới credit background:', e?.message || e);
      }
    }, 2000);
  }

  /**
   * Tải video chất lượng gốc 720p trực tiếp từ Video Viewer trên Google Flow thông qua Electron will-download.
   * Phương thức chuẩn xác nhất vượt qua giới hạn HTTP CDN authentication của Google.
   */
  public async downloadVideoViaViewer(win: any, destPath: string, timeoutMs = 60000): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    // 1. Mở video viewer nếu đang ở canvas
    await this.safeExecuteJs(
      win,
      `
      (function() {
        const isViewerOpen = Boolean(document.querySelector('button[aria-label*="Tải nội dung" i], button[aria-label*="Tải xuống" i], button[aria-label*="Download" i]'));
        if (!isViewerOpen) {
          const targetTile = document.querySelector('flow-video-tile:not([data-flow-existing])');
          if (targetTile) {
            targetTile.click();
          } else {
            const videoTiles = Array.from(document.querySelectorAll('flow-video-tile'));
            if (videoTiles.length > 0) {
              videoTiles[videoTiles.length - 1].click();
            }
          }
        }
      })()
    `,
      3000
    );
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Thiết lập will-download listener
    const downloadPromise = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Tải video quá hạn ${timeoutMs / 1000}s`)), timeoutMs);
      win.webContents.session.once('will-download', (event: any, item: any) => {
        console.log('[Google Flow Download] ⚡ Bắt được luồng tải video gốc:', item.getFilename(), `(${item.getTotalBytes()} bytes)`);
        item.setSavePath(destPath);
        item.once('done', (e: any, state: string) => {
          clearTimeout(timer);
          if (state === 'completed') {
            resolve(true);
          } else {
            reject(new Error(`Tải video kết thúc với trạng thái: ${state}`));
          }
        });
      });
    });

    // 3. Click nút Download -> chọn 720p (Kích thước gốc)
    const clickRes = await this.safeExecuteJs<boolean>(
      win,
      `
      (async function() {
        const btn = document.querySelector('button[aria-label*="Tải nội dung" i], button[aria-label*="Tải xuống" i], button[aria-label*="Download" i]');
        if (!btn) return false;
        btn.click();
        await new Promise(r => setTimeout(r, 600));
        const items = Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"], .mat-mdc-menu-item, button'));
        const targetOption = items.find(el => {
          const t = (el.innerText || el.textContent || '').toLowerCase();
          return t.includes('720p') || t.includes('kích thước gốc') || t.includes('original');
        });
        if (targetOption) {
          targetOption.click();
          return true;
        }
        return false;
      })()
    `,
      4000
    );

    if (!clickRes) {
      console.warn('[Google Flow Download] Không thể kích hoạt menu tải xuống 720p trong viewer.');
      return false;
    }

    const downloaded = await downloadPromise.catch((err) => {
      console.warn('[Google Flow Download] Lỗi tải video qua will-download:', err?.message || err);
      return false;
    });

    // 4. Quay lại màn hình canvas chính và đánh dấu tất cả video tile hiện có
    await this.safeExecuteJs(
      win,
      `
      (function() {
        const backBtn = document.querySelector('button[aria-label*="Xong" i], button[aria-label*="quay lại" i], button[aria-label*="back" i]');
        if (backBtn) backBtn.click();
        document.querySelectorAll('flow-video-tile').forEach(t => t.setAttribute('data-flow-existing', 'true'));
      })()
    `,
      2500
    );
    await new Promise((r) => setTimeout(r, 1200));

    // 5. Xác thực tính toàn vẹn của file
    if (downloaded) {
      try {
        const { FlowMediaVerifier } = await import('../workflow/flow-engine/FlowMediaVerifier');
        const verification = await FlowMediaVerifier.verifyFile(destPath, { expectedType: 'video' });
        return verification.isValid;
      } catch {
        return true;
      }
    }

    return false;
  }

  /**
   * Sinh video trực tiếp trên trình duyệt Google Flow thông qua FlowStateMachine 18 bước chuyên biệt.
   * Kế thừa toàn bộ tính năng của Flow Engine:
   * - 18 States chuyên biệt cho Video & Image-to-Video
   * - Self-Healing Element Finder & Smart Wait
   * - Idempotency Guard & State Verification
   * - Chống trùng lặp qua data-flow-existing tagging
   * - Khôi phục lỗi & Phân loại mã lỗi chuẩn
   */
  async generateVideoViaBrowserContext(
    params: {
      prompt: string;
      initFrameUrl?: string;
      aspectRatio?: string;
      durationSeconds?: number;
      modelVariant?: string;
      outputCount?: number;
      projectId?: string;
      taskId?: string;
      generationAttemptId?: string;
      retryIndex?: number;
      shotBaselineUrls?: Set<string>;
      shotStartedAt?: number;
    },
    onProgress?: (percent: number, msg?: string) => void,
    isCancelled?: () => boolean
  ): Promise<{
    videoUrl?: string;
    base64Data?: string;
    projectId?: string;
    error?: 'out_of_credits' | 'timeout' | 'button_not_found' | 'agent_error' | string;
    errorDetail?: string;
  } | null> {
    const taskId = params.taskId || `task_vid_${Date.now()}`;
    const generationAttemptId = params.generationAttemptId || `att_${Math.random().toString(36).slice(2, 7)}`;

    onProgress?.(5, 'Đang chuẩn bị Sảnh Google Flow cho Video...');

    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected() && (!this.lobbyWindow || this.lobbyWindow.isDestroyed())) {
      try {
        const rpcClient = getGoogleFlowRpcClient();
        const targetPid = params.projectId || this.currentProjectId || '';
        const genRes = await rpcClient.generateVideo({
          prompt: params.prompt,
          inputImageAsset: params.initFrameUrl,
          aspectRatio: params.aspectRatio || '16:9',
          duration: params.durationSeconds || 8,
          videoModel: params.modelVariant,
          projectId: targetPid,
        });
        const resolvedPid = genRes.projectId || targetPid;
        if (resolvedPid && resolvedPid !== '__PROJECT_ID_SLOT__') {
          this.currentProjectId = resolvedPid;
        }
        if (genRes.done && genRes.videoUrl) {
          return {
            videoUrl: genRes.videoUrl,
            projectId: resolvedPid || undefined,
          };
        }
        if (genRes.operationId) {
          const pollRes = await rpcClient.pollGeneration({
            operationId: genRes.operationId,
            projectId: resolvedPid,
            onProgress: (p: any) => onProgress?.(p.percentage, p.message),
            isCancelled,
          });
          return {
            videoUrl: pollRes.videoUrl,
            projectId: resolvedPid || undefined,
          };
        }
      } catch (bridgeErr: any) {
        return {
          error: bridgeErr?.code || 'agent_error',
          errorDetail: bridgeErr?.message || String(bridgeErr),
        };
      }
    }

    const ready = await this.ensureLobbyAtFlow();
    if (!ready) {
      console.warn('[Google Flow Browser] Sảnh Google Flow chưa sẵn sàng (chưa đăng nhập hoặc cửa sổ đã đóng).');
      return null;
    }

    const win = this.lobbyWindow;
    if (!win || win.isDestroyed()) return null;

    let electron: any;
    try {
      electron = require('electron');
    } catch {
      return null;
    }

    const fsm = new FlowStateMachine(FlowVideoGenerationStatePipeline);
    const ctx: FlowStateContext = {
      taskId,
      generationAttemptId,
      retryIndex: params.retryIndex,
      shotBaselineUrls: params.shotBaselineUrls,
      shotStartedAt: params.shotStartedAt,
      mode: 'video',
      win,
      sessionMgr: this,
      prompt: params.prompt,
      initFrameUrl: params.initFrameUrl,
      aspectRatio: params.aspectRatio || '16:9',
      durationSeconds: params.durationSeconds || 4,
      outputCount: params.outputCount || 1,
      modelVariant: params.modelVariant || 'omni-flash',
      targetProjectId: params.projectId,
      onProgress,
      isCancelled,
      generationState: 'IDLE',
      baselineUrls: new Set(),
      capturedMediaUrl: null,
      capturedBase64: null,
      generateClickedAt: 0,
      netFilterAttached: false,
      stateHistory: [],
    };
    (ctx as any).electron = electron;

    const res = await fsm.run(ctx);

    // Kích hoạt làm mới credit bất đồng bộ sau mỗi lượt sinh
    this.refreshCreditsInBackground();

    if (!res.ok) {
      if (res.error === 'out_of_credits' || res.classifiedErrorCode === 'OUT_OF_CREDITS') {
        SettingsStore.set('veoSessionStatus', 'out_of_credits');
        SettingsStore.set('veoFlowCredits', 0);
        SettingsStore.set('veoFlowCreditsCheckedAt', Date.now());
      }
      return {
        error: (res.classifiedErrorCode as any) || (res.error as any) || 'unknown_failure',
        errorDetail: res.errorDetail,
      };
    }

    let pid = res.projectId || params.projectId || this.currentProjectId;
    try {
      const curUrl = win.webContents?.getURL?.() || '';
      const match = curUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) pid = match[1];
    } catch {}

    if (pid) {
      this.currentProjectId = pid;
    }

    return {
      videoUrl: res.videoUrl,
      base64Data: res.base64Data,
      projectId: pid || undefined,
    };
  }

/**
   * Sinh ảnh trực tiếp trên trình duyệt Google Flow thông qua State Machine Engine.
   * Chạy qua chuỗi State Machine chuẩn:
   * OPEN_FLOW -> WAIT_FOR_PAGE_READY -> VERIFY_SESSION -> ENSURE_PROJECT_CONTEXT
   * -> CLEAN_CANVAS -> FIND_EDITOR -> FIND_PROMPT_INPUT -> ENTER_PROMPT
   * -> CONFIGURE_OPTIONS -> CAPTURE_BASELINE -> FIND_GENERATE_BUTTON
   * -> VERIFY_GENERATE_BUTTON -> CHECK_IDEMPOTENCY_BEFORE_GENERATE -> CLICK_GENERATE
   * -> VERIFY_GENERATION_STARTED -> WAIT_FOR_GENERATION -> VERIFY_GENERATION_COMPLETED
   * -> EXTRACT_OUTPUT
   *
   * Đảm bảo:
   * 1. Mỗi state có enter(), execute(), verify() chặt chẽ.
   * 2. Bắt buộc tính lại getBoundingClientRect() tức thời ngay trước khi gửi sendInputEvent.
   * 3. Idempotency Guard: phát hiện nếu generation đã chạy thì không click lại, chuyển thẳng sang chờ kết quả.
   */
  async generateImageViaBrowserContext(
    params: {
      prompt: string;
      aspectRatio?: string;
      outputCount?: number;
      imageEngine?: string;
      projectId?: string;
      projectName?: string;
      flowAssetUrl?: string;
      taskId?: string;
      generationAttemptId?: string;
      referenceImagePath?: string;
      retryIndex?: number;
      shotBaselineUrls?: Set<string>;
      shotStartedAt?: number;
    },
    onProgress?: (pct: number, msg?: string) => void,
    isCancelled?: () => boolean
  ): Promise<{ imageUrl?: string; base64Data?: string; projectId?: string; flowAssetUrl?: string; error?: 'out_of_credits' | 'timeout' | 'button_not_found' | 'agent_error' | string; errorDetail?: string; } | null> {
    const taskId = params.taskId || `task_img_${Date.now()}`;
    const generationAttemptId = params.generationAttemptId || `att_${Math.random().toString(36).slice(2, 7)}`;

    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected() && (!this.lobbyWindow || this.lobbyWindow.isDestroyed())) {
      try {
        const rpcClient = getGoogleFlowRpcClient();
        const targetPid = params.projectId || this.currentProjectId || '';
        const genRes = await rpcClient.generateImage(null, {
          prompt: params.prompt,
          aspectRatio: params.aspectRatio || '16:9',
          outputCount: params.outputCount || 1,
          imageModel: params.imageEngine,
          projectId: targetPid,
          referenceMediaIds: params.referenceImagePath ? [params.referenceImagePath] : undefined,
        });
        const resolvedPid = genRes.projectId || targetPid;
        if (resolvedPid && resolvedPid !== '__PROJECT_ID_SLOT__') {
          this.currentProjectId = resolvedPid;
        }
        const imgUrl = genRes.firstImageUrl || genRes.images?.[0]?.url;
        if (imgUrl) {
          return {
            imageUrl: imgUrl,
            projectId: resolvedPid || undefined,
          };
        }
      } catch (bridgeErr: any) {
        return {
          error: bridgeErr?.code || 'agent_error',
          errorDetail: bridgeErr?.message || String(bridgeErr),
        };
      }
    }

    // Đảm bảo lobby window sẵn sàng trước khi nạp context
    const ready = await this.ensureLobbyAtFlow();
    if (!ready) {
      console.warn('[Google Flow Browser] Sảnh Google Flow chưa sẵn sàng.');
      return null;
    }

    let electron: any = null;
    try {
      electron = require('electron');
    } catch {}

    const fsm = new FlowStateMachine(FlowImageGenerationStatePipeline);
    const ctx: FlowStateContext = {
      taskId,
      generationAttemptId,
      retryIndex: params.retryIndex,
      shotBaselineUrls: params.shotBaselineUrls,
      shotStartedAt: params.shotStartedAt,
      mode: 'image',
      win: this.lobbyWindow,
      sessionMgr: this,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio || '16:9',
      outputCount: params.outputCount || 1,
      imageEngine: params.imageEngine || 'nano-banana',
      targetProjectId: params.projectId,
      targetProjectName: params.projectName,
      flowAssetUrl: params.flowAssetUrl,
      referenceImagePath: params.referenceImagePath,
      onProgress,
      isCancelled,
      generationState: 'IDLE',
      baselineUrls: new Set(),
      capturedMediaUrl: null,
      capturedBase64: null,
      generateClickedAt: 0,
      netFilterAttached: false,
      stateHistory: [],
    };
    (ctx as any).electron = electron;

    const res = await fsm.run(ctx);

    // Kích hoạt làm mới credit bất đồng bộ sau mỗi lượt sinh ảnh
    this.refreshCreditsInBackground();

    if (!res.ok) {
      if (res.error === 'out_of_credits' || res.classifiedErrorCode === 'OUT_OF_CREDITS') {
        SettingsStore.set('veoSessionStatus', 'out_of_credits');
        SettingsStore.set('veoFlowCredits', 0);
        SettingsStore.set('veoFlowCreditsCheckedAt', Date.now());
      }
      return {
        error: (res.classifiedErrorCode as any) || (res.error as any) || 'unknown_failure',
        errorDetail: res.errorDetail,
      };
    }

    return {
      imageUrl: res.imageUrl,
      base64Data: res.base64Data,
      projectId: res.projectId,
      flowAssetUrl: ctx.flowAssetUrl || (res as any)?.flowAssetUrl || (res as any)?.data?.flowAssetUrl,
    };
  }

  /**
   * Tự động kiểm tra và nhấn nút xác nhận tạo nội dung của Tác nhân (Creative Agent Permission).
   * Giúp workflow tự động chạy tiếp mà không cần người dùng phải bấm tay vào tab tác nhân.
   * Đồng thời phát hiện sớm nếu Tác nhân báo lỗi ("Tác nhân đã gặp lỗi. Hãy thử lại.") để dừng ngay, không bị treo.
   */
  public async autoConfirmAgentPermission(win: any): Promise<string> {
    if (!win || win.isDestroyed()) return 'none';

    // Cooldown 4 giây giữa các lần click xác nhận thành công
    const now = Date.now();
    const isCoolingDown = now - this.lastPermissionConfirmedAt < 4000;

    const autoConfirmJs = `
      (async function(skipAction) {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (el.offsetParent === null && style.position !== 'fixed') return false;
          return true;
        }

        // 0. Kiểm tra thông báo lỗi của Creative Agent / Tác nhân gặp lỗi (ưu tiên số 1)
        const bodyText = (document.body.innerText || '').toLowerCase();
        if (
          bodyText.includes('tác nhân đã gặp lỗi') ||
          bodyText.includes('tác nhân đã gặp sự cố') ||
          bodyText.includes('agent encountered an error') ||
          bodyText.includes('creative agent encountered an error') ||
          bodyText.includes('failed to generate')
        ) {
          return JSON.stringify({ status: 'agent_error: Tác nhân đã gặp lỗi. Hãy thử lại.' });
        }

        if (skipAction) return JSON.stringify({ status: 'none' });

        // 1. Kiểm tra permission message của Creative Agent
        const allRadios = Array.from(document.querySelectorAll(
          'flow-permission-message [role="radio"], flow-permission-message .option-row, flow-permission-message mat-radio-button, [role="radiogroup"] [role="radio"]'
        ));

        function isChecked(r) {
          if (!r) return false;
          if (r.getAttribute('aria-checked') === 'true') return true;
          if (r.checked) return true;
          if (r.classList.contains('mat-radio-checked') || r.classList.contains('selected')) return true;
          if (r.querySelector('[aria-checked="true"], .mat-radio-checked, input:checked')) return true;
          return false;
        }

        // Lọc các radio đang hiển thị và KHÔNG ở trạng thái read-only / disabled
        // Loại bỏ triệt để các tùy chọn về upload / tải ảnh từ thiết bị
        const permRadios = allRadios.filter(r => {
          if (!isVisible(r)) return false;
          if (r.classList.contains('read-only') || r.getAttribute('aria-disabled') === 'true') return false;
          const label = (r.getAttribute('aria-label') || r.innerText || r.textContent || '').toLowerCase();
          if (label.includes('tải') || label.includes('upload') || label.includes('thiết bị') || label.includes('device') || label.includes('tập tin') || label.includes('file')) return false;
          return true;
        });

        // Nếu đã có radio hợp lệ được chọn, không click lại để tránh lặp vô tận, nhường cho bước 2 bấm nút xác nhận
        const alreadyChecked = permRadios.find(isChecked);
        let targetRadio = null;

        if (!alreadyChecked && permRadios.length > 0) {
          // Ưu tiên chọn option "Luôn luôn phê duyệt" / "Luôn cho phép" nếu có
          const alwaysRadio = permRadios.find(r => {
            const label = (r.getAttribute('aria-label') || r.innerText || r.textContent || '').toLowerCase();
            return label.includes('luôn') || label.includes('always');
          });
          targetRadio = alwaysRadio || (permRadios.length > 1 ? permRadios[1] : permRadios[0]);
        }

        if (targetRadio) {
          // Bắt buộc cuộn radio vào chính giữa màn hình trước khi click để tọa độ luôn nằm trong viewport
          targetRadio.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          await new Promise(r => setTimeout(r, 60));

          const rect = targetRadio.getBoundingClientRect();
          const coords = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };

          // Kích hoạt đầy đủ chuỗi sự kiện chuột trong DOM
          try {
            targetRadio.focus();
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
              targetRadio.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
            });
            targetRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) {}

          return JSON.stringify({
            status: 'clicked_permission_radio',
            coords,
            label: targetRadio.getAttribute('aria-label') || targetRadio.innerText
          });
        }

        // 2. Kiểm tra các nút bấm xác nhận hành động trong flow-permission-message, dialog
        const buttons = Array.from(document.querySelectorAll(
          'flow-permission-message button, flow-confirmation-dialog button, mat-dialog-container button, .agree-actions-group button, flow-agent-panel button, button[aria-label*="Confirm" i], button[aria-label*="Phê duyệt" i]'
        )).filter(isVisible);

        const actionBtn = buttons.find(b => {
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
          // Loại bỏ các suggestion chips / quick replies
          if (b.classList.contains('suggestion-chip') || b.classList.contains('suggestion-card') || b.classList.contains('flow-chip') || b.closest('flow-suggestion-list, .suggestions, .chips-container')) {
            return false;
          }
          const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isNegative = txt.includes('hủy') || txt.includes('cancel') || txt.includes('không') || txt.includes('close') || txt.includes('từ chối') || txt.includes('đóng');
          if (isNegative) return false;

          const isPermContainer = b.closest('flow-permission-message, flow-confirmation-dialog, .agree-actions-group, mat-dialog-container');
          if (isPermContainer) {
            return (
              txt.includes('xác nhận') ||
              txt.includes('cho phép') ||
              txt.includes('phê duyệt') ||
              txt.includes('đồng ý') ||
              txt.includes('tạo') ||
              txt.includes('generate') ||
              txt.includes('confirm') ||
              txt.includes('allow') ||
              txt.includes('agree') ||
              txt.includes('proceed')
            );
          }

          return (
            txt.includes('xác nhận') ||
            txt.includes('cho phép') ||
            txt.includes('phê duyệt') ||
            txt.includes('đồng ý') ||
            txt.includes('confirm') ||
            txt.includes('proceed')
          );
        });

        if (actionBtn) {
          actionBtn.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          await new Promise(r => setTimeout(r, 60));
          const rect = actionBtn.getBoundingClientRect();
          const coords = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };

          try {
            actionBtn.focus();
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
              actionBtn.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
            });
          } catch (e) {}

          return JSON.stringify({
            status: 'clicked_action_button',
            coords,
            label: (actionBtn.innerText || actionBtn.getAttribute('aria-label') || '').trim()
          });
        }

        return JSON.stringify({ status: 'none' });
      })(${isCoolingDown})
    `;

    try {
      const rawRes = await this.safeExecuteJs<string>(win, autoConfirmJs, 2500);
      const res = rawRes ? (typeof rawRes === 'object' ? rawRes : JSON.parse(rawRes)) : null;

      if (res && res.status !== 'none') {
        if (res.status.startsWith('agent_error:')) {
          console.error('[Google Flow Browser] ❌ Phát hiện sự cố Tác nhân Google Flow:', res.status);
          return res.status;
        }

        // Gửi click chuột thật cấp OS tới toạ độ của phần tử (bảo đảm click 100% trúng đích)
        if (res.coords && res.coords.x > 0 && res.coords.y > 0 && !win.isDestroyed()) {
          try {
            if (this.isLobbyDebugVisible) {
              if (win.isMinimized()) win.restore();
              win.focus();
            } else {
              win.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
            }
            win.webContents?.focus?.();
            win.webContents.sendInputEvent({
              type: 'mouseDown',
              x: res.coords.x,
              y: res.coords.y,
              button: 'left',
              clickCount: 1,
            });
            await new Promise((r) => setTimeout(r, 50));
            win.webContents.sendInputEvent({
              type: 'mouseUp',
              x: res.coords.x,
              y: res.coords.y,
              button: 'left',
              clickCount: 1,
            });
            await new Promise((r) => setTimeout(r, 150));
          } catch {}
        }

        this.lastPermissionConfirmedAt = Date.now();
        console.log(`[Google Flow Browser] 👉 Đã tự động nhấn nút xác nhận tạo nội dung của Tác nhân (${res.label || res.status}) tại (${res.coords?.x}, ${res.coords?.y})`);
        return res.status;
      }
    } catch {}
    return 'none';
  }

  /**
   * Dọn sạch canvas và chuẩn bị ô soạn thảo prompt về trạng thái sẵn sàng trước mỗi lượt generate.
   * Bắt buộc chạy trước mỗi lượt sinh (đặc biệt quan trọng khi 2 node chạy nối tiếp qua Mutex).
   * 1. Kiểm tra bằng JS xem có đang tồn tại preview/overlay của kết quả vừa sinh hay không.
   * 2. Nếu phát hiện, gửi phím Escape và đợi overlay đóng lại.
   * 3. Xác nhận lại rằng ô prompt (ProseMirror/contenteditable) đang thực sự trống, có nút Generate và có thể focus được.
   * 4. Nếu sau bước dọn dẹp vẫn không sẵn sàng, thử tạo New Project sạch sẽ làm dự phòng (tuyệt đối không click flow-project-card).
   */
  public async ensureCleanCanvasReady(
    win: any,
    mode: 'image' | 'video',
    onProgress?: (percent: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    // 1. Kiểm tra bằng JS xem có đang tồn tại preview / overlay của kết quả vừa sinh không
    const checkOverlayJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const overlaySelectors = [
          'flow-media-viewer', '.media-viewer-container', '.lightbox-overlay', 'flow-lightbox',
          'flow-full-screen-preview', '.media-preview-expanded'
        ];

        for (const sel of overlaySelectors) {
          const els = Array.from(document.querySelectorAll(sel));
          if (els.some(isVisible)) return true;
        }
        return false;
      })()
    `;

    const hasOverlay = await this.safeExecuteJs<boolean>(win, checkOverlayJs, 2000);
    if (hasOverlay) {
      console.log('[Google Flow Browser] 🧹 Phát hiện overlay/media-viewer mở, gửi Escape để đóng lại...');
      try {
        await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        await new Promise((r) => setTimeout(r, 50));
        await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      } catch {}

      // Thử tìm nút đóng qua FlowElementFinder nếu Escape chưa đóng được
      try {
        const closeFinder = await FlowElementFinder.find(win, FlowElementFinder.getCloseOverlaySpec());
        if (closeFinder.found && closeFinder.selectedCandidate) {
          const c = closeFinder.selectedCandidate;
          const cx = Math.round(c.rect.x + c.rect.width / 2);
          const cy = Math.round(c.rect.y + c.rect.height / 2);
          console.log(`[Google Flow Browser] 🧹 Đã tìm thấy nút đóng overlay qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${cx}, ${cy})`);
          win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 40));
          win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
        }
      } catch {}

      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const stillOverlay = await this.safeExecuteJs<boolean>(win, checkOverlayJs, 500);
        if (!stillOverlay) break;
      }
    }

    if (isCancelled?.()) return false;

    // 2. Xác nhận và làm sạch ô soạn thảo prompt (ProseMirror / contenteditable)
    const cleanAndCheckPromptJs = `
      (async function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const inProject = window.location.href.includes('/project/');
        if (!inProject) return { ready: false, hasPrompt: false, reason: 'not_in_project' };

        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box');
        const selectors = [
          'flow-rich-text-editor .ProseMirror',
          '.prosemirror-editor .ProseMirror',
          '.ProseMirror',
          '[contenteditable="true"]',
          'textarea:not(.g-recaptcha-response)',
          'input[type="text"]'
        ];
        let promptEl = null;
        for (const sel of selectors) {
          const el = promptBox ? promptBox.querySelector(sel) : document.querySelector(sel);
          if (el && isVisible(el)) {
            promptEl = el;
            break;
          }
        }

        if (!promptEl) return { ready: false, hasPrompt: false, reason: 'no_prompt_el' };

        // A. Xóa bỏ triệt để các thẻ chip ảnh cũ (flow-image-ingredient-chip) còn sót lại từ lượt trước
        let removedChipsCount = 0;
        const chipContainer = promptBox || document;
        const chipSelectors = [
          'flow-image-ingredient-chip',
          '.chip-container',
          '.chip-image-wrapper',
          'mat-chip-row',
          'mat-chip'
        ];
        const chips = Array.from(chipContainer.querySelectorAll(chipSelectors.join(', ')));
        for (const chip of chips) {
          try {
            // 1. Thử click nút xoá trên chip
            const removeBtn = chip.querySelector(
              'button[aria-label*="Xóa" i], button[aria-label*="Remove" i], button[aria-label*="Delete" i], button.remove-button, .mat-mdc-chip-remove, button'
            );
            if (removeBtn) {
              removeBtn.click();
              removedChipsCount++;
            } else {
              // 2. Fallback xoá node khỏi DOM và phát sự kiện
              chip.remove();
              removedChipsCount++;
            }
          } catch (e) {}
        }
        if (removedChipsCount > 0) {
          promptBox?.dispatchEvent(new Event('input', { bubbles: true }));
          promptBox?.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // B. Xóa sạch nội dung text cũ nếu còn sót lại từ lượt trước bằng DOM Range (không dùng clipboard OS)
        let currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        if (currentText.length > 0) {
          try {
            promptEl.focus();
            if (promptEl.isContentEditable) {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(promptEl);
              sel?.removeAllRanges();
              sel?.addRange(range);
              document.execCommand('delete', false, null);
              promptEl.dispatchEvent(new Event('input', { bubbles: true }));
              promptEl.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (promptEl.value !== undefined) {
              promptEl.value = '';
              promptEl.dispatchEvent(new Event('input', { bubbles: true }));
              promptEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } catch (e) {}
        }

        // C. Kiểm tra còn chip ảnh nào sót lại không
        const remainingChips = Array.from(
          chipContainer.querySelectorAll('flow-image-ingredient-chip, .chip-container, .chip-image-wrapper')
        ).filter(isVisible);

        // Kiểm tra nhanh sự hiện diện của ô prompt và nút Generate
        const genBtn = document.querySelector(
          'flow-generate-icon-button button, button.generate-icon-button, button[type="submit"], [aria-label*="tạo" i], [aria-label*="generate" i]'
        );
        const hasGenBtn = Boolean(genBtn && isVisible(genBtn));

        promptEl.focus();
        currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        const rect = promptEl.getBoundingClientRect();
        const canFocus = rect && rect.width > 0 && rect.height > 0;

        return {
          ready: Boolean(canFocus && remainingChips.length === 0),
          hasPrompt: true,
          hasGenBtn,
          coords: canFocus ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) } : null,
          textLen: currentText.length,
          removedChipsCount,
          remainingChipsCount: remainingChips.length
        };
      })()
    `;

    let cleanResult = await this.safeExecuteJs<any>(win, cleanAndCheckPromptJs, 3000);
    console.log('[Google Flow Browser] Trạng thái dọn dẹp canvas:', cleanResult);

    // Nếu ô prompt đã sẵn sàng, click chuột thật vào ô prompt để bảo đảm tiêu điểm
    if (cleanResult?.ready && cleanResult?.coords && !win.isDestroyed()) {
      try {
        if (this.isLobbyDebugVisible) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        } else {
          win.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
        }
        win.webContents?.focus?.();
        win.webContents.sendInputEvent({
          type: 'mouseDown',
          x: cleanResult.coords.x,
          y: cleanResult.coords.y,
          button: 'left',
          clickCount: 1
        });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({
          type: 'mouseUp',
          x: cleanResult.coords.x,
          y: cleanResult.coords.y,
          button: 'left',
          clickCount: 1
        });
        await new Promise((r) => setTimeout(r, 150));
      } catch {}
      return true;
    }

    // 3. Nếu đang trong một project hợp lệ: TUYỆT ĐỐI KHÔNG TẠO MỚI ĐỂ TRÁNH MẤT PROJECT & ẢNH ĐANG CÓ
    const currentUrl = win.webContents?.getURL?.() || '';
    if (currentUrl.includes('/project/')) {
      console.log('[Google Flow Browser] Đang ở trong project, bảo toàn project context.');
      return true;
    }

    // Chỉ tạo new project khi chưa mở project nào (đang ở ngoài flow.google.com trang chủ)
    console.log('[Google Flow Browser] Chưa ở trong project nào, đang tạo dự án mới...');
    const newProjOk = await this.createNewProject(win, onProgress, isCancelled);
    if (!newProjOk) return false;

    const finalCheck = await this.safeExecuteJs<any>(win, cleanAndCheckPromptJs, 3000);
    return Boolean(finalCheck?.ready);
  }

  /** Kéo lobby window về vị trí bình thường trên màn hình chính để người dùng theo dõi hoặc debug bằng mắt */
  public async showLobbyForDebug(): Promise<boolean> {
    this.isLobbyDebugVisible = true;
    if (!this.lobbyWindow || this.lobbyWindow.isDestroyed()) {
      try {
        await this.openLobbyWindow();
      } catch (err) {
        console.warn('[GoogleVeoSessionManager] Failed to open lobby window for debug:', err);
      }
    }
    if (this.lobbyWindow && !this.lobbyWindow.isDestroyed()) {
      this.lobbyWindow.setSize(1440, 900);
      this.lobbyWindow.setPosition(100, 60);
      try {
        this.lobbyWindow.webContents?.setZoomFactor(1.0);
      } catch {}
      this.lobbyWindow.show();
      this.lobbyWindow.focus();
      return true;
    }
    return false;
  }

  /** Đưa lobby window trở lại vị trí ẩn ngoài màn hình sau khi debug xong */
  public hideLobbyOffscreen(): boolean {
    this.isLobbyDebugVisible = false;
    if (!this.lobbyWindow || this.lobbyWindow.isDestroyed()) return false;
    this.lobbyWindow.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
    return true;
  }

  /** Kiểm tra trạng thái hiển thị debug của lobby window */
  public isLobbyDebug(): boolean {
    return this.isLobbyDebugVisible && Boolean(this.lobbyWindow && !this.lobbyWindow.isDestroyed());
  }

  /** Lấy tham chiếu tới lobby window hiện tại */
  public getLobbyWindow(): any {
    return this.lobbyWindow;
  }

  /**
   * Tự động phục hồi phiên làm việc khi phát hiện redirect sang /about hoặc thiếu token (Self-Healing Session).
   * 1. Nạp lại cookies từ SettingsStore vào partition persist:google_veo.
   * 2. Điều hướng lại về URL dự án hợp lệ https://flow.google.com/project/<id> (hoặc https://flow.google.com/).
   * 3. Chờ trang nạp xong DOM/WIZ_global_data.
   * 4. Nếu vẫn dừng ở trang đăng nhập Google hoặc /about (yêu cầu người dùng can thiệp):
   *    -> Tự động đưa cửa sổ Sảnh ra màn hình (showLobbyForDebug) và thông báo cần re-auth.
   */
  public async recoverSessionOnRedirect(
    win?: any,
    targetProjectId?: string
  ): Promise<{ success: boolean; requiresUserInteraction: boolean; currentUrl: string }> {
    console.log('[GoogleVeoSessionManager] 🩺 Bắt đầu quy trình tự phục hồi phiên làm việc (Session Self-Healing)...');
    let targetWin = win || this.lobbyWindow;
    if (!targetWin || targetWin.isDestroyed?.()) {
      try {
        await this.openLobbyWindow({ uiMode: 'offscreen' });
        targetWin = this.lobbyWindow;
      } catch (err) {
        console.warn('[GoogleVeoSessionManager] Không thể mở lobbyWindow để phục hồi session:', err);
      }
    }

    if (!targetWin || targetWin.isDestroyed?.()) {
      return { success: false, requiresUserInteraction: true, currentUrl: '' };
    }

    try {
      // 1. Nạp lại cookies sạch từ SettingsStore vào partition
      let electron: any = null;
      try {
        electron = require('electron');
      } catch {}
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        const restoredCount = await this.restoreCookiesToPartition(ses);
        console.log(`[GoogleVeoSessionManager] 🩺 Đã nạp lại ${restoredCount} cookies từ SettingsStore.`);
      }

      // 2. Xác định URL mục tiêu
      let projectUrl = 'https://flow.google.com/';
      const cleanProjId = (targetProjectId && targetProjectId !== '00000000-0000-0000-0000-000000000000') ? targetProjectId.trim() : '';
      if (cleanProjId) {
        projectUrl = `https://flow.google.com/project/${cleanProjId}`;
      } else {
        const storedProjUrl = SettingsStore.get('flowProjectUrl')?.trim();
        if (storedProjUrl && storedProjUrl.includes('/project/')) {
          projectUrl = storedProjUrl;
        }
      }

      console.log(`[GoogleVeoSessionManager] 🩺 Điều hướng lại cửa sổ Sảnh về: ${projectUrl}`);
      try {
        await targetWin.loadURL(projectUrl);
      } catch (navErr) {
        console.warn('[GoogleVeoSessionManager] loadURL warning during session recovery:', navErr);
      }

      // Chờ 2.5s để Angular WIZ nạp lại context và WIZ_global_data
      await new Promise((r) => setTimeout(r, 2500));

      const afterUrl = (targetWin.webContents?.getURL?.() || '').toLowerCase();
      console.log(`[GoogleVeoSessionManager] 🩺 URL sau khi nạp lại: ${afterUrl}`);

      // 3. Kiểm tra xem có bị chuyển hướng sang login hoặc /about hay không
      const isLoginOrAbout =
        afterUrl.includes('accounts.google.com') ||
        afterUrl.includes('flow.google.com/about') ||
        afterUrl.includes('servicelogin');

      if (isLoginOrAbout) {
        console.warn('[GoogleVeoSessionManager] ⚠️ Phiên cần người dùng đăng nhập lại hoặc giải CAPTCHA. Đang đưa Sảnh ra màn hình...');
        await this.showLobbyForDebug();
        return {
          success: false,
          requiresUserInteraction: true,
          currentUrl: afterUrl,
        };
      }

      console.log('[GoogleVeoSessionManager] ✅ Phục hồi phiên làm việc thành công!');
      return {
        success: true,
        requiresUserInteraction: false,
        currentUrl: afterUrl,
      };
    } catch (err: any) {
      console.error('[GoogleVeoSessionManager] ❌ Lỗi trong quy trình recoverSessionOnRedirect:', err);
      return {
        success: false,
        requiresUserInteraction: true,
        currentUrl: targetWin.webContents?.getURL?.() || '',
      };
    }
  }
}


