/**
 * Vanhsub AI Video Studio - Gemini Web Session & Automation Manager
 *
 * Provides Zero-API-Cost script generation by automating Gemini Web (gemini.google.com)
 * inside an isolated, persistent Electron session partition:
 * - Session partition: 'persist:gemini_session' (Google cookies & login preserved indefinitely)
 * - Headless/Offscreen execution OR Live Window (user can watch AI typing)
 * - Keeps the platform browser identity; authentication is user-driven.
 * - Self-healing DOM interaction for Gemini rich-textarea and Quill contenteditable
 * - Multi-turn conversation chunking (similar to Revo Studio economy mode)
 */

import { BrowserWindow, session, type WebContents } from 'electron';
import type { ScriptBeatLine, IdeaBlueprint, ChannelProfileConfig } from '../types';
import {
  parseChatGptScriptResponse,
  buildScriptPromptForWeb,
  calculateScriptPacingMetrics,
} from '../chatgpt/ChatGptWebSessionManager';

const GEMINI_HOME_URL = 'https://gemini.google.com/app';
const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GOOGLE_AUTH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

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

export interface GeminiLoginStatus {
  isLoggedIn: boolean;
  userEmail?: string;
  sessionCheckedAt: number;
}

export class GeminiWebSessionManager {
  private static instance: GeminiWebSessionManager | null = null;
  private browserWindow: BrowserWindow | null = null;
  private isOffscreen = true;
  private isBusy = false;

  private constructor() {}

  public static getInstance(): GeminiWebSessionManager {
    if (!GeminiWebSessionManager.instance) {
      GeminiWebSessionManager.instance = new GeminiWebSessionManager();
    }
    return GeminiWebSessionManager.instance;
  }

  /** Get or initialize the persistent Electron session partition */
  public getSession() {
    if (!session || typeof session.fromPartition !== 'function') {
      return null;
    }
    const ses = session.fromPartition('persist:gemini_session');
    // Use the platform identity and client hints unchanged.

    return ses;
  }

  /**
   * Check whether the user is logged into Google / Gemini Web by inspecting session cookies.
   */
  public async checkLoginStatus(): Promise<GeminiLoginStatus> {
    try {
      const ses = this.getSession();
      if (!ses?.cookies) {
        return {
          isLoggedIn: false,
          sessionCheckedAt: Date.now(),
        };
      }
      const cookies = await ses.cookies.get({});
      const authCookie = cookies.find(
        (c) =>
          GOOGLE_AUTH_COOKIE_NAMES.includes(c.name) ||
          (c.domain?.includes('google.com') && (c.name.includes('SID') || c.name.includes('SSID')))
      );

      return {
        isLoggedIn: Boolean(authCookie),
        sessionCheckedAt: Date.now(),
      };
    } catch (err) {
      console.error('[GeminiWebSession] Error checking login status:', err);
      return {
        isLoggedIn: false,
        sessionCheckedAt: Date.now(),
      };
    }
  }

  /**
   * Configures ordinary window navigation without identity masking.
   */
  private configureWebContents(win: BrowserWindow): void {
    // Authentication remains user-driven; no webdriver/UA/client-hint masking.
    // Support OAuth popup login windows
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.includes('accounts.google.com') || url.includes('google.com')) {
        win.loadURL(url).catch(() => {});
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode !== -3) {
        console.warn(`[Gemini Web] Page load notice (${errorCode}): ${errorDescription} for ${validatedURL}`);
      }
    });
  }

  /**
   * Opens a visible BrowserWindow for the user to log in with their Google account.
   * When waitForCompletion is false (default, for UI button), returns true immediately so UI does not freeze.
   * When waitForCompletion is true (for auto-generation), polls until user logs in or closes window.
   */
  public async openLoginWindow(waitForCompletion = false): Promise<boolean> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.setPosition(100, 100);
      this.browserWindow.setSize(950, 750);
      this.browserWindow.show();
      this.browserWindow.focus();
      this.isOffscreen = false;
      if (!waitForCompletion) {
        return true;
      }
    } else {
      const ses = this.getSession();
      if (!ses || typeof BrowserWindow === 'undefined') {
        throw new Error('Môi trường Electron không khả dụng để mở trình duyệt Gemini.');
      }

      this.browserWindow = new BrowserWindow({
        width: 950,
        height: 750,
        title: 'Đăng nhập Gemini Web — Vanhsub AI Studio (Chế độ Tiết kiệm)',
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        show: true,
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      });

      this.configureWebContents(this.browserWindow);
      this.isOffscreen = false;

      this.browserWindow.loadURL(GEMINI_HOME_URL).catch((err) => {
        console.warn('[GeminiWebSession] loadURL warning:', err?.message || err);
      });

      this.browserWindow.on('closed', () => {
        this.browserWindow = null;
      });

      if (!waitForCompletion) {
        return true;
      }
    }

    return new Promise((resolve) => {
      const pollInterval = setInterval(async () => {
        if (!this.browserWindow || this.browserWindow.isDestroyed()) {
          clearInterval(pollInterval);
          resolve(false);
          return;
        }
        const status = await this.checkLoginStatus();
        if (status.isLoggedIn) {
          clearInterval(pollInterval);
          resolve(true);
        }
      }, 1500);

      this.browserWindow?.on('closed', () => {
        clearInterval(pollInterval);
        resolve(false);
      });
    });
  }

  /**
   * Logs out of Gemini Web by clearing cookies & storage data in the session partition.
   */
  public async logout(): Promise<void> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.close();
      this.browserWindow = null;
    }
    const ses = this.getSession();
    if (ses) {
      await ses.clearStorageData();
    }
  }

  /**
   * Ensures an active automation window is available (either visible or offscreen).
   */
  private async ensureAutomationWindow(mode: 'offscreen' | 'visible' = 'offscreen'): Promise<BrowserWindow> {
    const ses = this.getSession();
    if (!ses || typeof BrowserWindow === 'undefined') {
      throw new Error('Môi trường Electron không khả dụng để tự động hóa Gemini.');
    }
    const shouldBeOffscreen = mode === 'offscreen';

    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      if (this.isOffscreen !== shouldBeOffscreen) {
        if (shouldBeOffscreen) {
          this.browserWindow.setSkipTaskbar(true);
          this.browserWindow.setPosition(-3000, -3000);
          if (!this.browserWindow.isVisible()) {
            this.browserWindow.showInactive();
          }
          this.isOffscreen = true;
        } else {
          this.browserWindow.setSkipTaskbar(false);
          this.browserWindow.setPosition(100, 100);
          this.browserWindow.setSize(850, 700);
          this.browserWindow.show();
          this.isOffscreen = false;
        }
      } else if (shouldBeOffscreen && !this.browserWindow.isVisible()) {
        this.browserWindow.setSkipTaskbar(true);
        this.browserWindow.setPosition(-3000, -3000);
        this.browserWindow.showInactive();
      }
      return this.browserWindow;
    }

    this.isOffscreen = shouldBeOffscreen;
    this.browserWindow = new BrowserWindow({
      width: 850,
      height: 700,
      x: shouldBeOffscreen ? -3000 : 100,
      y: shouldBeOffscreen ? -3000 : 100,
      show: true,
      skipTaskbar: shouldBeOffscreen, // Ẩn khỏi taskbar Windows khi offscreen
      title: 'Gemini Web Automation — Vanhsub AI Studio',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    if (shouldBeOffscreen) {
      this.browserWindow.showInactive();
    }

    this.configureWebContents(this.browserWindow);

    this.browserWindow.on('closed', () => {
      this.browserWindow = null;
    });

    return this.browserWindow;
  }

  /**
   * Sends a prompt turn into Gemini Web DOM and waits for response.
   */
  private async sendPromptTurn(
    win: BrowserWindow,
    prompt: string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    onProgress?.('Đang truyền prompt vào Gemini Web...');

    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      throw new Error('Cửa sổ phiên Gemini Web không khả dụng hoặc đã bị đóng.');
    }

    const injected = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const editor = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                         document.querySelector('div.ql-editor[contenteditable="true"]') ||
                         document.querySelector('div[contenteditable="true"]') ||
                         document.querySelector('textarea');
          if (!editor) return { success: false, error: 'Không tìm thấy ô nhập prompt trên Gemini Web' };

          editor.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(prompt)});
          editor.dispatchEvent(new Event('input', { bubbles: true }));

          await new Promise(r => setTimeout(r, 600));

          const sendBtn = document.querySelector('button[aria-label*="Gửi"]') ||
                          document.querySelector('button[aria-label*="Send"]') ||
                          document.querySelector('button.send-button') ||
                          document.querySelector('button[mattooltip*="Send"]') ||
                          document.querySelector('button[data-test-id="send-button"]');
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return { success: true };
          }

          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
          editor.dispatchEvent(enterEvent);
          return { success: true };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      })()
    `);

    if (!injected?.success) {
      throw new Error(injected?.error || 'Không thể gửi prompt tới Gemini Web');
    }

    onProgress?.('Gemini đang phản hồi...');
    return this.waitForResponseCompletion(win.webContents, onProgress);
  }

  /**
   * Core automation: Navigate to Gemini, input prompt, wait for reply,
   * with automatic Multi-Turn Chunking if the script is truncated.
   */
  public async generateScriptWeb(
    topic: string,
    preset: string,
    mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void,
    blueprint?: IdeaBlueprint,
    channelProfile?: Partial<ChannelProfileConfig>
  ): Promise<string> {
    if (this.isBusy) {
      throw new Error('Gemini Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }

    this.isBusy = true;
    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập Google / Gemini Web. Đang mở cửa sổ đăng nhập...');
        await this.openLoginWindow(true);
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản Google để sử dụng Gemini Web.');
        }
      }

      onProgress?.('Đang kết nối phiên Gemini Web...');
      const win = await this.ensureAutomationWindow(mode);

      const currentUrl = win.webContents.getURL();
      if (!currentUrl.includes('gemini.google.com')) {
        await win.loadURL(GEMINI_HOME_URL);
        await new Promise((r) => setTimeout(r, 4000));
      }

      const { prompt: turn1Prompt, metrics } = buildScriptPromptForWeb(topic, preset, blueprint, channelProfile);
      onProgress?.(`Đang yêu cầu Gemini Web viết kịch bản mục tiêu ${metrics.targetMinutesText} (${metrics.targetSentenceRange})...`);

      const turn1Response = await this.sendPromptTurn(win, turn1Prompt, onProgress);
      let combinedResponse = turn1Response;

      const turn1Parsed = parseChatGptScriptResponse(turn1Response, topic);
      const targetMin = metrics.minSentences;

      // Multi-Turn continuation if script has not reached target sentence count
      if (turn1Parsed.length < targetMin) {
        onProgress?.(
          `Kịch bản lượt 1 đạt ${turn1Parsed.length}/${targetMin} câu. Đang gửi yêu cầu viết tiếp các phân cảnh (Multi-turn)...`
        );
        const nextStart = turn1Parsed.length + 1;
        const targetEnd = Math.min(
          metrics.maxSentences,
          nextStart + Math.max(18, targetMin - turn1Parsed.length + 4)
        );
        const turn2Prompt = `Kịch bản đang rất hấp dẫn. Hãy viết tiếp liền mạch các phân cảnh tiếp theo từ CÂU ${nextStart} đến CÂU ${targetEnd} để phát triển trọn vẹn các phần còn lại của dàn ý cho chủ đề "${topic}". Đảm bảo tổng độ dài đạt mục tiêu ${metrics.targetMinutesText}. CÂU ${targetEnd} là phần kết luận và kêu gọi đăng ký kênh.
Giữ nguyên đúng định dạng mỗi dòng:
CÂU X: [Nội dung câu thoại]`;
        try {
          const turn2Response = await this.sendPromptTurn(win, turn2Prompt, onProgress);
          combinedResponse = `${turn1Response}\n${turn2Response}`;

          // If still significantly short for long form videos (e.g. 8-12 min), send turn 3
          const turn2Parsed = parseChatGptScriptResponse(combinedResponse, topic);
          if (turn2Parsed.length < targetMin - 8 && metrics.targetDurationSec >= 600) {
            onProgress?.(`Đang gửi lượt 3 để hoàn tất kịch bản dài (${turn2Parsed.length}/${targetMin} câu)...`);
            const nextStart3 = turn2Parsed.length + 1;
            const turn3Prompt = `Hãy viết tiếp các phân cảnh cao trào và kết thúc từ CÂU ${nextStart3} đến CÂU ${metrics.maxSentences} để hoàn tất kịch bản. CÂU ${metrics.maxSentences} là lời kết và kêu gọi đăng ký kênh. Định dạng: CÂU X: [Nội dung].`;
            const turn3Response = await this.sendPromptTurn(win, turn3Prompt, onProgress);
            combinedResponse = `${combinedResponse}\n${turn3Response}`;
          }
        } catch (turn2Err) {
          console.warn('[GeminiWebSession] Turn 2 continuation failed, proceeding with received text:', turn2Err);
        }
      }

      return combinedResponse;
    } finally {
      this.isBusy = false;
      if (mode === 'offscreen' && this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.browserWindow.setPosition(-3000, -3000);
      }
    }
  }

  /**
   * Executes a single prompt turn against Gemini Web and returns the full response text.
   * Useful for Idea Blueprint generation, SEO metadata, and custom prompt queries.
   */
  public async executePromptTurn(
    prompt: string,
    mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void
  ): Promise<string> {
    if (this.isBusy) {
      throw new Error('Gemini Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }

    this.isBusy = true;
    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập Google. Đang mở cửa sổ đăng nhập...');
        await this.openLoginWindow(true);
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản Google để sử dụng Gemini Web.');
        }
      }

      onProgress?.('Đang kết nối phiên Gemini Web...');
      const win = await this.ensureAutomationWindow(mode);

      const currentUrl = win.webContents.getURL();
      if (!currentUrl.includes('gemini.google.com')) {
        await win.loadURL(GEMINI_HOME_URL);
        await new Promise((r) => setTimeout(r, 4000));
      }

      return await this.sendPromptTurn(win, prompt, onProgress);
    } finally {
      this.isBusy = false;
      if (mode === 'offscreen' && this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.browserWindow.setPosition(-3000, -3000);
      }
    }
  }

  /**
   * Polls the Gemini Web DOM until generation completes.
   */
  private async waitForResponseCompletion(
    webContents: WebContents,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const maxWaitMs = 90000; // 90s timeout
    const startTime = Date.now();

    await new Promise((r) => setTimeout(r, 2000));

    let lastLength = 0;
    let stableCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      if (webContents.isDestroyed()) {
        throw new Error('Phiên Gemini Web đã bị đóng trong lúc chờ phản hồi.');
      }

      const state = await webContents.executeJavaScript(`
        (() => {
          try {
            const stopBtn = document.querySelector('button[aria-label*="Dừng"]') ||
                            document.querySelector('button[aria-label*="Stop"]');
            const isStreaming = Boolean(stopBtn) || Boolean(document.querySelector('.sparkle-anim'));
            
            const responseContainers = Array.from(
              document.querySelectorAll('message-content, model-response')
            );
            let lastMsg = responseContainers[responseContainers.length - 1];
            if (!lastMsg) {
              const fallbacks = Array.from(
                document.querySelectorAll('.model-response-text, .response-container, .markdown')
              );
              lastMsg = fallbacks[fallbacks.length - 1];
            }
            const text = lastMsg ? (lastMsg.innerText || lastMsg.textContent || '') : '';

            return { isStreaming, text, messageCount: responseContainers.length };
          } catch (err) {
            return { isStreaming: false, text: '', messageCount: 0, error: String(err) };
          }
        })()
      `);

      if (state.isStreaming) {
        onProgress?.(`Gemini đang viết kịch bản... (${state.text.length} ký tự)`);
        stableCount = 0;
      } else if (state.text && state.text.length > 30) {
        if (state.text.length === lastLength) {
          stableCount++;
          if (stableCount >= 2) {
            return state.text;
          }
        } else {
          lastLength = state.text.length;
          stableCount = 0;
        }
      }

      await new Promise((r) => setTimeout(r, 1200));
    }

    throw new Error('Hết thời gian chờ phản hồi từ Gemini Web (Timeout 90s)');
  }

  /** Close active window if needed */
  public closeWindow(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.close();
      this.browserWindow = null;
    }
  }
}
