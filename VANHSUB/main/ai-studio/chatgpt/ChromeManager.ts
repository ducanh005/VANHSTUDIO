/**
 * ChromeManager.ts
 * Manages Google Chrome process lifecycle, multi-tier Windows binary locator,
 * isolated profile directory, port 9223 liveness probe, anti-bot flags,
 * and clean process tree termination without zombie processes.
 *
 * Location: main/ai-studio/chatgpt/ChromeManager.ts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { killProcessTreeByPid } from '../../lib/processTree';

export interface ChromeLaunchOptions {
  port?: number;             // default 9223
  profileDir?: string;       // default <userData>/chrome_chatgpt_profile
  headless?: boolean;        // default false (headed for human login/interaction)
  startUrl?: string;         // default https://chatgpt.com
}

export interface ChromeProcessInfo {
  pid: number | null;
  port: number;
  profileDir: string;
  isAlive: boolean;
}

export class ChromeManager {
  private static instance: ChromeManager | null = null;

  private activePid: number | null = null;
  private activePort: number = 9223;
  private activeProfileDir: string = '';
  private childProcess: ChildProcess | null = null;
  private detectedChromePath: string | null = null;

  private constructor() {
    this.activeProfileDir = this.getProfileDir();
  }

  public static getInstance(): ChromeManager {
    if (!ChromeManager.instance) {
      ChromeManager.instance = new ChromeManager();
    }
    return ChromeManager.instance;
  }

  /**
   * Resets singleton instance and cleans up state (useful for tests).
   */
  public static resetInstance(): void {
    ChromeManager.instance = null;
  }

  /**
   * Multi-tier locator to discover Google Chrome binary on Windows:
   * Tier 1: Environment variable overrides (CHROME_PATH, CHROME_BIN)
   * Tier 2: Standard Windows directories (Program Files 64-bit, 32-bit, LocalAppData, ProgramW6432)
   * Tier 3: Windows Registry query fallback (HKLM & HKCU App Paths)
   * Tier 4: System PATH search via where.exe
   * Tier 5: POSIX fallback paths (macOS / Linux)
   */
  public detectChromePath(): string {
    if (this.detectedChromePath && fs.existsSync(this.detectedChromePath)) {
      return this.detectedChromePath;
    }

    // Tier 1: Environment variable overrides
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      this.detectedChromePath = path.resolve(process.env.CHROME_PATH);
      return this.detectedChromePath;
    }
    if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
      this.detectedChromePath = path.resolve(process.env.CHROME_BIN);
      return this.detectedChromePath;
    }

    // Tier 2: Standard Windows directories
    if (process.platform === 'win32') {
      const standardCandidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.ProgramW6432 || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'D:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];

      for (const candidate of standardCandidates) {
        if (candidate && fs.existsSync(candidate)) {
          this.detectedChromePath = candidate;
          return candidate;
        }
      }

      // Tier 3: Windows Registry Query fallback (HKLM then HKCU)
      const regKeys = [
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      ];

      for (const key of regKeys) {
        try {
          const regOutput = execFileSync('reg.exe', ['query', key, '/ve'], {
            encoding: 'utf8',
            timeout: 1500,
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
          });
          const match = regOutput.match(/REG_SZ\s+([^\r\n]+)/i);
          if (match && match[1]) {
            const rawPath = match[1].trim().replace(/^["']|["']$/g, '');
            if (fs.existsSync(rawPath)) {
              this.detectedChromePath = rawPath;
              return rawPath;
            }
          }
        } catch {
          // Key not found or query timed out, continue
        }
      }

      // Tier 4: where.exe chrome.exe
      try {
        const whereOutput = execFileSync('where.exe', ['chrome.exe'], {
          encoding: 'utf8',
          timeout: 1500,
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
        const lines = whereOutput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (fs.existsSync(line)) {
            this.detectedChromePath = line;
            return line;
          }
        }
      } catch {
        // where.exe returned non-zero
      }
    } else {
      // Tier 5: POSIX fallbacks (macOS / Linux)
      const posixCandidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
      ];
      for (const candidate of posixCandidates) {
        if (fs.existsSync(candidate)) {
          this.detectedChromePath = candidate;
          return candidate;
        }
      }
    }

    throw new Error(
      'Google Chrome executable was not found on this system. ' +
      'Please install Google Chrome from https://google.com/chrome or specify the CHROME_PATH environment variable.'
    );
  }

  /**
   * Resolves the profile directory for ChatGPT automation:
   * Priority:
   * 1. customDir passed by caller
   * 2. process.env.CHATGPT_PROFILE_DIR
   * 3. Electron app.getPath('userData')/chrome_chatgpt_profile
   * 4. Fallback for CLI/test runners: %LOCALAPPDATA%/vanhsub_storage/chrome_chatgpt_profile
   */
  public getProfileDir(customDir?: string): string {
    if (customDir) {
      return path.resolve(customDir);
    }
    if (process.env.CHATGPT_PROFILE_DIR) {
      return path.resolve(process.env.CHATGPT_PROFILE_DIR);
    }
    if (process.versions && (process.versions as any).electron) {
      try {
        const electron = require('electron');
        const app = electron.app || electron.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), 'chrome_chatgpt_profile');
        }
      } catch {
        // Not inside Electron runtime
      }
    }

    const baseDir = process.env.LOCALAPPDATA || os.tmpdir();
    return path.join(baseDir, 'vanhsub_storage', 'chrome_chatgpt_profile');
  }

  /**
   * HTTP GET probe to http://127.0.0.1:<port>/json/version.
   * Timeout default 800ms. Returns true if status code 200, false otherwise.
   */
  public isPortAlive(port = 9223, timeoutMs = 800): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${port}/json/version`,
        { timeout: timeoutMs },
        (res) => {
          res.resume(); // consume response body to prevent resource leak
          resolve(res.statusCode === 200);
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Spawns Google Chrome with dedicated CDP port and anti-bot flags:
   * - Guard: strictly forbids port 9222 (reserved for Google Flow Bridge)
   * - Probes port liveness first: reuses existing instance without duplicate spawning
   * - Cleans up dead SingletonLock / SingletonSocket / SingletonCookie
   * - Spawns with detached: true, unref(), tracks PID
   * - Polls port liveness up to 15s until ready
   */
  public async launchChrome(options?: ChromeLaunchOptions): Promise<ChromeProcessInfo> {
    const port = options?.port ?? 9223;
    const profileDir = options?.profileDir ?? this.getProfileDir();
    const headless = options?.headless ?? false;
    const startUrl = options?.startUrl ?? 'https://chatgpt.com';

    // Strict Port Separation Guard
    if (port === 9222) {
      throw new Error(
        'Port 9222 is strictly reserved for Google Flow Bridge (FlowBridgeServer). ' +
        'Please use port 9223 (or another non-9222 port) for ChatGPT CDP.'
      );
    }

    // Step 1: Probe if Chrome is already active on this port
    const alreadyAlive = await this.isPortAlive(port, 800);
    if (alreadyAlive) {
      if (this.activePid === null) {
        this.activePid = this.findPidByPort(port);
      }
      this.activePort = port;
      this.activeProfileDir = profileDir;
      return {
        pid: this.activePid,
        port,
        profileDir,
        isAlive: true,
      };
    }

    // Step 2: Ensure profile directory exists
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    // Step 3: Clean up stale SingletonLock files before spawning
    this.cleanupStaleLockFiles(profileDir);

    // Step 4: Detect Chrome binary
    const chromePath = this.detectChromePath();

    // Step 5: Build spawn flags
    const chromeArgs: string[] = [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDir}`,
      // Preserve standard Chromium automation indicators.
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      '--disable-features=Translate,OptimizationHints,MediaRouter',
      '--window-size=1280,800',
    ];

    if (headless) {
      chromeArgs.push('--headless=new');
    }

    if (startUrl) {
      chromeArgs.push(startUrl);
    }

    // Step 6: Spawn detached process
    const child = spawn(chromePath, chromeArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    child.unref();

    this.activePid = child.pid ?? null;
    this.activePort = port;
    this.activeProfileDir = profileDir;
    this.childProcess = child;

    child.on('exit', () => {
      if (this.childProcess === child) {
        this.childProcess = null;
        this.activePid = null;
      }
    });

    // Step 7: Poll port liveness until ready (timeout 15 seconds)
    const startTime = Date.now();
    const timeoutMs = 15000;
    const pollIntervalMs = 250;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const alive = await this.isPortAlive(port, 400);
      if (alive) {
        return {
          pid: this.activePid,
          port,
          profileDir,
          isAlive: true,
        };
      }
    }

    // Timeout exceeded: terminate spawned process if hanging
    if (this.activePid) {
      killProcessTreeByPid(this.activePid);
      this.activePid = null;
      this.childProcess = null;
    }

    throw new Error(
      `Failed to connect to Google Chrome DevTools Protocol on 127.0.0.1:${port} within 15 seconds. ` +
      `Executable: "${chromePath}". Profile: "${profileDir}".`
    );
  }

  /**
   * Terminates the Chrome process tree cleanly:
   * - Targets tracked activePid or discovers PID by port via netstat
   * - Calls killProcessTreeByPid (taskkill /pid <PID> /T /F on Windows)
   * - Waits for port to close
   * - Cleans up dead SingletonLock files
   */
  public async closeChrome(): Promise<void> {
    const targetPid = this.activePid || this.findPidByPort(this.activePort);
    if (targetPid && targetPid > 0) {
      killProcessTreeByPid(targetPid);
    }

    // Wait up to 3000ms for port to close
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      const alive = await this.isPortAlive(this.activePort, 250);
      if (!alive) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    this.activePid = null;
    this.childProcess = null;

    if (this.activeProfileDir && fs.existsSync(this.activeProfileDir)) {
      this.cleanupStaleLockFiles(this.activeProfileDir);
    }
  }

  /**
   * Returns current process state info
   */
  public getProcessInfo(): ChromeProcessInfo {
    let isAlive = false;
    if (this.activePid && this.activePid > 0) {
      try {
        process.kill(this.activePid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }
    }

    return {
      pid: this.activePid,
      port: this.activePort,
      profileDir: this.activeProfileDir,
      isAlive,
    };
  }

  /**
   * Finds the process PID listening on the specified TCP port on Windows via netstat.
   */
  private findPidByPort(port: number): number | null {
    if (process.platform !== 'win32') return null;
    try {
      const netstatOutput = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });

      const lines = netstatOutput.split(/\r?\n/);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[0] === 'TCP' && parts[3] === 'LISTENING') {
          const localAddress = parts[1];
          if (localAddress.endsWith(`:${port}`)) {
            const pid = parseInt(parts[4], 10);
            if (!isNaN(pid) && pid > 0) {
              return pid;
            }
          }
        }
      }
    } catch {
      // Netstat failed or timed out
    }
    return null;
  }

  /**
   * Safely deletes stale Chrome Singleton lockfiles when no browser is running.
   */
  private cleanupStaleLockFiles(profileDir: string): void {
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const file of lockFiles) {
      const lockPath = path.join(profileDir, file);
      try {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      } catch {
        // Ignored if actively locked or inaccessible
      }
    }
  }
}
