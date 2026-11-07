/**
 * main/browser-automation/BrowserAutomationAdapter.ts
 *
 * Enterprise Unified Browser Automation Adapter via Playwright-core & CDP:
 * 1. CDP Connection Management: connects via playwright-core chromium.connectOverCDP('http://127.0.0.1:<port>').
 * 2. Multi-Session Isolation: maintains independent sessions for providers ('chatgpt', 'flow', 'generic')
 *    without cross-talk or resource contention.
 * 3. Strict Persistent Context Reuse: always binds to browser.contexts()[0] to preserve cookies,
 *    localStorage, and login sessions; NEVER creates ephemeral incognito contexts via newContext().
 * 4. Tab Discovery & Routing Engine: locates tabs via flexible predicates (string, RegExp, function),
 *    repurposes recyclable blank tabs, and navigates safely.
 * 5. Connection Resilience: per-provider mutex to prevent connection storms, exponential backoff
 *    reconnection with jitter, and self-healing cleanup on disconnect/crash.
 * 6. Safe Detachment: disconnects CDP WebSocket via browser.disconnect() without killing the running Chrome instance.
 * 7. Port Isolation Guard: strictly forbids port 9222 (reserved for FlowBridgeServer).
 * 8. Lifecycle Observability: emits EventEmitter events ('connected', 'disconnected', 'targetcreated', 'targetdestroyed', 'targetcrashed').
 */

import { EventEmitter } from 'events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import {runApprovedT2i} from './FlowT2iSubmission';
import {
  type AutomationProvider,
  type BrowserSession,
  type BrowserConnectionOptions,
  type TabPredicate,
  type TabRoutingOptions,
  type SessionRecord,
  type FlowGenerationAutomationOptions,
  type FlowGenerationAutomationResult,
  type FlowSessionState,
  type FlowSessionDiagnostic,
  RESERVED_BRIDGE_PORT,
  DEFAULT_PROVIDER_PORTS,
  DEFAULT_GENERIC_PORT,
  PortConflictError,
  CdpConnectionError,
  BrowserNotConnectedError,
  PersistentContextNotFoundError,
  assertNotReservedPort,
} from './types';

export class BrowserAutomationAdapter extends EventEmitter {
  private static instance: BrowserAutomationAdapter | null = null;

  private sessions = new Map<AutomationProvider, SessionRecord>();
  private inFlightConnections = new Map<AutomationProvider, Promise<BrowserSession>>();
  private inFlightDisconnections = new Map<AutomationProvider, Promise<void>>();
  private automationOwnedPages = new WeakSet<Page>();

  private constructor() {
    super();
    // Allow high listener count across multi-scene pipelines
    this.setMaxListeners(50);
  }

  public static getInstance(): BrowserAutomationAdapter {
    if (!BrowserAutomationAdapter.instance) {
      BrowserAutomationAdapter.instance = new BrowserAutomationAdapter();
    }
    return BrowserAutomationAdapter.instance;
  }

  public static resetInstance(): void {
    if (BrowserAutomationAdapter.instance) {
      BrowserAutomationAdapter.instance.cleanupAllReferences();
      BrowserAutomationAdapter.instance = null;
    }
  }

  public markTabAsAutomationOwned(page: Page): void {
    this.automationOwnedPages.add(page);
  }

  public isTabAutomationOwned(page: Page): boolean {
    return this.automationOwnedPages.has(page);
  }

  /**
   * Resolves default port for a provider.
   */
  public getDefaultPort(provider: AutomationProvider): number {
    return DEFAULT_PROVIDER_PORTS[provider] ?? DEFAULT_GENERIC_PORT;
  }

  /**
   * Connects to a Chrome instance over CDP for a given provider.
   * If already connected, returns existing session immediately.
   * If a connection is in-flight for this provider, returns the pending promise (Mutex).
   */
  public async connect(options: BrowserConnectionOptions): Promise<BrowserSession> {
    const provider = options.provider ?? 'generic';
    const rawPort = options.port ?? this.getDefaultPort(provider);

    // Port 9222 Isolation Guard with numeric coercion
    assertNotReservedPort(rawPort);
    const effectivePort = Number(String(rawPort).trim());
    if (effectivePort === RESERVED_BRIDGE_PORT) {
      throw new PortConflictError(effectivePort);
    }

    // Defect 3 Fix: Await any in-flight disconnect for this provider before connecting
    while (this.inFlightDisconnections.has(provider)) {
      try {
        await this.inFlightDisconnections.get(provider);
      } catch {
        break;
      }
    }

    // Fast-path: return alive session (strictly ignore dying/disconnecting sessions)
    const existing = this.sessions.get(provider);
    if (existing && !existing.isDisconnecting && existing.browser.isConnected()) {
      return {
        provider,
        browser: existing.browser,
        context: existing.context,
        port: existing.port,
        activePage: existing.activePage ?? undefined,
        connectedAt: existing.lastConnectedAt,
      };
    }

    // Mutex: await existing in-flight connection for this provider
    const inFlight = this.inFlightConnections.get(provider);
    if (inFlight) {
      return await inFlight;
    }

    const connectionPromise = this.internalConnectWithRetry(
      { ...options, provider },
      effectivePort
    );
    this.inFlightConnections.set(provider, connectionPromise);

    try {
      return await connectionPromise;
    } finally {
      this.inFlightConnections.delete(provider);
    }
  }

  /**
   * Internal connection loop with exponential backoff retry and jitter.
   */
  private async internalConnectWithRetry(
    options: BrowserConnectionOptions,
    port: number
  ): Promise<BrowserSession> {
    const provider = options.provider ?? 'generic';
    const host = options.host ?? '127.0.0.1';
    const timeoutMs = options.timeoutMs ?? 10000;
    const maxRetries = options.maxRetries ?? 5;
    const baseDelayMs = options.retryBaseDelayMs ?? 500;
    const backoffFactor = 1.5;
    const endpoint = `http://${host}:${port}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let browser: Browser | null = null;
      try {
        browser = await chromium.connectOverCDP(endpoint, {
          timeout: timeoutMs,
        });

        // Resilience for test mocks and reconnected instances
        if (typeof (browser as any)._isConnected === 'boolean' && !(browser as any)._isConnected) {
          (browser as any)._isConnected = true;
        }

        // Acquire persistent context (contexts()[0])
        const context = await this.acquirePersistentContext(browser, provider);

        const sessionRecord: SessionRecord = {
          provider,
          port,
          host,
          browser,
          context,
          activePage: null,
          isDisconnecting: false,
          reconnectAttempts: 0,
          lastConnectedAt: Date.now(),
          trackedPages: new WeakSet(),
          disconnectedEmitted: false,
        };

        this.sessions.set(provider, sessionRecord);
        this.bindBrowserLifecycle(browser, sessionRecord);
        this.bindContextLifecycle(context, sessionRecord);

        const session: BrowserSession = {
          provider,
          browser,
          context,
          port,
          connectedAt: sessionRecord.lastConnectedAt,
        };

        this.emit('connected', provider, session);
        return session;
      } catch (err: any) {
        if (browser) {
          try {
            await ((browser as any).disconnect?.() ?? browser.close());
          } catch {
            // Silently swallow cleanup errors
          }
        }
        lastError = err;
        if (attempt < maxRetries) {
          const delay =
            Math.round(baseDelayMs * Math.pow(backoffFactor, attempt - 1)) +
            Math.floor(Math.random() * 100);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new CdpConnectionError(
      provider,
      endpoint,
      maxRetries,
      `Failed to connect to Chrome over CDP after ${maxRetries} attempts. ` +
      `Ensure Chrome was launched with --remote-debugging-port=${port} and proper user-data-dir. Last error: ${lastError?.message || lastError}`,
      lastError || undefined
    );
  }

  /**
   * Strictly acquires the persistent browser context (contexts()[0]).
   * Refuses to call browser.newContext() to prevent wiping login sessions and cookies.
   */
  private async acquirePersistentContext(
    browser: Browser,
    provider: AutomationProvider
  ): Promise<BrowserContext> {
    let contexts = browser.contexts();
    if (contexts.length > 0) {
      return contexts[0];
    }

    // Defensive polling for context initialization
    const maxPolls = 10;
    const pollIntervalMs = 100;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      contexts = browser.contexts();
      if (contexts.length > 0) {
        return contexts[0];
      }
    }

    throw new PersistentContextNotFoundError(provider);
  }

  /**
   * Discovers a tab matching the given predicate in the provider's persistent context.
   */
  public async findTab(
    provider: AutomationProvider,
    predicate: TabPredicate
  ): Promise<Page | null> {
    const session = this.sessions.get(provider);
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      return null;
    }

    const pages = session.context.pages().filter((p) => !p.isClosed());
    for (const page of pages) {
      if (await this.matchesPredicate(page, predicate)) {
        return page;
      }
    }
    return null;
  }

  /**
   * Discovers an existing tab matching the criteria, repurposes an idle blank tab,
   * or creates a new tab in the persistent context and navigates to targetUrl.
   */
  public async getOrCreateTab(
    provider: AutomationProvider,
    options: TabRoutingOptions
  ): Promise<Page> {
    let session = this.sessions.get(provider);
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      await this.connect({ provider });
      session = this.sessions.get(provider)!;
    }

    const context = session.context;
    const pages = context.pages().filter((p) => !p.isClosed());

    // 1. Try finding existing tab by predicate or targetUrl
    const searchPredicate =
      options.predicate ?? (options.targetUrl ? options.targetUrl : undefined);
    if (searchPredicate) {
      for (const page of pages) {
        if ((!options.automationOwned || this.isTabAutomationOwned(page)) && await this.matchesPredicate(page, searchPredicate)) {
          this.bindPageLifecycle(page, session);
          if (options.bringToFront === true) {
            await page.bringToFront().catch(() => {});
          }
          if (options.automationOwned) {
            this.markTabAsAutomationOwned(page);
          }
          session.activePage = page;
          return page;
        }
      }
    }

    // 2. If targetUrl is provided, look for a recyclable blank tab
    let targetPage: Page | null = null;
    if (options.repurposeBlank !== false) {
      const blankPage = pages.find((p) => {
        try {
          const url = p.url();
          return (
            url === 'about:blank' ||
            url === '' ||
            url.startsWith('chrome://newtab') ||
            url.startsWith('chrome://')
          );
        } catch {
          return false;
        }
      });
      if (blankPage && (!options.automationOwned || this.isTabAutomationOwned(blankPage))) {
        targetPage = blankPage;
      }
    }

    // 3. Fallback: create a new tab in the persistent context
    if (!targetPage) {
      targetPage = await context.newPage();
      this.markTabAsAutomationOwned(targetPage);
    } else {
      if (options.automationOwned) {
        this.markTabAsAutomationOwned(targetPage);
      }
    }

    this.bindPageLifecycle(targetPage, session);

    // 4. Navigate if targetUrl is provided and not already matching
    if (options.targetUrl) {
      let needsNavigation = true;
      try {
        if (targetPage.url() === options.targetUrl) {
          needsNavigation = false;
        }
      } catch {
        needsNavigation = true;
      }

      if (needsNavigation) {
        await targetPage.goto(options.targetUrl, {
          waitUntil: options.waitUntil ?? 'domcontentloaded',
          timeout: options.timeoutMs ?? 30000,
        });
      }
    }

    if (options.bringToFront === true) {
      await targetPage.bringToFront().catch(() => {});
    }

    session.activePage = targetPage;
    return targetPage;
  }

  /**
   * Lists all open, active tabs for a provider.
   */
  public listTabs(provider: AutomationProvider): Page[] {
    const session = this.sessions.get(provider);
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      return [];
    }
    return session.context.pages().filter((p) => !p.isClosed());
  }

  /**
   * Safely closes a specific tab.
   */
  public async closeTab(provider: AutomationProvider, page: Page): Promise<void> {
    const session = this.sessions.get(provider);
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    if (session && session.activePage === page) {
      session.activePage = null;
    }
  }

  /**
   * Disconnects the Playwright CDP WebSocket connection for a provider.
   * Keeps the Google Chrome process, windows, and login session completely intact.
   */
  public async disconnect(provider: AutomationProvider): Promise<void> {
    // Mutex: if a disconnect is already in-flight for this provider, await it
    const existingInFlightDisc = this.inFlightDisconnections.get(provider);
    if (existingInFlightDisc) {
      return await existingInFlightDisc;
    }

    const disconnectPromise = this.internalDisconnect(provider);
    this.inFlightDisconnections.set(provider, disconnectPromise);

    try {
      await disconnectPromise;
    } finally {
      this.inFlightDisconnections.delete(provider);
    }
  }

  private async internalDisconnect(provider: AutomationProvider): Promise<void> {
    // Defect 4 Fix: If a connect is in-flight for this provider, await it so disconnect is not dropped
    const inFlightConn = this.inFlightConnections.get(provider);
    if (inFlightConn) {
      try {
        await inFlightConn;
      } catch {
        // In-flight connection failed; nothing to disconnect
      }
    }

    const session = this.sessions.get(provider);
    if (!session || session.isDisconnecting) {
      return;
    }

    session.isDisconnecting = true;
    try {
      if (session.browser && session.browser.isConnected()) {
        if (typeof (session.browser as any).disconnect === 'function') {
          await (session.browser as any).disconnect();
        } else {
          await session.browser.close();
        }
      }
    } catch (err: any) {
      console.warn(
        `[BrowserAutomationAdapter] Warning during detach of '${provider}':`,
        err?.message || err
      );
    } finally {
      this.sessions.delete(provider);
      session.activePage = null;
      if (!session.disconnectedEmitted) {
        session.disconnectedEmitted = true;
        this.emit('disconnected', provider, 'graceful_detach');
      }
    }
  }

  /**
   * Disconnects all active CDP sessions.
   */
  public async disconnectAll(): Promise<void> {
    const providers = Array.from(
      new Set([
        ...this.sessions.keys(),
        ...this.inFlightConnections.keys(),
        ...this.inFlightDisconnections.keys(),
      ])
    );
    await Promise.allSettled(providers.map((p) => this.disconnect(p)));
  }

  /**
   * Evaluates predicate against page.
   */
  private async matchesPredicate(page: Page, predicate: TabPredicate): Promise<boolean> {
    if (page.isClosed()) return false;
    let url = '';
    let title = '';
    try {
      url = page.url();
    } catch {
      return false;
    }
    // URL routing does not require a responsive page execution context.
    if (typeof predicate === 'string' && url.includes(predicate)) return true;
    if (predicate instanceof RegExp && predicate.test(url)) return true;
    try {
      if (typeof (page as any).title === 'function') {
        let titleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          title = await Promise.race([page.title().catch(() => ''), new Promise<string>(resolve => { titleTimer = setTimeout(() => resolve(''), 800); })]);
        } finally { if (titleTimer) clearTimeout(titleTimer); }
      }
    } catch {
      // Title optional
    }

    if (typeof predicate === 'string') {
      return url.includes(predicate) || title.includes(predicate);
    }
    if (predicate instanceof RegExp) {
      return predicate.test(url) || predicate.test(title);
    }
    if (typeof predicate === 'function') {
      try {
        return await (predicate as any)(page, title);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Attaches page lifecycle listeners.
   */
  private bindPageLifecycle(page: Page, session: SessionRecord): void {
    if (!session.trackedPages) {
      session.trackedPages = new WeakSet();
    }
    if (session.trackedPages.has(page)) return;
    session.trackedPages.add(page);

    page.on('close', () => {
      if (session.activePage === page) {
        session.activePage = null;
      }
      this.emit('targetdestroyed', session.provider, page);
      this.emit('pageclosed', session.provider, page);
    });

    page.on('crash', () => {
      console.warn(`[BrowserAutomationAdapter] Page crashed for provider '${session.provider}'.`);
      if (session.activePage === page) {
        session.activePage = null;
      }
      this.emit('targetcrashed', session.provider, page);
      this.emit('pagecrashed', session.provider, page);
    });
  }

  /**
   * Attaches context lifecycle listeners.
   */
  private bindContextLifecycle(context: BrowserContext, session: SessionRecord): void {
    for (const page of context.pages()) {
      this.bindPageLifecycle(page, session);
    }

    context.on('page', (page: Page) => {
      this.bindPageLifecycle(page, session);
      this.emit('targetcreated', session.provider, page);
      this.emit('pagecreated', session.provider, page);
    });
  }

  /**
   * Attaches browser lifecycle listeners.
   */
  private bindBrowserLifecycle(browser: Browser, session: SessionRecord): void {
    browser.on('disconnected', () => {
      const wasGraceful = session.isDisconnecting;
      this.sessions.delete(session.provider);
      session.activePage = null;

      const reason = wasGraceful ? 'graceful_detach' : 'unexpected_cdp_drop';
      if (!wasGraceful) {
        console.warn(`[BrowserAutomationAdapter] Unexpected CDP disconnection for '${session.provider}'.`);
      }
      if (!session.disconnectedEmitted) {
        session.disconnectedEmitted = true;
        this.emit('disconnected', session.provider, reason);
      }
    });
  }

  /**
   * Cleanup internal references.
   */
  private cleanupAllReferences(): void {
    this.sessions.clear();
    this.inFlightConnections.clear();
    this.inFlightDisconnections.clear();
    this.automationOwnedPages = new WeakSet<Page>();
    this.removeAllListeners();
  }

  // Accessors
  public getSession(provider: AutomationProvider): BrowserSession | null {
    const s = this.sessions.get(provider);
    if (!s || s.isDisconnecting || !s.browser.isConnected()) return null;
    return {
      provider,
      browser: s.browser,
      context: s.context,
      port: s.port,
      activePage: s.activePage ?? undefined,
      connectedAt: s.lastConnectedAt,
    };
  }

  public isConnected(provider: AutomationProvider): boolean {
    const s = this.sessions.get(provider);
    return !!(s && !s.isDisconnecting && s.browser.isConnected());
  }

  public getBrowser(provider: AutomationProvider): Browser | null {
    const s = this.sessions.get(provider);
    return s && !s.isDisconnecting && s.browser.isConnected() ? s.browser : null;
  }

  public getContext(provider: AutomationProvider): BrowserContext | null {
    const s = this.sessions.get(provider);
    return s && !s.isDisconnecting && s.browser.isConnected() ? s.context : null;
  }

  /** Read-only, scoped to the prompt UI; absent/ambiguous data stays unknown. No account text returned. */
  public async inspectFlowCreditState(page: Page, expectedModel: string) {
    // The current Flow UI keeps the selected mode and quote in the settings overlay.
    // Open only that menu; never select a model, change output count or submit here.
    let opened = false;
    const panel = page.locator('flow-prompt-box-settings');
    const trigger = page.locator('button.settings-trigger-button, button[aria-label="Điều kiện kích hoạt cài đặt"]').first();
    try {
      if (!(await panel.isVisible().catch(() => false)) && await trigger.isVisible().catch(() => false)) {
        await trigger.click({timeout:3000}); opened = true;
        await panel.waitFor({state:'visible',timeout:3000});
      }
      return await page.evaluate((expected) => {
      const root=document.querySelector('flow-prompt-box, flow-prompt-container, [data-testid="prompt-box"]');
      const text=root?.textContent||'';
      const settings=Array.from(document.querySelectorAll('flow-prompt-box-settings')).filter(e=>!!(e as HTMLElement).getClientRects().length);
      const scope=settings.length===1?settings[0]:root;
      const controls=scope?Array.from(scope.querySelectorAll('button,[role="radio"][aria-checked="true"],[data-testid="selected-model"],[data-testid="generation-mode"]')).filter(e=>!!(e as HTMLElement).getClientRects().length):[];
      const modelControls=settings.length===1?controls.filter(e=>/^(Chọn nhóm mô hình|Select model group)$/i.test(e.getAttribute('aria-label')||'')):controls;
      const modelTexts=[] as string[];
      for(const e of modelControls){const copy=e.cloneNode(true) as HTMLElement;for(const icon of Array.from(copy.querySelectorAll('mat-icon,.material-icons,.material-symbols-rounded')))icon.remove();modelTexts.push((copy.textContent||'').normalize('NFKC').replace(/^[\s🍌]+/u,'').replace(/\s+/g,' ').trim());}
      const matches=modelTexts.filter(t=>t===expected.normalize('NFKC').replace(/\s+/g,' ').trim());
      const model=matches.length===1?expected:null;
      const selected=controls.filter(e=>e.getAttribute('aria-checked')==='true');
      const counts=settings.length===1?selected.map(e=>(e.textContent||'').trim()).filter(t=>/^[x×]\s*\d+$/i.test(t)).map(t=>Number(t.replace(/^[x×]\s*/i,''))):[...text.matchAll(/(?:^|\s)[x×]\s*(\d+)(?=\s|$)/gi)].map(m=>Number(m[1]));
      const modes=selected.map(e=>(e.textContent||'').toLowerCase());
      const image=modes.some(t=>/image|hình ảnh/.test(t)),video=modes.some(t=>/video/.test(t));
      const mode=image!==video?(video?'video':'image'):null;
      const quoteText=settings.length===1?settings[0].textContent||'':text;
      const prices=[...quoteText.matchAll(/(\d+(?:\.\d+)?)\s*(?:credits|tín dụng)\s*(?:per generation|\/\s*(?:generation|output))/gi)].map(m=>Number(m[1]));
      if(settings.length===1)for(const m of quoteText.matchAll(/(?:quá trình tạo sẽ tốn|generation will cost|this generation costs)\s*(\d+(?:\.\d+)?)\s*(?:credits|tín dụng)/gi))prices.push(Number(m[1]));
      const balanceText=document.querySelector('[data-testid="credit-balance"]')?.textContent?.trim();
      const balance=balanceText&&/^\d+$/.test(balanceText)?Number(balanceText):null;
      const alerts=Array.from(document.querySelectorAll('[role="alert"],.error-banner')).map(e=>e.textContent||'').join(' ');
      return {model,outputs:counts.length===1?counts[0]:null,mode,credits:prices.length===1?prices[0]:null,balance,
        blocked:!!document.querySelector('iframe[src*="bframe"]')||/unusual activity|bất thường|captcha|rate limit|insufficient credits|not enough credits/i.test(alerts),
        hasReferences:!!root?.querySelector('[data-media-id],flow-reference-chip,[data-asset-id]')};
      },expectedModel);
    } finally {
      if (opened) { await page.keyboard.press('Escape'); await panel.waitFor({state:'hidden',timeout:3000}); }
    }
  }

  public getActivePage(provider: AutomationProvider): Page | null {
    const s = this.sessions.get(provider);
    if (!s || s.isDisconnecting || !s.browser.isConnected()) return null;
    return s.activePage;
  }

  /**
   * Resiliently evaluates the Google Flow session state (FLOW_READY, FLOW_LOADING, LOGIN_REQUIRED, SESSION_UNVERIFIED).
   * Verifies actual UI components, avoids false positives on internal iframes (RotateCookiesPage),
   * and sanitizes diagnostic logs without exposing credentials.
   */
  public async evaluateFlowSessionState(page: Page): Promise<FlowSessionDiagnostic> {
    try {
      const raw = await page.evaluate(() => {
        const href = window.location.href;
        const title = document.title || '';

        // 1. Check explicit login URL (ignore background targets like RotateCookiesPage)
        const isLoginUrl =
          href.includes('accounts.google.com/signin') ||
          href.includes('accounts.google.com/ServiceLogin') ||
          href.includes('accounts.google.com/v3/signin');

        // 2. Check Sign In button in DOM
        const signInBtn = document.querySelector(
          'a[href*="ServiceLogin"], a[href*="signin"], a[href*="AccountChooser"], button[aria-label*="Đăng nhập" i], button[aria-label*="Sign in" i]'
        );

        // 3. Check User Account / Avatar / Identity
        const accountEl = document.querySelector(
          'a[aria-label*="Tài khoản Google" i], a[aria-label*="Google Account" i], button[aria-label*="Tài khoản Google" i], [aria-label*="Account" i], flow-account-menu, [data-identifier], img[src*="googleusercontent.com/a/"]'
        );
        let accountSnippet: string | undefined;
        if (accountEl) {
          const rawText = (accountEl.getAttribute('aria-label') || accountEl.textContent || '').trim();
          accountSnippet = rawText.replace(/([a-zA-Z0-9_\-\.]{2})[a-zA-Z0-9_\-\.]*(@[a-zA-Z0-9_\-\.]+)/g, '$1***$2').slice(0, 80);
        }

        // 4. Check Prompt Box
        const promptEl = document.querySelector(
          '.ProseMirror, flow-prompt-box, flow-base-prompt-box, .prompt-box-container, textarea, [contenteditable="true"]'
        );

        // 5. Check Generate Button
        const genBtn = document.querySelector(
          'flow-generate-icon-button button, button.generate-icon-button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="tạo" i], button[aria-label*="generate" i], button[aria-label*="create" i]'
        );

        // 6. Check Project container & ID
        const projectContainer = document.querySelector(
          'flow-project-view, flow-gallery, flow-stage, flow-canvas, .gallery-container, .main-content'
        );
        const pidMatch = href.match(/\/project\/([0-9a-f-]{36}|[a-zA-Z0-9_-]{8,})/i);
        const projectId = pidMatch ? pidMatch[1] : null;

        // 6.5 Check Dashboard project cards & new project button
        const dashboardProjectCards = document.querySelectorAll(
          'a[href*="/project/"], a[aria-label*="Mở dự án" i], a[aria-label*="Open project" i]'
        );
        const newProjBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
          const txt = (el.textContent || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          return (
            txt.includes('dự án mới') ||
            txt.includes('new project') ||
            aria.includes('dự án mới') ||
            aria.includes('new project')
          );
        });
        const hasDashboardProjects = dashboardProjectCards.length > 0 || !!newProjBtn;

        // 7. Check loading indicator
        const loadingIndicator = document.querySelector(
          'mat-progress-spinner, mat-spinner, flow-loading-indicator, .loading-screen, .app-loading'
        );

        return {
          href,
          title,
          isLoginUrl,
          hasSignInBtn: !!signInBtn,
          hasAccount: !!accountEl,
          accountSnippet,
          hasPromptBox: !!promptEl,
          hasGenerateButton: !!genBtn,
          isProjectLoaded: !!projectId || !!projectContainer,
          hasDashboardProjects,
          projectId,
          hasLoading: !!loadingIndicator,
        };
      });

      let state: FlowSessionState = 'SESSION_UNVERIFIED';
      let diagnosticMessage = '';

      if (raw.isLoginUrl || (raw.hasSignInBtn && !raw.hasAccount && !raw.hasPromptBox)) {
        state = 'LOGIN_REQUIRED';
        diagnosticMessage = 'Trình duyệt đang ở màn hình đăng nhập hoặc yêu cầu xác thực tài khoản Google.';
      } else if (raw.hasLoading && !raw.hasPromptBox) {
        state = 'FLOW_LOADING';
        diagnosticMessage = 'Google Flow đang tải tài nguyên hoặc giao diện dự án...';
      } else if (
        raw.hasAccount && !raw.hasSignInBtn &&
        ((raw.hasPromptBox && raw.hasGenerateButton && !!raw.projectId) || raw.hasDashboardProjects)
      ) {
        state = 'FLOW_READY';
        diagnosticMessage =
          raw.hasPromptBox || raw.isProjectLoaded
            ? 'Google Flow đã sẵn sàng với phiên đăng nhập và giao diện dự án hợp lệ.'
            : 'Google Flow đã đăng nhập thành công trên bảng điều khiển dự án (Dashboard).';
      } else {
        state = 'SESSION_UNVERIFIED';
        diagnosticMessage = 'Chưa đủ bằng chứng UI để xác minh Flow. Không suy đăng nhập từ prompt box hoặc việc không thấy nút đăng nhập.';
      }

      return {
        state,
        url: raw.href,
        title: raw.title,
        hasPromptBox: raw.hasPromptBox,
        hasGenerateButton: raw.hasGenerateButton,
        hasAvatarOrAccount: raw.hasAccount,
        accountSnippet: raw.accountSnippet,
        hasSignInButton: raw.hasSignInBtn,
        isProjectLoaded: raw.isProjectLoaded,
        projectId: raw.projectId,
        loadingIndicatorPresent: raw.hasLoading,
        diagnosticMessage,
      };
    } catch (evalErr: any) {
      return {
        state: 'SESSION_UNVERIFIED',
        url: page.url(),
        title: '',
        hasPromptBox: false,
        hasGenerateButton: false,
        hasAvatarOrAccount: false,
        hasSignInButton: false,
        isProjectLoaded: false,
        loadingIndicatorPresent: false,
        diagnosticMessage: `Lỗi kiểm tra session: ${evalErr?.message || evalErr}`,
      };
    }
  }

  /**
   * Discovers an active Google Flow project tab on port 9224 and returns its projectId and URL.
   */
  public async discoverActiveFlowProject(
    preferredProjectId?: string
  ): Promise<{ projectId: string; url: string } | null> {
    let session = this.sessions.get('flow');
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      try {
        await this.connect({ provider: 'flow' });
        session = this.sessions.get('flow') || undefined;
      } catch {
        return null;
      }
    }
    if (!session || !session.context) return null;

    const pages = session.context.pages();
    if (preferredProjectId) {
      for (const p of pages) {
        const u = p.url();
        if (u.includes(`/project/${preferredProjectId}`)) {
          return { projectId: preferredProjectId, url: u };
        }
      }
    }
    for (const p of pages) {
      const u = p.url();
      const m = u.match(/\/project\/([0-9a-f-]{36}|[a-zA-Z0-9_-]{8,})/i);
      if (m && m[1]) {
        return { projectId: m[1], url: u };
      }
    }
    return null;
  }

  /**
   * Executes Flow image/video generation over CDP via Playwright.
   */
  public async executeFlowGeneration(
    options: FlowGenerationAutomationOptions
  ): Promise<FlowGenerationAutomationResult> {
    if(options.mode==='image')return runApprovedT2i(this,options);
    const { prompt, projectId, mode, signal } = options;
    if (options.requireCreditApproval && (!options.beforeSubmit || !projectId)) return {ok:false,state:'FAILED',error:'FLOW_CREDIT_APPROVAL_REQUIRED',errorCode:'FLOW_CREDIT_APPROVAL_REQUIRED'};
    const isVideo = mode === 'video';
    const submissionTimeoutMs = options.submissionTimeoutMs || 6000;
    const processingTimeoutMs = options.timeoutMs || (isVideo ? 120000 : 40000);

    if (signal?.aborted) {
      return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
    }

    // 1. Ensure connected to provider 'flow' (port 9224)
    let session = this.sessions.get('flow');
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      try {
        await this.connect({ provider: 'flow' });
        session = this.sessions.get('flow')!;
      } catch (connErr: any) {
        return {
          ok: false,
          state: 'FAILED',
          error: `Failed to connect Playwright to Chrome on port 9224: ${connErr?.message || connErr}`,
          errorCode: 'UI_AUTOMATION_FAILED',
        };
      }
    }

    // 2. Discover Flow tab (strictly isolate by projectId if specified)
    const targetUrl = projectId
      ? `https://flow.google.com/project/${projectId}`
      : 'https://flow.google.com';

    let page: Page;
    try {
      page = await this.getOrCreateTab('flow', {
        targetUrl,
        bringToFront: options.bringToFront === true,
        repurposeBlank: false,
        automationOwned: true,
        predicate: (pageOrUrl, title) => {
          const url = typeof pageOrUrl === 'string' ? pageOrUrl : pageOrUrl.url();
          if (projectId) {
            // Strictly match tab belonging to THIS specific projectId
            return url.includes(`/project/${projectId}`);
          }
          return (
            url.includes('flow.google.com') ||
            url.includes('labs.google') ||
            (typeof title === 'string' && title.toLowerCase().includes('flow'))
          );
        },
        timeoutMs: 20000,
      });
      this.markTabAsAutomationOwned(page);

      // If currently on Google Flow dashboard without an explicit projectId, route into the first active project
      if (page.url().replace(/\/+$/, '') === 'https://flow.google.com') {
        try {
          const firstProjHref = await page.evaluate(() => {
            const firstA = document.querySelector('a[href*="/project/"]') as HTMLAnchorElement | null;
            return firstA ? firstA.href : null;
          });
          if (firstProjHref) {
            await page.goto(firstProjHref, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(1000);
          }
        } catch {
          // Continue gracefully
        }
      }
    } catch (tabErr: any) {
      return {
        ok: false,
        state: 'FAILED',
        error: `Failed to open or route Google Flow tab: ${tabErr?.message || tabErr}`,
        errorCode: 'UI_AUTOMATION_FAILED',
      };
    }

    // 3. Resilient Session State Machine (LOGIN_REQUIRED, FLOW_LOADING, FLOW_READY, SESSION_UNVERIFIED)
    let sessionStatus = await this.evaluateFlowSessionState(page);
    if (sessionStatus.state === 'FLOW_LOADING') {
      const loadStart = Date.now();
      while (Date.now() - loadStart < 15000 && sessionStatus.state === 'FLOW_LOADING') {
        if (signal?.aborted) {
          return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
        }
        await new Promise((r) => setTimeout(r, 1000));
        sessionStatus = await this.evaluateFlowSessionState(page);
      }
    }

    if (sessionStatus.state === 'LOGIN_REQUIRED') {
      return {
        ok: false,
        state: 'BLOCKED_REQUIRES_USER',
        error: `GOOGLE_SIGNIN_REQUIRED: ${sessionStatus.diagnosticMessage}`,
        errorCode: 'BLOCKED_REQUIRES_USER',
      };
    }

    if (sessionStatus.state === 'SESSION_UNVERIFIED') {
      return {
        ok: false,
        state: 'FAILED',
        error: `SESSION_UNVERIFIED: ${sessionStatus.diagnosticMessage}`,
        errorCode: 'UI_AUTOMATION_FAILED',
      };
    }

    // 3.5 Mode switching (image vs video)
    try {
      const settingsBtn = page.locator('button.settings-trigger-button, button[aria-label*="Điều kiện kích hoạt" i]').first();
      if (await settingsBtn.isVisible().catch(() => false)) {
        const btnText = (await settingsBtn.textContent().catch(() => '') || '').toLowerCase();
        const isAlreadyImage =
          (btnText.includes('hình ảnh') || btnText.includes('image') || btnText.includes('banana')) &&
          !btnText.includes('video');
        const isAlreadyVideo = btnText.includes('video') || btnText.includes('veo') || btnText.includes('360p') || btnText.includes('720p');
        const needsSwitch = isVideo ? !isAlreadyVideo : !isAlreadyImage;
        if (needsSwitch) {
          let isSettingsOpen = await page.evaluate(() => Boolean(document.querySelector('flow-prompt-box-settings'))).catch(() => false);
          if (!isSettingsOpen) {
            await settingsBtn.click({ force: true });
            await page.waitForTimeout(500);
          }
          isSettingsOpen = await page.evaluate(() => Boolean(document.querySelector('flow-prompt-box-settings'))).catch(() => false);
          if (!isSettingsOpen) {
            await settingsBtn.click().catch(() => {});
            await page.waitForTimeout(600);
          }
          const radioBtn = !isVideo
            ? page.locator('flow-prompt-box-settings button[role="radio"], .cdk-overlay-container button[role="radio"]').filter({ hasText: /hình ảnh|image|banana/i }).first()
            : page.locator('flow-prompt-box-settings button[role="radio"], .cdk-overlay-container button[role="radio"]').filter({ hasText: /video/i }).first();
          if (await radioBtn.isVisible().catch(() => false)) {
            await radioBtn.click();
          } else {
            await page.evaluate((mode) => {
              const elements = Array.from(document.querySelectorAll('.cdk-overlay-container .toggle-text, .cdk-overlay-container .toggle-label, .cdk-overlay-container mat-button-toggle, mat-button-toggle, .toggle-text'));
              const target = elements.find((el) => {
                const txt = (el.textContent || '').trim().toLowerCase();
                if (mode === 'image') return txt === 'hình ảnh' || txt === 'image';
                return txt === 'video';
              });
              if (target) {
                const clickable = (target.closest('mat-button-toggle, button, .toggle') || target) as HTMLElement;
                clickable.click();
              }
            }, isVideo ? 'video' : 'image');
          }
          await page.waitForTimeout(400);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }
    } catch {
      // Gracefully continue if mode switch is not supported or already correct
    }

    // 4. Baseline snapshot (Stage 0)
    const preFlight = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('flow-grid-tile-container, flow-tile-container, flow-image-tile, flow-video-tile, flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item'));
      const cardIds = cards.map((c) => c.getAttribute('data-asset-id') || c.getAttribute('data-id') || c.id).filter(Boolean);
      const imgUrls = Array.from(document.querySelectorAll('flow-grid-tile-container flow-image-tile img, flow-grid-tile-container img, flow-tile-container img, flow-asset-card img, flow-media-tile img, mat-card img, [data-asset-id] img'))
        .map((im: any) => im.src || im.currentSrc)
        .filter(Boolean);
      const videoUrls: string[] = [];
      document.querySelectorAll('flow-grid-tile-container flow-video-tile video, flow-grid-tile-container video, flow-tile-container video, flow-asset-card video, flow-media-tile video, mat-card video, [data-asset-id] video').forEach((v: any) => {
        if (v.src) videoUrls.push(v.src);
        if (v.currentSrc) videoUrls.push(v.currentSrc);
        v.querySelectorAll('source').forEach((s: any) => { if (s.src) videoUrls.push(s.src); });
      });
      return { cardIds, imgUrls, videoUrls, imageTiles:document.querySelectorAll('flow-image-tile').length, videoTiles:document.querySelectorAll('flow-video-tile').length, timestamp: Date.now() };
    }).catch(() => null);
    if(!preFlight)return {ok:false,state:'FAILED',error:'FLOW_BASELINE_UNVERIFIED: không có snapshot an toàn; không submit.',errorCode:'FLOW_BASELINE_UNVERIFIED'};

    if (signal?.aborted) {
      return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
    }

    // 5. Input prompt and handle keyframe attachment (if I2V inputImageAsset is provided)
    try {
      // Clear previous prompt/chips if clear button exists
      const clearBtn = page.locator('button.clear-button, button[aria-label*="Xoá" i]').first();
      if (await clearBtn.isVisible().catch(() => false)) {
        await clearBtn.click();
        await page.waitForTimeout(300);
      }

      // If an input keyframe asset is specified for Video mode, attach it as prompt reference chip
      if (isVideo && options.inputImageAsset) {
        const assetUuid = options.inputImageAsset.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
        let keyframeTile: any = null;
        if (assetUuid) {
          keyframeTile = page.locator(`img[data-media-id="${assetUuid}"], flow-image-tile:has(img[data-media-id="${assetUuid}"]), [data-asset-id="${assetUuid}"]`).first();
          if (!await keyframeTile.isVisible().catch(() => false)) {
            keyframeTile = page.locator(`flow-grid-tile-container:has(img[src*="${assetUuid}"])`).first();
          }
        }
        if ((!keyframeTile || !await keyframeTile.isVisible().catch(() => false)) && options.inputImageAsset.startsWith('http')) {
          keyframeTile = page.locator(`flow-grid-tile-container:has(img[src*="${options.inputImageAsset.split('?')[0]}"])`).first();
        }

        // STRICT: If not found, DO NOT fallback to .first()! Throw clear error!
        if (!keyframeTile || !await keyframeTile.isVisible().catch(() => false)) {
          throw new Error(`STRICT_I2V_PROVENANCE_ERROR: Không tìm thấy keyframe tile với ID "${options.inputImageAsset}" trong DOM. Từ chối chọn ngẫu nhiên ảnh khác.`);
        }

        await keyframeTile.click({ button: 'right' });
        await page.waitForTimeout(500);

        const addToPromptBtn = page.locator('.cdk-overlay-container button').filter({ hasText: /Thêm vào câu lệnh|Add to prompt/i }).first();
        if (await addToPromptBtn.isVisible().catch(() => false)) {
          await addToPromptBtn.click();
          await page.waitForTimeout(800);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        } else {
          await page.keyboard.press('Escape');
          throw new Error('STRICT_I2V_PROVENANCE_ERROR: Menu ngữ cảnh không xuất hiện tuỳ chọn "Thêm vào câu lệnh" (Add to prompt).');
        }

        // Sau khi attach ảnh vào prompt, xác nhận chip ảnh xuất hiện và khớp đúng identifier (poll tới 3s chờ signed URL)
        let attachedChips: string[] = [];
        for (let pollAttempt = 0; pollAttempt < 12; pollAttempt++) {
          attachedChips = await page.evaluate(() => {
            const chips = Array.from(document.querySelectorAll('.chip-image, flow-prompt-box img, .prompt-box-container img, [data-entity-type]'));
            return chips.map((c: any) => c.src || c.currentSrc || c.getAttribute('data-entity-type') || '').filter(Boolean);
          }).catch(() => []);
          if (attachedChips.length > 0) break;
          await page.waitForTimeout(250);
        }
        if (attachedChips.length === 0) {
          throw new Error('STRICT_I2V_PROVENANCE_ERROR: Prompt chip không xuất hiện trong ô nhập lệnh sau khi đính kèm keyframe.');
        }
        if (assetUuid) {
          const chipMatches = attachedChips.some((u) => u.includes(assetUuid));
          if (!chipMatches) {
            console.warn(`[BrowserAutomationAdapter] Cảnh báo: Prompt chip không chứa rõ ràng assetUuid "${assetUuid}" trong src.`);
          }
        }
      }

      const pmLocator = page.locator('.ProseMirror, flow-prompt-box [contenteditable="true"]').first();
      await pmLocator.waitFor({ state: 'visible', timeout: 8000 });
      await pmLocator.click();
      if (!options.inputImageAsset || !isVideo) {
        // keyboard.type sends Enter for newlines: Flow can submit before credit approval.
        // fill writes multiline content without any Enter key event.
        await pmLocator.fill(prompt);
      } else {
        await page.keyboard.press('End');
        await page.keyboard.insertText(` ${prompt}`);
      }
      const entered=(await pmLocator.innerText()).replace(/\s+/g,' ').trim();
      const expected=prompt.replace(/\s+/g,' ').trim();
      if(!expected||(!options.inputImageAsset||!isVideo?entered!==expected:!entered.includes(expected)))throw new Error('FLOW_PROMPT_VERIFICATION_FAILED');
      await page.waitForTimeout(400);
    } catch (typeErr: any) {
      if (String(typeErr?.message || typeErr).includes('STRICT_I2V_PROVENANCE_ERROR')) {
        return {
          ok: false,
          state: 'FAILED',
          error: typeErr.message,
          errorCode: 'UI_AUTOMATION_FAILED',
        };
      }
      return {ok:false,state:'FAILED',error:'FLOW_PROMPT_ENTRY_FAILED: nội dung chưa được xác minh; không submit.',errorCode:'FLOW_PROMPT_ENTRY_FAILED'};
    }

    // 6. Click generate button via Playwright trusted click (Stage 1 Part B)
    const btnSelector = 'flow-generate-icon-button button, button.generate-icon-button, button[aria-label="Bắt đầu tạo" i], button[aria-label="Generate" i], button[aria-label="Start generation" i]';
    const genBtn = page.locator(btnSelector).first();
    try {
      await genBtn.waitFor({ state: 'visible', timeout: 8000 });
      for (let i = 0; i < 20; i++) {
        const isDis = await genBtn.isDisabled().catch(() => false);
        if (!isDis) break;
        await page.waitForTimeout(200);
      }
      signal?.throwIfAborted();
      await options.beforeSubmit?.(page);
      signal?.throwIfAborted();
    } catch {
      return {ok:false,state:'FAILED',error:'FLOW_PRE_SUBMIT_FAILED: điều kiện chưa được xác minh; không click Tạo.',errorCode:'FLOW_PRE_SUBMIT_FAILED'};
    }
    try {
      await genBtn.click({ timeout: 5000 });
    } catch {
      // The first click may have reached Google. Never issue another DOM click.
      return {ok:false,state:'FAILED',error:'FLOW_SUBMISSION_NOT_CONFIRMED: giữ receipt và đối soát; không tự click lại.',errorCode:'FLOW_SUBMISSION_NOT_CONFIRMED'};
    }

    // 7. Verification of submission (< 6s)
    const submissionStartTime = Date.now();
    let submissionConfirmed = false;
    while (Date.now() - submissionStartTime < submissionTimeoutMs) {
      if (signal?.aborted) {
        return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
      }
      await new Promise((r) => setTimeout(r, 300));

      const subStatus = await page.evaluate(({imageTiles,videoTiles,isVideo}) => {
        const captchaIframe = document.querySelector('iframe[src*="bframe"], .g-recaptcha-bubble-arrow');
        if (captchaIframe) return { accepted: false, blocked: true };

        const toasts = Array.from(document.querySelectorAll('mat-snack-bar-container, .toast, .error-banner, [role="alert"]'));
        const botToast = toasts.find((t) => {
          const txt = (t.textContent || '').toLowerCase();
          return txt.includes('unusual activity') || txt.includes('bất thường') || txt.includes('blocked');
        });
        if (botToast) return { accepted: false, blocked: true };

        const spinner = !!document.querySelector('mat-progress-spinner, mat-spinner, flow-loading-indicator,[role="progressbar"]');
        const newTile=document.querySelectorAll(isVideo?'flow-video-tile':'flow-image-tile').length>(isVideo?videoTiles:imageTiles);
        const progress=Array.from(document.querySelectorAll('flow-grid-tile-container')).some(e=>/(?:^|\s)\d{1,3}%/.test(e.textContent||''));
        const pmText = document.querySelector('.ProseMirror')?.textContent?.trim() || '';
        return { accepted: spinner || newTile || progress || pmText === '', blocked: false };
      },{imageTiles:preFlight.imageTiles,videoTiles:preFlight.videoTiles,isVideo}).catch(() => ({ accepted: false, blocked: false }));

      if (subStatus.blocked) {
        return {
          ok: false,
          state: 'BLOCKED_REQUIRES_USER',
          error: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          errorCode: 'BLOCKED_REQUIRES_USER',
        };
      }

      if (subStatus.accepted) {
        submissionConfirmed = true;
        break;
      }
    }

    if (!submissionConfirmed) {
      return {
        ok: false,
        state: 'TIMED_OUT',
        error: 'TIMEOUT_SUBMITTING: UI did not acknowledge submission',
        errorCode: 'TIMEOUT_SUBMITTING',
      };
    }

    // 8. Observation Loop (Stage 2 DOM Gallery Delta & Correlation)
    const procStartTime = Date.now();
    const existingImgs = new Set(preFlight.imgUrls);
    const existingVideos = new Set(preFlight.videoUrls);
    const existingCardIds = new Set(preFlight.cardIds);
    const promptKeywords = prompt
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 5);

    while (Date.now() - procStartTime < processingTimeoutMs) {
      if (signal?.aborted) {
        return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
      }
      await new Promise((r) => setTimeout(r, 600));

      if (isVideo) {
        const firstVt = page.locator('flow-video-tile').first();
        if (await firstVt.isVisible().catch(() => false)) {
          await firstVt.hover().catch(() => {});
        }
      }

      const obsResult = await page
        .evaluate(
          ({ existingImgsArr, existingVideosArr, existingCardIdsArr, targetMode, expectedProjectId, keywords }) => {
            const toasts = Array.from(
              document.querySelectorAll('mat-snack-bar-container, .toast, .error-banner, [role="alert"]')
            );
            const botToast = toasts.find((t) => {
              const txt = (t.textContent || '').toLowerCase();
              return txt.includes('unusual activity') || txt.includes('bất thường') || txt.includes('blocked');
            });
            if (botToast) return { status: 'BLOCKED_REQUIRES_USER' };

            // Verify project continuity: page must not have navigated away to a different project
            if (expectedProjectId) {
              const currentHref = window.location.href;
              if (!currentHref.includes(expectedProjectId)) {
                return { status: 'PROJECT_MISMATCH' };
              }
            }

            const existingImgSet = new Set(existingImgsArr);
            const existingVideoSet = new Set(existingVideosArr);
            const existingCardSet = new Set(existingCardIdsArr);
            const helpers = {isParentGenerating(el: Element) {
              const card = el.closest(
                'flow-grid-tile-container, flow-tile-container, flow-image-tile, flow-video-tile, flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item'
              );
              if (!card) return false;
              return (
                !!card.querySelector('mat-progress-spinner, mat-spinner, flow-loading-indicator, .loading') ||
                card.classList.contains('generating')
              );
            },

            // Card correlation helper: validates card relevance via explicit aria-label/title if present
            correlatesWithPrompt(card: Element | null): boolean {
              if (!card || keywords.length === 0) return true;
              const ariaLabel = (card.getAttribute('aria-label') || '').toLowerCase();
              const title = (card.getAttribute('title') || '').toLowerCase();
              const haystack = `${ariaLabel} ${title}`.trim();
              if (haystack.length > 0) {
                return keywords.some((kw: string) => haystack.includes(kw));
              }
              return true;
            }};

            if (targetMode === 'IMAGE') {
              const imgs = Array.from(
                document.querySelectorAll(
                  'flow-grid-tile-container flow-image-tile img, flow-grid-tile-container img, flow-tile-container img, flow-asset-card img, flow-media-tile img, mat-card img, [data-asset-id] img'
                )
              ) as HTMLImageElement[];

              const target = imgs.find((im) => {
                const s = im.src || im.currentSrc || '';
                if (!s || existingImgSet.has(s)) return false;
                if (im.classList.contains('thumbnail') || im.closest('flow-video-tile')) return false;

                const card = im.closest(
                  'flow-grid-tile-container, flow-tile-container, flow-image-tile, flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item'
                );
                const cardId = card?.getAttribute('data-asset-id') || card?.getAttribute('data-id') || card?.id;
                if (cardId && existingCardSet.has(cardId)) return false;

                const isValid =
                  s.includes('flow-content.google') ||
                  s.includes('googleusercontent.com') ||
                  s.includes('ai-sandbox') ||
                  s.startsWith('blob:') ||
                  s.startsWith('data:image');
                const isNotIcon = !s.includes('avatar') && !s.includes('icon') && !s.includes('.svg');
                const isDecentSize =
                  (im.naturalWidth >= 200 && im.naturalHeight >= 200) || (im.width >= 180 && im.height >= 180);

                return isValid && isNotIcon && isDecentSize && !helpers.isParentGenerating(im) && helpers.correlatesWithPrompt(card);
              });

              if (target) {
                const imgSrc = target.src || target.currentSrc || '';
                const cleanUrl = imgSrc.split('?')[0];
                const card = target.closest(
                  'flow-grid-tile-container, flow-tile-container, flow-image-tile, [data-asset-id]'
                );
                const assetId =
                  target.getAttribute('data-media-id') ||
                  card?.getAttribute('data-media-id') ||
                  card?.getAttribute('data-asset-id') ||
                  card?.getAttribute('data-id') ||
                  (cleanUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] ||
                  undefined;
                return { status: 'COMPLETED', firstImageUrl: imgSrc, assetId };
              }
            } else {
              const videos = Array.from(
                document.querySelectorAll(
                  'flow-grid-tile-container flow-video-tile video, flow-grid-tile-container video, flow-tile-container video, flow-asset-card video, flow-media-tile video, mat-card video, [data-asset-id] video'
                )
              ) as HTMLVideoElement[];

              const target = videos.find((v) => {
                const s = v.src || v.currentSrc || v.querySelector('source')?.src || '';
                if (!s || existingVideoSet.has(s)) return false;

                const card = v.closest(
                  'flow-grid-tile-container, flow-tile-container, flow-video-tile, flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item'
                );
                const cardId = card?.getAttribute('data-asset-id') || card?.getAttribute('data-id') || card?.id;
                if (cardId && existingCardSet.has(cardId)) return false;

                return !helpers.isParentGenerating(v) && helpers.correlatesWithPrompt(card);
              });

              if (target) {
                const card = target.closest(
                  'flow-grid-tile-container, flow-tile-container, flow-video-tile, [data-asset-id]'
                );
                const vUrl = target.src || target.currentSrc || target.querySelector('source')?.src || '';
                const assetId =
                  target.getAttribute('data-media-id') ||
                  card?.getAttribute('data-media-id') ||
                  card?.getAttribute('data-asset-id') ||
                  card?.getAttribute('data-id') ||
                  (vUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] ||
                  undefined;
                return { status: 'COMPLETED', videoUrl: vUrl, assetId };
              }

              // Also check download links
              const downloadLinks = Array.from(
                document.querySelectorAll('flow-grid-tile-container a[download], a[download]')
              ) as HTMLAnchorElement[];
              const targetLink = downloadLinks.find((a) => {
                const h = a.href || '';
                if (!h || existingVideoSet.has(h)) return false;
                const card = a.closest('flow-grid-tile-container, flow-tile-container, flow-video-tile, mat-card');
                return (h.includes('flow-content.google') || h.includes('storage.googleapis.com') || h.includes('googlevideo') || h.startsWith('blob:') || h.includes('/asb/')) &&
                  !helpers.isParentGenerating(a) && helpers.correlatesWithPrompt(card);
              });
              if (targetLink && targetLink.href) {
                const card = targetLink.closest('flow-grid-tile-container, flow-tile-container, flow-video-tile, [data-asset-id]');
                const assetId =
                  card?.getAttribute('data-media-id') ||
                  card?.getAttribute('data-asset-id') ||
                  card?.getAttribute('data-id') ||
                  (targetLink.href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] ||
                  undefined;
                return { status: 'COMPLETED', videoUrl: targetLink.href, assetId };
              }
            }

            return { status: 'PROCESSING' };
          },
          {
            existingImgsArr: Array.from(existingImgs),
            existingVideosArr: Array.from(existingVideos),
            existingCardIdsArr: Array.from(existingCardIds),
            targetMode: isVideo ? 'VIDEO' : 'IMAGE',
            expectedProjectId: options.projectId,
            keywords: promptKeywords,
          }
        )
        .catch(() => ({ status: 'PROCESSING' as const }));

      if (obsResult.status === 'BLOCKED_REQUIRES_USER') {
        return {
          ok: false,
          state: 'BLOCKED_REQUIRES_USER',
          error: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          errorCode: 'BLOCKED_REQUIRES_USER',
        };
      }

      if ((obsResult as any).status === 'PROJECT_MISMATCH') {
        return {
          ok: false,
          state: 'FAILED',
          error: `PROJECT_MISMATCH: Page navigated away from expected project ${options.projectId}`,
          errorCode: 'PROJECT_MISMATCH',
        };
      }

      if (obsResult.status === 'COMPLETED') {
        return {
          ok: true,
          state: 'COMPLETED',
          jobId: options.jobId,
          sceneId: options.sceneId,
          projectId: options.projectId,
          assetId: (obsResult as any).assetId,
          firstImageUrl: (obsResult as any).firstImageUrl,
          videoUrl: (obsResult as any).videoUrl,
          domFallback: true,
        };
      }
    }

    return {
      ok: false,
      state: 'TIMED_OUT',
      errorCode: 'TIMEOUT_PROCESSING',
      error: `Browser automation timed out after ${processingTimeoutMs / 1000}s`,
    };
  }
}
