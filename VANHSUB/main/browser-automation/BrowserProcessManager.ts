/**
 * main/browser-automation/BrowserProcessManager.ts
 *
 * Enterprise Multi-Profile Chrome Process Lifecycle Manager:
 * 1. 5-Tier Windows & POSIX Chrome Auto-Detection (env, ProgramFiles/AppData, Registry HKLM/HKCU, where.exe, POSIX).
 * 2. Multi-Profile Directory Isolation (chrome_flow_profile vs chrome_chatgpt_profile vs chrome_generic_profile).
 * 3. Dedicated Ports: 9223 for ChatGPT, 9224 for Flow CDP, with liveness checking via /json/version.
 * 4. Strict Port 9222 Collision Guard (Number coercion enforcing 9222 reservation for FlowBridgeServer).
 * 5. Standard Chrome process arguments without identity masking.
 * 6. Windows Process Tree Elimination (taskkill /pid <PID> /T /F) and Stale SingletonLock Sanitization.
 * 7. Active Process Registry with graceful shutdown hooks.
 */

import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { killProcessTreeByPid } from '../lib/processTree';
import {
  type AutomationProvider,
  type BrowserLaunchOptions,
  type BrowserProcessInfo,
  type ManagedProcessRecord,
  RESERVED_BRIDGE_PORT,
  DEFAULT_CHATGPT_PORT,
  DEFAULT_FLOW_PORT,
  DEFAULT_GENERIC_PORT,
  DEFAULT_PROVIDER_PORTS,
  DEFAULT_PROVIDER_PROFILE_NAMES,
  PortConflictError,
  PortConflictGuardError,
  ChromeNotFoundError,
  BrowserLaunchError,
  BrowserLaunchTimeoutError,
  assertNotReservedPort,
} from './types';

export class BrowserProcessManager {
  private static instance: BrowserProcessManager | null = null;

  public static readonly RESERVED_PORT_FLOW_BRIDGE: number = RESERVED_BRIDGE_PORT;
  public static readonly DEFAULT_PORT_CHATGPT: number = DEFAULT_CHATGPT_PORT;
  public static readonly DEFAULT_PORT_FLOW: number = DEFAULT_FLOW_PORT;
  public static readonly DEFAULT_PORT_GENERIC: number = DEFAULT_GENERIC_PORT;

  private activeProcesses = new Map<AutomationProvider, ManagedProcessRecord>();
  private detectedChromePath: string | null = null;
  private shutdownHooksRegistered = false;

  private constructor() {
    this.registerShutdownHooks();
  }

  public static getInstance(): BrowserProcessManager {
    if (!BrowserProcessManager.instance) {
      BrowserProcessManager.instance = new BrowserProcessManager();
    }
    return BrowserProcessManager.instance;
  }

  public static resetInstance(): void {
    if (BrowserProcessManager.instance) {
      BrowserProcessManager.instance.activeProcesses.clear();
      BrowserProcessManager.instance.detectedChromePath = null;
      BrowserProcessManager.instance = null;
    }
  }

  /**
   * 5-Tier Chrome binary discovery algorithm:
   * Tier 1: Env overrides (CHROME_PATH, CHROME_BIN, VANHSUB_CHROME_PATH, or explicit parameter)
   * Tier 2: Standard Windows directories (Program Files, x86, ProgramW6432, LocalAppData, drives C/D)
   * Tier 3: Windows Registry query fallback (HKLM & HKCU App Paths)
   * Tier 4: System PATH search (where.exe chrome.exe)
   * Tier 5: POSIX fallback (/Applications, /usr/bin/google-chrome, /usr/bin/chromium)
   */
  public detectChromePath(overridePath?: string): string {
    if (overridePath && fs.existsSync(overridePath)) {
      return path.resolve(overridePath);
    }

    if (this.detectedChromePath && fs.existsSync(this.detectedChromePath)) {
      return this.detectedChromePath;
    }

    const checkedLocations: string[] = [];

    // Tier 1: Environment variable overrides
    const envVars = ['CHROME_PATH', 'CHROME_BIN', 'VANHSUB_CHROME_PATH'];
    for (const ev of envVars) {
      const val = process.env[ev];
      if (val) {
        checkedLocations.push(`env:${ev}=${val}`);
        if (fs.existsSync(val)) {
          this.detectedChromePath = path.resolve(val);
          return this.detectedChromePath;
        }
      }
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
      ].filter(Boolean);

      for (const candidate of standardCandidates) {
        checkedLocations.push(candidate);
        if (fs.existsSync(candidate)) {
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
        checkedLocations.push(`registry:${key}`);
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
      checkedLocations.push('where.exe:chrome.exe');
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
        checkedLocations.push(candidate);
        if (fs.existsSync(candidate)) {
          this.detectedChromePath = candidate;
          return candidate;
        }
      }
    }

    throw new ChromeNotFoundError(
      'Google Chrome executable was not found on this system. ' +
      'Please install Google Chrome from https://google.com/chrome or specify the CHROME_PATH environment variable.',
      checkedLocations
    );
  }

  /**
   * Resets the cached detected Chrome path (useful for tests).
   */
  public clearDetectedChromePath(): void {
    this.detectedChromePath = null;
  }

  /**
   * Resolves isolated profile directory for a specific provider:
   * Priority:
   * 1. customDir passed by caller
   * 2. Provider environment variable (e.g. CHATGPT_PROFILE_DIR, FLOW_PROFILE_DIR)
   * 3. Electron app.getPath('userData')/chrome_<provider>_profile
   * 4. Fallback for CLI/test runners: %LOCALAPPDATA%/vanhsub_storage/chrome_<provider>_profile
   */
  public getProfileDir(provider: AutomationProvider, customDir?: string): string {
    if (customDir) {
      return path.resolve(customDir);
    }

    const envMap: Record<AutomationProvider, string | undefined> = {
      chatgpt: process.env.CHATGPT_PROFILE_DIR,
      flow: process.env.FLOW_PROFILE_DIR,
      generic: process.env.GENERIC_PROFILE_DIR,
    };

    const envVal = envMap[provider];
    if (envVal) {
      return path.resolve(envVal);
    }

    const folderName = DEFAULT_PROVIDER_PROFILE_NAMES[provider] || `chrome_${provider}_profile`;

    if (process.versions && (process.versions as any).electron) {
      try {
        const electron = require('electron');
        const app = electron.app || electron.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), folderName);
        }
      } catch {
        // Not inside active Electron runtime
      }
    }

    const baseDir = process.env.LOCALAPPDATA || os.tmpdir();
    return path.join(baseDir, 'vanhsub_storage', folderName);
  }

  /**
   * Resolves default port per provider with environment override support.
   */
  public getDefaultPort(provider: AutomationProvider): number {
    if (provider === 'chatgpt' && process.env.CHATGPT_CDP_PORT) {
      const p = Number(process.env.CHATGPT_CDP_PORT);
      if (!isNaN(p)) return this.validatePort(p);
    }
    if (provider === 'flow' && process.env.FLOW_CDP_PORT) {
      const p = Number(process.env.FLOW_CDP_PORT);
      if (!isNaN(p)) return this.validatePort(p);
    }
    return DEFAULT_PROVIDER_PORTS[provider] ?? DEFAULT_GENERIC_PORT;
  }

  /**
   * Strict port collision guard:
   * - Enforces numeric coercion: Number(String(port).trim()) === 9222 throws PortConflictError
   * - Verifies valid TCP port range [1, 65535].
   */
  public validatePort(port: number | string | undefined | null): number {
    if (port === undefined || port === null) {
      throw new Error('Port must not be null or undefined.');
    }
    const rawStr = String(port).trim();
    const numericPort = Number(rawStr);

    if (isNaN(numericPort) || numericPort <= 0 || numericPort > 65535) {
      throw new Error(`Invalid port: "${port}". Must be a valid TCP port number between 1 and 65535.`);
    }

    if (numericPort === RESERVED_BRIDGE_PORT) {
      throw new PortConflictError(
        numericPort,
        'FlowBridgeServer',
        'Port 9222 is strictly reserved for Google Flow Extension Bridge (FlowBridgeServer). ' +
        'Please use port 9223 for ChatGPT, 9224 for Google Flow CDP, or another non-9222 port.'
      );
    }

    return numericPort;
  }

  /**
   * HTTP GET probe to http://127.0.0.1:<port>/json/version with socket leak protection.
   * If port 9222 is passed, immediately returns false without generating network traffic.
   */
  public isPortAlive(port: number, timeoutMs = 800): Promise<boolean> {
    if (port === RESERVED_BRIDGE_PORT) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${port}/json/version`,
        { timeout: timeoutMs },
        (res) => {
          res.resume(); // Consume response body to prevent socket leak
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
   * Discovers listening PID on Windows via `netstat -ano -p tcp`.
   */
  public findPidByPort(port: number): number | null {
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
   * Checks whether a profile directory is actively in use by a running Chrome process.
   */
  public isProfileInUse(profileDir: string, port?: number): boolean {
    const resolvedProfile = path.resolve(profileDir);

    // 1. Check active processes registry
    for (const record of this.activeProcesses.values()) {
      if (path.resolve(record.profileDir) === resolvedProfile) {
        if (record.pid && record.pid > 0) {
          try {
            process.kill(record.pid, 0);
            return true;
          } catch {}
        }
      }
    }

    // 2. Check if associated port is actively listening
    if (port && port > 0) {
      const pid = this.findPidByPort(port);
      if (pid && pid > 0) {
        return true;
      }
    }

    // 3. Inspect Windows active Chrome processes by command line (--user-data-dir)
    if (process.platform === 'win32') {
      try {
        const cmd = `Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | ForEach-Object { $_.CommandLine }`;
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
          encoding: 'utf8',
          timeout: 2500,
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
        const normTarget = resolvedProfile.toLowerCase().replace(/\\/g, '/');
        const lines = output.split(/\r?\n/);
        for (const line of lines) {
          if (!line) continue;
          const normLine = line.toLowerCase().replace(/\\/g, '/');
          if (normLine.includes(normTarget)) {
            return true;
          }
        }
      } catch {
        // Fallback or ignore if query fails
      }
    }

    // 4. Inspect SingletonLock file
    const lockPath = path.join(resolvedProfile, 'SingletonLock');
    if (fs.existsSync(lockPath)) {
      try {
        const stats = fs.lstatSync(lockPath);
        // On POSIX, SingletonLock is a symlink: `<hostname>-<PID>`
        if (stats.isSymbolicLink()) {
          const target = fs.readlinkSync(lockPath);
          const match = target.match(/-(\d+)$/);
          if (match && match[1]) {
            const pid = parseInt(match[1], 10);
            if (!isNaN(pid) && pid > 0) {
              try {
                process.kill(pid, 0);
                return true; // Process holding lock is alive!
              } catch {}
            }
          }
        }
      } catch {}

      // On Windows or general systems, check if file is actively locked
      try {
        const fd = fs.openSync(lockPath, 'r+');
        fs.closeSync(fd);
      } catch (err: any) {
        if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
          return true; // File is locked by active process
        }
      }
    }

    return false;
  }

  /**
   * Deletes stale SingletonLock, SingletonSocket, SingletonCookie files
   * safely ONLY when no browser process is actively using the profile.
   */
  public cleanupStaleLockFiles(profileDir: string, port?: number): void {
    if (this.isProfileInUse(profileDir, port)) {
      console.warn(`[BrowserProcessManager] 🛡️ Profile "${profileDir}" is actively in use by Chrome. Skipping lockfile cleanup.`);
      return;
    }

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

  /**
   * Launches Google Chrome with dedicated CDP port and anti-bot flags:
   * - Port 9222 guard check via validatePort
   * - Reuses alive instances on target port without redundant spawn
   * - Cleans stale profile lockfiles
   * - Assembles standard isolated-profile arguments
   * - Spawns detached process with unref()
   * - Polls /json/version up to timeoutMs (default 15000ms)
   * - Auto-kills spawned tree on timeout
   */
  public async launchBrowser(options: BrowserLaunchOptions): Promise<BrowserProcessInfo> {
    const provider = options.provider;
    const effectivePort = this.validatePort(options.port ?? this.getDefaultPort(provider));
    const profileDir = this.getProfileDir(provider, options.profileDir);
    const headless = options.headless ?? false;
    const timeoutMs = options.timeoutMs ?? 15000;

    // Step 1: Probe if Chrome is already alive on this port
    const alreadyAlive = await this.isPortAlive(effectivePort, 800);
    if (alreadyAlive) {
      const pid = this.findPidByPort(effectivePort);
      const info: BrowserProcessInfo = {
        pid,
        port: effectivePort,
        profileDir,
        isAlive: true,
        provider,
        launchedAt: Date.now(),
        spawnedByManager: false,
      };

      this.activeProcesses.set(provider, {
        provider,
        port: effectivePort,
        profileDir,
        pid,
        childProcess: null,
        spawnedByManager: false,
        createdAt: Date.now(),
      });

      return info;
    }

    // Step 2: Ensure profile directory exists
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    // Step 3: Clean up stale lock files
    this.cleanupStaleLockFiles(profileDir);

    // Step 4: Detect Chrome executable binary
    const chromePath = this.detectChromePath(options.executablePath);

    // Step 5: Assemble ordinary Chromium arguments
    const width = options.windowSize?.width ?? 1280;
    const height = options.windowSize?.height ?? 800;

    const chromeArgs: string[] = [
      `--remote-debugging-port=${effectivePort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,OptimizationHints,MediaRouter',
      `--window-size=${width},${height}`,
    ];

    if (headless) {
      chromeArgs.push('--headless=new');
    }

    if (options.startUrl) {
      chromeArgs.push(options.startUrl);
    }

    if (options.extraArgs && Array.isArray(options.extraArgs)) {
      chromeArgs.push(...options.extraArgs);
    }

    // Step 6: Spawn detached process
    let child;
    try {
      child = spawn(chromePath, chromeArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
    } catch (spawnErr: any) {
      throw new BrowserLaunchError(
        provider,
        `Failed to spawn Chrome process: ${spawnErr?.message || spawnErr}`,
        { chromePath, port: effectivePort, cause: spawnErr }
      );
    }

    const spawnedPid = child.pid ?? null;
    const managedRecord: ManagedProcessRecord = {
      provider,
      port: effectivePort,
      profileDir,
      pid: spawnedPid,
      childProcess: child,
      spawnedByManager: true,
      createdAt: Date.now(),
    };
    this.activeProcesses.set(provider, managedRecord);

    child.on('exit', () => {
      const rec = this.activeProcesses.get(provider);
      if (rec && rec.childProcess === child) {
        rec.childProcess = null;
        rec.pid = null;
      }
    });

    // Step 7: Poll port liveness until ready (/json/version returns 200)
    const startTime = Date.now();
    const pollIntervalMs = 250;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const alive = await this.isPortAlive(effectivePort, 400);
      if (alive) {
        return {
          pid: spawnedPid,
          port: effectivePort,
          profileDir,
          isAlive: true,
          provider,
          launchedAt: managedRecord.createdAt,
          spawnedByManager: true,
        };
      }
    }

    // Timeout exceeded: terminate spawned process tree and clean up
    if (spawnedPid) {
      killProcessTreeByPid(spawnedPid);
    }
    this.activeProcesses.delete(provider);

    throw new BrowserLaunchTimeoutError(effectivePort, timeoutMs);
  }

  /**
   * Terminates browser process tree for specified provider via taskkill /pid <PID> /T /F
   * ONLY if the instance was spawned by this manager, polls port closure, and cleans up stale lockfiles.
   */
  public async closeBrowser(provider: AutomationProvider): Promise<void> {
    const record = this.activeProcesses.get(provider);
    const port = record?.port ?? this.getDefaultPort(provider);
    const profileDir = record?.profileDir ?? this.getProfileDir(provider);

    // Only terminate process tree if this instance was explicitly spawned by manager!
    // External / user Chrome instances attached to should NOT be killed!
    if (record && record.spawnedByManager && record.pid && record.pid > 0) {
      console.log(`[BrowserProcessManager] 🛑 Closing manager-spawned browser for "${provider}" (PID ${record.pid})...`);
      killProcessTreeByPid(record.pid);

      // Wait up to 3000ms for port to close
      const startTime = Date.now();
      while (Date.now() - startTime < 3000) {
        const alive = await this.isPortAlive(port, 250);
        if (!alive) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    } else {
      console.log(`[BrowserProcessManager] ℹ️ Browser for "${provider}" was not spawned by manager or not running. Detaching from registry without killing.`);
    }

    this.activeProcesses.delete(provider);

    if (fs.existsSync(profileDir)) {
      this.cleanupStaleLockFiles(profileDir, port);
    }
  }

  /**
   * Terminates browser process listening on specific port if managed by app.
   */
  public async closeBrowserByPort(port: number): Promise<void> {
    for (const [provider, record] of this.activeProcesses.entries()) {
      if (record.port === port) {
        await this.closeBrowser(provider);
        return;
      }
    }

    // Port is not in our registry: DO NOT kill unmanaged host process!
    console.log(`[BrowserProcessManager] ℹ️ Port ${port} is not in managed process registry. Skipping kill.`);
  }

  /**
   * Terminates all managed browser instances.
   */
  public async closeAllBrowsers(): Promise<void> {
    const providers = Array.from(this.activeProcesses.keys());
    for (const provider of providers) {
      try {
        await this.closeBrowser(provider);
      } catch (err) {
        console.warn(`[BrowserProcessManager] Error closing browser for provider '${provider}':`, err);
      }
    }
  }

  /**
   * Returns current process state for a provider.
   */
  public getProcessInfo(provider: AutomationProvider): BrowserProcessInfo | null {
    const record = this.activeProcesses.get(provider);
    if (!record) return null;

    let isAlive = false;
    if (record.pid && record.pid > 0) {
      try {
        process.kill(record.pid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }
    }

    return {
      pid: record.pid,
      port: record.port,
      profileDir: record.profileDir,
      isAlive,
      provider: record.provider,
      launchedAt: record.createdAt,
      spawnedByManager: record.spawnedByManager,
    };
  }

  /**
   * Returns list of all active managed processes.
   */
  public getAllProcesses(): BrowserProcessInfo[] {
    const list: BrowserProcessInfo[] = [];
    for (const provider of this.activeProcesses.keys()) {
      const info = this.getProcessInfo(provider);
      if (info) list.push(info);
    }
    return list;
  }

  /**
   * Registers process 'exit' hooks for safety.
   */
  private registerShutdownHooks(): void {
    if (this.shutdownHooksRegistered) return;
    this.shutdownHooksRegistered = true;

    const onExit = () => {
      for (const record of this.activeProcesses.values()) {
        if (record.spawnedByManager && record.pid && record.pid > 0) {
          killProcessTreeByPid(record.pid);
        }
      }
    };

    process.once('exit', onExit);
  }
}
