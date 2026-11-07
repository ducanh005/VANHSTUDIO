/**
 * VanhSub Flow Bridge — background.js (Manifest V3 Service Worker)
 *
 * Kết nối WebSocket tới ứng dụng VanhSub Desktop (ws://127.0.0.1:9222).
 * Nhận lệnh RPC, mint reCAPTCHA trong tab flow.google.com thật, và thực thi batchexecute.
 */

const WS_PORTS = [9222, 8765];
let currentPortIndex = 0;
const FLOW_URLS = [
  'https://flow.google.com/*',
  'https://labs.google/fx/tools/flow*',
  'https://labs.google/fx/*/tools/flow*',
];
const CAPTCHA_SLOT = '__CAPTCHA__';

let ws = null;
let reconnectTimer = null;
let bridgeAuthenticated = false;
let authContext = null;
let pendingPairKey = null;
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const sha = async value => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
async function authProof(key, value) {
  const imported = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(value)));
}
async function sendAuthProof(socket, context) {
  await trustedStorageReady;
  const { bridgePairingToken } = await chrome.storage.local.get('bridgePairingToken');
  const pairKey = pendingPairKey;
  const key = pairKey || (/^[A-Za-z0-9_-]{43}$/.test(bridgePairingToken || '') ? await sha(bridgePairingToken) : null);
  if (ws !== socket || authContext !== context || !key) return;
  context.key = key; context.pair = Boolean(pairKey);
  const proof = await authProof(key, 'client|' + context.value);
  if (ws !== socket || authContext !== context || socket.readyState !== WebSocket.OPEN) return;
  if (pairKey) pendingPairKey = null;
  socket.send(JSON.stringify({ type: pairKey ? 'PAIR' : 'HANDSHAKE', protocol: 2, version: getExtensionVersion(), proof }));
}
const trustedStorageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// Quản lý các tác vụ UI generation đang chạy để hỗ trợ hủy tức thì (cancel_ui_gen)
const activeUiGenTasks = new Map();

// Quản lý các tab thuộc quyền sở hữu của automation (được tạo hoặc gán cho tác vụ tự động)
// Map<tabId, { tabId, projectId, jobId, createdAt, lastUsedAt, purpose }>
const automationOwnedTabs = new Map();

// Tự động dọn dẹp registry khi tab bị đóng và ngắt tác vụ đang gắn với tab đó
chrome.tabs.onRemoved.addListener((closedTabId) => {
  automationOwnedTabs.delete(closedTabId);
  for (const [taskId, task] of activeUiGenTasks.entries()) {
    if (task.tabId === closedTabId) {
      log(`🛑 Tab ${closedTabId} bị đóng trong khi đang chạy task ${taskId}`);
      task.cancelled = true;
      task.abortReason = 'TAB_CLOSED_BY_USER';
    }
  }
});

function log(...args) {
  console.log('[VanhSub:background]', ...args);
}

function warn(...args) {
  console.warn('[VanhSub:background]', ...args);
}

function error(...args) {
  console.error('[VanhSub:background]', ...args);
}

function getExtensionVersion() {
  try {
    return chrome.runtime?.getManifest?.()?.version || '1.0.6';
  } catch {
    return '1.0.6';
  }
}

// ── WebSocket Connection ───────────────────────────────────────────────────────

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const port = WS_PORTS[currentPortIndex % WS_PORTS.length];
  const wsUrl = `ws://127.0.0.1:${port}`;
  log('Đang kết nối tới VanhSub Desktop tại', wsUrl);

  try {
    const socket = new WebSocket(wsUrl);
    let authenticationReady = Promise.resolve();
    ws = socket;
    bridgeAuthenticated = false;
    authContext = null;

    ws.onopen = async () => {
      const ver = getExtensionVersion();
      log(`Đã mở kết nối tới VanhSub Desktop (${wsUrl}, v${ver}); đang xác thực ghép đôi.`);
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      socket.send(JSON.stringify({ type: 'HANDSHAKE', protocol: 2, version: ver }));
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        if (ws !== socket) return;
        msg = JSON.parse(event.data);
        if (msg.type === 'AUTH_CHALLENGE') {
          if (bridgeAuthenticated || authContext || msg.protocol !== 2 || msg.port !== port || !/^[A-Za-z0-9_-]{43}$/.test(msg.nonce || '')) { socket.close(); return; }
          authContext = { value: `chrome-extension://${chrome.runtime.id}|${port}|${msg.nonce}` };
          await sendAuthProof(socket, authContext);
          return;
        }
        if (msg.type === 'AUTH_REQUIRED') { bridgeAuthenticated = false; return; }
        if (msg.type === 'AUTH_OK') {
          authenticationReady = (async () => {
            const context = authContext;
            if (msg.protocol !== 2 || !context?.key || typeof msg.serverProof !== 'string') { socket.close(); return; }
            if (context.pair ? !/^[A-Za-z0-9_-]{43}$/.test(msg.token || '') : msg.token !== undefined) { socket.close(); return; }
            const suffix = context.pair ? '|' + await sha(msg.token) : '';
            const expected = await authProof(context.key, 'server|' + context.value + suffix);
            if (ws !== socket || authContext !== context || socket.readyState !== WebSocket.OPEN) return;
            if (msg.serverProof !== expected) { socket.close(); return; }
            if (context.pair) { await trustedStorageReady; await chrome.storage.local.set({ bridgePairingToken: msg.token }); }
            if (ws !== socket || authContext !== context || socket.readyState !== WebSocket.OPEN) return;
            context.key = null;
            bridgeAuthenticated = true;
            send({ type: 'HANDSHAKE', version: getExtensionVersion() });
          })();
          await authenticationReady;
          return;
        }
        // Only wait for authentication, never serialize long generation/cancel handlers.
        await authenticationReady;
        if (ws !== socket || socket.readyState !== WebSocket.OPEN || !bridgeAuthenticated) return;
        await handleMessage(msg);
      } catch (err) {
        error('Lỗi phân tích cú pháp message từ WebSocket:', err);
        // A rejected request must finish on its originating authenticated socket.
        // Otherwise project/navigation errors become a misleading server timeout.
        if (ws === socket && bridgeAuthenticated && socket.readyState === WebSocket.OPEN && typeof msg?.id === 'string') {
          const reason = typeof err?.message === 'string' ? err.message.slice(0, 500) : 'EXTENSION_REQUEST_FAILED';
          socket.send(JSON.stringify({ id: msg.id, error: reason }));
        }
      }
    };

    ws.onclose = () => {
      if (ws !== socket) return;
      bridgeAuthenticated = false;
      warn('🔌 Mất kết nối tới VanhSub Desktop. Sẽ tự kết nối lại sau 3s...');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      if (ws !== socket) return;
      warn(`WebSocket gặp lỗi tại cổng ${port}:`, err?.message || 'Connection refused');
      currentPortIndex = (currentPortIndex + 1) % WS_PORTS.length;
      try {
        ws.close();
      } catch {}
    };
  } catch (err) {
    warn('Không thể mở WebSocket:', err.message);
    currentPortIndex = (currentPortIndex + 1) % WS_PORTS.length;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(() => {
      connectWebSocket();
    }, 3000);
  }
}

function send(data) {
  if (bridgeAuthenticated && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Giữ Service Worker tỉnh táo khi có tab flow.google.com mở
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'FLOW_KEEP_ALIVE') {
    connectWebSocket();
    port.onMessage.addListener(() => {
      // PING nhận định kỳ, đảm bảo kết nối WS luôn sống
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWebSocket();
      }
    });
  }
});


// ── Tab Management ─────────────────────────────────────────────────────────────

function isValidProjectId(id) {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed === '__PROJECT_ID_SLOT__' || trimmed === '__PROJECT_ID__') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ||
    (/^[a-zA-Z0-9_-]{8,}$/.test(trimmed) && !trimmed.startsWith('__'));
}

function extractProjectIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/project\/([0-9a-f-]{36}|[a-zA-Z0-9_-]{8,})/i);
  if (match && isValidProjectId(match[1])) {
    return match[1];
  }
  return null;
}

async function reviveTabIfNeeded(tab) {
  if (!tab || !tab.discarded) return tab;
  try {
    await chrome.tabs.reload(tab.id);
    await new Promise((r) => setTimeout(r, 2500));
    return await chrome.tabs.get(tab.id);
  } catch {
    return tab;
  }
}

async function getFlowTab(autoCreate = false, preferredProjectId = null, options = {}) {
  const { jobId = null, targetTabId = null, allowUserTabFallback = false } = options;
  const validPid = isValidProjectId(preferredProjectId) ? preferredProjectId.trim() : null;

  // 1. Nếu có chỉ định targetTabId cụ thể, ưu tiên kiểm tra tab đó trước
  if (typeof targetTabId === 'number' && targetTabId > 0) {
    try {
      const specifiedTab = await chrome.tabs.get(targetTabId);
      if (specifiedTab && specifiedTab.url && FLOW_URLS.some((u) => {
        const prefix = u.replace(/\*$/, '');
        return specifiedTab.url.startsWith(prefix);
      })) {
        automationOwnedTabs.set(specifiedTab.id, {
          tabId: specifiedTab.id,
          projectId: validPid || extractProjectIdFromUrl(specifiedTab.url),
          jobId,
          lastUsedAt: Date.now(),
        });
        return await reviveTabIfNeeded(specifiedTab);
      }
    } catch {}
  }

  // 2. Tìm trong automationOwnedTabs registry xem có tab nào đang giữ đúng projectId này không
  if (validPid) {
    for (const [tId, meta] of automationOwnedTabs.entries()) {
      if (meta.projectId === validPid) {
        try {
          const regTab = await chrome.tabs.get(tId);
          if (regTab && regTab.url && regTab.url.includes(`/project/${validPid}`)) {
            meta.lastUsedAt = Date.now();
            if (jobId) meta.jobId = jobId;
            return await reviveTabIfNeeded(regTab);
          }
        } catch {
          automationOwnedTabs.delete(tId);
        }
      }
    }
  }

  const tabs = await chrome.tabs.query({ url: FLOW_URLS });
  if (!tabs || tabs.length === 0) {
    if (!autoCreate) return null;
    const targetUrl = validPid
      ? `https://labs.google/fx/vi/tools/flow/project/${validPid}`
      : 'https://labs.google/fx/vi/tools/flow';
    log(`🌐 Tự động mở tab Google Flow mới ở chế độ nền: ${targetUrl}`);
    const created = await chrome.tabs.create({ url: targetUrl, active: false });
    await waitForTabReady(created.id, 15000);
    automationOwnedTabs.set(created.id, {
      tabId: created.id,
      projectId: validPid,
      jobId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      purpose: 'automation',
    });
    return await chrome.tabs.get(created.id);
  }

  // 3. Nếu có preferredProjectId: Tìm tab khớp chính xác URL /project/${validPid}
  if (validPid) {
    // 3a. Ưu tiên tab trong automationOwnedTabs hoặc tab không active (người dùng không thao tác)
    const matchingTabs = tabs.filter((t) => t.url && t.url.includes(`/project/${validPid}`));
    if (matchingTabs.length > 0) {
      const ownedMatch = matchingTabs.find((t) => automationOwnedTabs.has(t.id));
      const bgMatch = matchingTabs.find((t) => !t.active);
      const chosen = ownedMatch || bgMatch || matchingTabs[0];

      automationOwnedTabs.set(chosen.id, {
        tabId: chosen.id,
        projectId: validPid,
        jobId,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        purpose: 'automation',
      });
      return await reviveTabIfNeeded(chosen);
    }

    // 3b. Nếu có preferredProjectId nhưng KHÔNG tab nào khớp:
    // TUYỆT ĐỐI KHÔNG cướp tab khác project của người dùng! Mở tab riêng cho project này ở chế độ nền!
    if (autoCreate) {
      const targetUrl = `https://labs.google/fx/vi/tools/flow/project/${validPid}`;
      log(`🌐 Tự động mở tab riêng cho project "${validPid}" ở chế độ nền: ${targetUrl}`);
      const created = await chrome.tabs.create({ url: targetUrl, active: false });
      await waitForTabReady(created.id, 15000);
      automationOwnedTabs.set(created.id, {
        tabId: created.id,
        projectId: validPid,
        jobId,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        purpose: 'automation',
      });
      return await chrome.tabs.get(created.id);
    }
  }

  // 4. Khi không có preferredProjectId (ví dụ lệnh get_status hoặc lệnh tổng quát)
  // Ưu tiên 1: Tab trong automationOwnedTabs
  for (const [tId, meta] of automationOwnedTabs.entries()) {
    try {
      const regTab = await chrome.tabs.get(tId);
      if (regTab && !regTab.discarded) {
        meta.lastUsedAt = Date.now();
        return await reviveTabIfNeeded(regTab);
      }
    } catch {
      automationOwnedTabs.delete(tId);
    }
  }

  // Ưu tiên 2: Tab không active để không can thiệp vào tab người dùng đang xem
  const backgroundTab = tabs.find((t) => !t.active && !t.discarded);
  const readyTab = tabs.find((t) => !t.discarded);
  if (backgroundTab || readyTab) {
    const target = backgroundTab || readyTab;
    return await reviveTabIfNeeded(target);
  }

  // Nếu chỉ có tab active của người dùng và allowUserTabFallback cho phép (chỉ dùng đọc thông tin)
  if (allowUserTabFallback && tabs.length > 0) {
    return await reviveTabIfNeeded(tabs[0]);
  }

  if (autoCreate) {
    const targetUrl = 'https://labs.google/fx/vi/tools/flow';
    log(`🌐 Tự động mở tab Google Flow ở chế độ nền: ${targetUrl}`);
    const created = await chrome.tabs.create({ url: targetUrl, active: false });
    await waitForTabReady(created.id, 15000);
    automationOwnedTabs.set(created.id, {
      tabId: created.id,
      projectId: null,
      jobId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      purpose: 'automation',
    });
    return await chrome.tabs.get(created.id);
  }

  return tabs[0] || null;
}

// ── Message Handlers ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'ping') {
    send({ id, result: { pong: true, timestamp: Date.now() } });
    return;
  }

  if (method === 'ensure_project') {
    try {
      // Creating a new project must never select or revive a user's existing tab.
      const tab = params?.createNew === true ? null : await getFlowTab(true, params?.projectId);
      const ensured = await ensureTabInProject(tab, params?.projectId, params?.createNew === true);
      send({ id, result: { projectId: ensured.projectId, url: ensured.tab.url } });
    } catch (err) { send({ id, error: err.message }); }
    return;
  }

  if (method === 'get_status') {
    const tab = await getFlowTab(false);
    let diag = null;
    let projectId = null;
    const includeFullDiag = Boolean(params?.fullDiag || params?.includeSniffer);

    if (tab && tab.url) {
      projectId = extractProjectIdFromUrl(tab.url);

      try {
        const [exec] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [includeFullDiag],
          func: (fullDiag) => {
            const wiz = globalThis.WIZ_global_data || {};
            const hasGrecaptcha = !!(globalThis.grecaptcha && globalThis.grecaptcha.enterprise);
            const base = {
              url: location.href,
              pathname: location.pathname,
              hasAtToken: !!wiz.SNlM0e,
              siteKey: wiz.xZbWve || null,
              hasGrecaptcha,
              domInfo: {
                hasProseMirror: !!document.querySelector('.ProseMirror'),
              },
            };
            if (!fullDiag) return base;
            return {
              ...base,
              wizKeys: Object.keys(wiz),
              wizValues: Object.fromEntries(
                Object.entries(wiz).filter(([k, v]) => typeof v === 'string' && v.length < 100)
              ),
              vanhsubHeaders: globalThis.__VANHSUB_HEADERS__ || {},
              captchaCalls: globalThis.__VANHSUB_CAPTCHA_CALLS__ || [],
              promptSettings: (() => {
                try {
                  return JSON.parse(localStorage.getItem('flow-prompt-box-settings') || '{}');
                } catch (e) {
                  return null;
                }
              })(),
              domInfo: {
                hasProseMirror: !!document.querySelector('.ProseMirror'),
                proseMirrorText: document.querySelector('.ProseMirror')?.innerText?.slice(0, 50) || null,
                buttons: Array.from(document.querySelectorAll('button'))
                  .map((b) => ({
                    text: (b.innerText || '').trim().slice(0, 40),
                    aria: b.getAttribute('aria-label'),
                    visible: b.getBoundingClientRect().width > 0,
                  }))
                  .filter((b) => b.visible && (b.text || b.aria))
                  .slice(0, 25),
              },
              snifferHistory: (globalThis.__VANHSUB_SNIFFER__ && globalThis.__VANHSUB_SNIFFER__.history) ? globalThis.__VANHSUB_SNIFFER__.history : [],
            };
          },
        });
        diag = exec?.result || null;
      } catch (e) {
        diag = { error: e.message };
      }
    }

    send({
      id,
      result: {
        connected: true,
        hasFlowTab: !!tab,
        tabUrl: tab ? tab.url : null,
        tabId: tab ? tab.id : null,
        projectId,
        inProject: !!projectId,
        diag,
      },
    });
    return;
  }

  if (method === 'reload_extension') {
    send({ id, result: { ok: true } });
    setTimeout(() => chrome.runtime.reload(), 200);
    return;
  }

  if (method === 'reload_tab') {
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    log(`🔄 Đang reload tab Flow (tab ${tab.id})...`);
    await chrome.tabs.reload(tab.id);
    await waitForTabReady(tab.id, 15000);
    log(`✅ Tab Flow đã reload và sẵn sàng!`);
    send({ id, result: { ok: true } });
    return;
  }

  if (method === 'tab_eval') {
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      const codeStr = String(params.code || '');
      if (codeStr === '__INSPECT_SETTINGS__') {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: async () => {
            const trigger = document.querySelector('button[aria-label*="Điều kiện kích hoạt" i], button.settings-trigger-button, flow-settings-button button');
            if (trigger) trigger.click();
            await new Promise((r) => setTimeout(r, 800));
            const container = document.querySelector('.cdk-overlay-container');
            const items = container
              ? Array.from(container.querySelectorAll('button, [role="tab"], [role="radio"], [role="button"], mat-button-toggle')).map((b) => ({
                  text: (b.innerText || '').trim().slice(0, 40),
                  aria: b.getAttribute('aria-label'),
                }))
              : [];
            // Click backdrop to close
            const bd = document.querySelector('.cdk-overlay-backdrop');
            if (bd) bd.click();
            return {
              triggerText: trigger ? trigger.innerText : null,
              hasContainer: !!container,
              items,
            };
          },
        });
        send({ id, result: res?.result });
        return;
      }

      if (codeStr === '__TEST_SWITCH_MODE__') {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: async () => {
            const trigger = document.querySelector('button[aria-label*="Điều kiện kích hoạt" i], button.settings-trigger-button, flow-settings-button button');
            if (!trigger) return { ok: false, error: 'NO_TRIGGER' };
            const beforeText = trigger.innerText;
            let pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
            if (!pane) {
              trigger.click();
              await new Promise((r) => setTimeout(r, 700));
              pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
            }

            const container = document.querySelector('.cdk-overlay-container') || pane;
            const btns = container ? Array.from(container.querySelectorAll('mat-button-toggle, button, [role="radio"]')) : [];
            const allBtnTexts = btns.map(b => (b.innerText || '').trim());
            const imgBtn = btns.find((b) => {
              const t = (b.innerText || '').toLowerCase();
              return t.includes('hình ảnh') || t.includes('image');
            });

            let clicked = false;
            let clickedTag = null;
            if (imgBtn) {
              const target = imgBtn.querySelector('button') || imgBtn;
              clickedTag = target.tagName + '.' + target.className;
              target.click();
              clicked = true;
              await new Promise((r) => setTimeout(r, 400));
            }

            const bd = document.querySelector('.cdk-overlay-backdrop');
            if (bd) bd.click();
            await new Promise((r) => setTimeout(r, 500));

            const afterText = trigger.innerText;
            return { ok: true, beforeText, afterText, clicked, clickedTag, allBtnTexts };
          },
        });
        send({ id, result: res?.result });
        return;
      }

      if (codeStr.startsWith('__TRIGGER_GEN__:')) {
        warn('⚠️ __TRIGGER_GEN__ đã bị deprecated, vui lòng chuyển sang Pure batch_rpc');
        let cfg;
        try {
          cfg = JSON.parse(codeStr.slice('__TRIGGER_GEN__:'.length));
        } catch {
          cfg = { mode: 'VIDEO', prompt: codeStr.slice('__TRIGGER_GEN__:'.length) };
        }

        // Phase 1: Mode-switch + type prompt + get button screen coords
        const [phase1] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [cfg],
          func: async (config) => {
            const targetMode = (config.mode || 'IMAGE').toUpperCase();
            const promptText = config.prompt || '';

            // 1a. Chuyen che do neu can
            const allInitialBtns = Array.from(document.querySelectorAll('button'));
            const trigger = allInitialBtns.find((b) => {
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              return (
                aria.includes('kích hoạt') ||
                aria.includes('kich hoat') ||
                aria.includes('cài đặt') ||
                aria.includes('cai dat') ||
                aria.includes('settings')
              );
            }) || document.querySelector('button.settings-trigger-button, flow-settings-button button');

            if (trigger) {
              const curText = (trigger.innerText || '').toLowerCase();
              const isVideo = curText.includes('video') || curText.includes('veo') || curText.includes('giây') || curText.includes('giay') || curText.includes('720p') || curText.includes('1080p');
              const needsSwitch = (targetMode === 'IMAGE' && isVideo) || (targetMode === 'VIDEO' && !isVideo);
              if (needsSwitch) {
                console.log(`[VanhSub:UI] 🔄 Đang chuyển chế độ: hiện tại="${curText.slice(0, 30)}" → mục tiêu=${targetMode}...`);
                let pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
                if (!pane) {
                  trigger.click();
                  await new Promise((r) => setTimeout(r, 700));
                  pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
                }
                const container = document.querySelector('.cdk-overlay-container') || pane;
                if (container) {
                  const modeBtns = Array.from(container.querySelectorAll('mat-button-toggle, button, [role="radio"]'));
                  const kw = targetMode === 'IMAGE' ? ['hình ảnh', 'hinh anh', 'image', 'ảnh', 'anh'] : ['video', 'videocam'];
                  const t = modeBtns.find((b) => kw.some((k) => (b.innerText || '').toLowerCase().includes(k)));
                  if (t) {
                    const clickTarget = t.querySelector('button') || t;
                    clickTarget.click();
                    await new Promise((r) => setTimeout(r, 500));
                  }
                }
                const bd = document.querySelector('.cdk-overlay-backdrop');
                if (bd) bd.click();
                await new Promise((r) => setTimeout(r, 500));
              }
            }

            // 1b. Nhap prompt
            const pm = document.querySelector('.ProseMirror');
            if (!pm) return { ok: false, error: 'NO_PROSEMIRROR' };
            pm.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            await new Promise((r) => setTimeout(r, 100));
            document.execCommand('insertText', false, promptText);
            pm.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText, inputType: 'insertText' }));
            pm.dispatchEvent(new Event('input', { bubbles: true }));
            pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
            await new Promise((r) => setTimeout(r, 800));

            // 1c. Tim nut Generate - tra ve toa do man hinh
            const currentBtns = Array.from(document.querySelectorAll('button'));
            const btn = currentBtns.find((b) => {
              if (b.disabled) return false;
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              const text = (b.innerText || '').trim().toLowerCase();
              return (
                aria.includes('bắt đầu tạo') ||
                aria.includes('bat dau tao') ||
                aria.includes('tạo') ||
                aria.includes('tao') ||
                aria.includes('generate') ||
                aria.includes('create') ||
                aria.includes('submit') ||
                text === 'arrow_forward' ||
                text === 'send'
              );
            });

            if (!btn) {
              return {
                ok: false,
                error: 'NO_GEN_BUTTON',
                allButtons: currentBtns.map((b) => ({
                  text: b.innerText?.slice(0, 30),
                  aria: b.getAttribute('aria-label'),
                  disabled: b.disabled
                }))
              };
            }

            btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            await new Promise((r) => setTimeout(r, 100));
            const rect = btn.getBoundingClientRect();
            const cx = Math.round(rect.left + rect.width / 2);
            const cy = Math.round(rect.top + rect.height / 2);
            console.log(`[VanhSub:UI] 📍 Nút Generate: (${cx}, ${cy}) | aria="${btn.getAttribute('aria-label')}" | text="${btn.innerText?.trim()}" | mode=${targetMode}`);
            return { ok: true, cx, cy, targetMode };
          },
        });

        const p1 = phase1?.result;
        if (!p1?.ok) {
          if (p1?.allButtons) console.error('[VanhSub] NO_GEN_BUTTON:', JSON.stringify(p1.allButtons));
          send({ id, result: p1 || { ok: false, error: 'PHASE1_FAILED' } });
          return;
        }

        // Phase 2: CDP trusted click (isTrusted=true)
        const actualClickTimestamp = Date.now();
        const clickTimestamp = actualClickTimestamp;
        try {
          await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        } catch (e) {
          console.warn('[VanhSub] debugger attach warn:', e && e.message);
        }

        try {
          // Move chuột đến nút
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: p1.cx,
            y: p1.cy,
          });
          await new Promise((r) => setTimeout(r, 60));

          // Bấm chuột xuống
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: p1.cx,
            y: p1.cy,
            button: 'left',
            clickCount: 1,
            modifiers: 0,
          });
          await new Promise((r) => setTimeout(r, 100));

          // Nhả chuột
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: p1.cx,
            y: p1.cy,
            button: 'left',
            clickCount: 1,
            modifiers: 0,
          });
          console.log(`[VanhSub] 🖱️ Đã phát CDP trusted click tại (${p1.cx}, ${p1.cy}) lúc ${clickTimestamp}`);
        } catch (e) {
          try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
          send({ id, result: { ok: false, error: 'CDP_CLICK_FAILED: ' + (e && e.message) } });
          return;
        }
        try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}

        // Phase 3: Poll sniffer for RPC result
        const [phase3] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [{ targetMode: p1.targetMode, clickTimestamp }],
          func: async (ctx) => {
            const deadline = ctx.clickTimestamp + 120000;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 800));
              const hist = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= (ctx.clickTimestamp || actualClickTimestamp - 200));
              if (ctx.targetMode === 'IMAGE') {
                const hit = hist.find((h) => h.url && h.url.includes('ogiZ0b') && h.status === 200 && h.response);
                if (hit) {
                  console.log('[VanhSub] ✅ Bắt được ogiZ0b response!');
                  return { ok: true, mode: 'IMAGE', rpcid: 'ogiZ0b', url: hit.url, response: hit.response };
                }
                const pend = hist.find((h) => h.url && h.url.includes('ogiZ0b'));
                if (pend) {
                  console.log('[VanhSub] ⏳ ogiZ0b pending status=' + pend.status + ' hasResp=' + !!pend.response);
                }
              } else {
                const hit = hist.find((h) => h.url && h.url.includes('as29s') && h.status === 200 && h.response);
                if (hit) {
                  console.log('[VanhSub] ✅ Bắt được as29s response!');
                  return { ok: true, mode: 'VIDEO', rpcid: 'as29s', url: hit.url, response: hit.response };
                }
              }
            }
            const d = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= ctx.clickTimestamp);
            return {
              ok: false,
              error: 'TIMEOUT_WAITING_RESULT',
              targetMode: ctx.targetMode,
              recentRpc: d.map((h) => ({
                rpcid: h.url && h.url.match(/rpcids=([^&]+)/) && h.url.match(/rpcids=([^&]+)/)[1],
                status: h.status,
                hasResp: !!h.response
              }))
            };
          },
        });
        send({ id, result: phase3?.result });
        return;
      }
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (code) => {
          try {
            return { ok: true, val: eval(code) };
          } catch (e) {
            return { ok: false, err: e.message };
          }
        },
        args: [params.code],
      });
      send({ id, result: res?.result });
    } catch (err) {
      send({ id, error: err.message });
    }
    return;
  }

  if (method === 'solve_captcha' || method === 'get_captcha') {
    const pageAction = params?.captchaAction || params?.pageAction || 'IMAGE_GENERATION';
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      let resp;
      try {
        resp = await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_CAPTCHA',
          requestId: id,
          pageAction,
        });
      } catch (sendErr) {
        const msg = sendErr?.message || '';
        if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
          log('🔄 Content script chưa sẵn sàng trong tab, tự động nạp content.js và thử lại...');
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
          });
          await new Promise((r) => setTimeout(r, 300));
          resp = await chrome.tabs.sendMessage(tab.id, {
            type: 'GET_CAPTCHA',
            requestId: id,
            pageAction,
          });
        } else {
          throw sendErr;
        }
      }

      if (resp && resp.token) {
        send({ id, result: { token: resp.token } });
      } else {
        send({ id, error: resp?.error || 'NO_TOKEN' });
      }
    } catch (e) {
      send({ id, error: e.message });
    }
    return;
  }

  if (method === 'batch_rpc') {
    log(`🚀 Nhận lệnh batch_rpc cho rpcid=${params?.rpcid}, action=${params?.captchaAction || 'none'}`);
    const result = await runBatchRpc(params);
    if (result.error) {
      error(`❌ batch_rpc thất bại:`, result.error);
      send({ id, error: result.error, detail: result });
    } else {
      log(`✅ batch_rpc thành công (status=${result.status}, body length=${result.body ? result.body.length : 0})`);
      send({ id, result });
    }
    return;
  }

  if (method === 'recover_unusual_activity') {
    log('🛡️ Kích hoạt recover_unusual_activity: Kiểm tra trạng thái an toàn (không can thiệp UI hoặc cuộn tab)...');
    const tab = await getFlowTab(false, params?.projectId);
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    // Safeguard: Detach debugger nếu còn sót, không tự ý di chuột hay cuộn trang làm gián đoạn người dùng
    try {
      try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
      send({ id, result: { ok: true, safe: true } });
    } catch (err) {
      send({ id, error: err.message });
    }
    return;
  }

  if (method === 'dom_inspect') {
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          const promptBoxes = Array.from(document.querySelectorAll('.ProseMirror, textarea, [contenteditable="true"]')).map((el) => ({
            tag: el.tagName,
            cls: el.className,
            placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
            text: el.innerText?.slice(0, 50),
            visible: el.getBoundingClientRect().width > 0,
          }));

          const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
            text: b.innerText?.trim().slice(0, 40),
            aria: b.getAttribute('aria-label'),
            cls: b.className,
            disabled: b.disabled,
            visible: b.getBoundingClientRect().width > 0,
          })).filter((b) => b.visible && (b.text || b.aria));

          return { promptBoxes, buttons: buttons.slice(0, 30) };
        },
      });
      send({ id, result: res?.result });
    } catch (err) {
      send({ id, error: err.message });
    }
    return;
  }

  // Hủy UI generation task đang chạy theo id
  if (method === 'cancel_ui_gen') {
    const targetId = params?.id || id;
    const task = activeUiGenTasks.get(targetId);
    if (task) {
      log(`🛑 Hủy UI generation task: ${targetId} (lý do: ${params?.reason || 'user_requested'})`);
      task.cancelled = true;
      task.abortReason = params?.reason || 'USER_CANCELLED';
      if (task.tabId) {
        try { chrome.debugger.detach({ tabId: task.tabId }); } catch {}
      }
      activeUiGenTasks.delete(targetId);
      send({ id, result: { ok: true, cancelled: true, targetId } });
    } else {
      send({ id, result: { ok: true, cancelled: false, message: 'TASK_NOT_FOUND_OR_ALREADY_FINISHED', targetId } });
    }
    return;
  }

  // UI Generation Fallback (CDP Trusted Click + Multi-Stage Observation Engine)
  if (method === 'trigger_ui_gen') {
    log('🚀 trigger_ui_gen được kích hoạt với multi-stage observation engine');
    let tab = await getFlowTab(true, params?.projectId, {
      jobId: params?.jobId || id,
      targetTabId: params?.tabId,
      allowUserTabFallback: false,
    });
    if (!tab) {
      send({ id, result: { ok: false, state: 'FAILED', error: 'NO_FLOW_TAB', errorCode: 'UI_AUTOMATION_FAILED' } });
      return;
    }

    const taskState = { id, tabId: tab.id, cancelled: false, abortReason: null, startedAt: Date.now() };
    activeUiGenTasks.set(id, taskState);

    try {
      const ensured = await ensureTabInProject(tab, params?.projectId);
      tab = ensured.tab;
      taskState.tabId = tab.id;
      const promptText = params?.prompt || 'a drone shot over ocean waves';
      const targetMode = (params?.mode || 'IMAGE').toUpperCase();
      const isVideo = targetMode === 'VIDEO';

      // Cấu hình Staged Timeouts
      const submissionTimeoutMs = typeof params?.submissionTimeoutMs === 'number' && params.submissionTimeoutMs > 0 ? params.submissionTimeoutMs : 6000;
      const defaultProcTimeout = isVideo ? 120000 : 40000; // 40s ảnh, 120s video
      const maxProcTimeout = isVideo ? 135000 : 50000;     // Hard cap 50s ảnh, 135s video
      const requestedTimeout = typeof params?.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : defaultProcTimeout;
      const processingTimeoutMs = Math.min(requestedTimeout, maxProcTimeout);

      // ══════════════════════════════════════════════════════════════════════════
      // STAGE 0: Pre-Flight Baseline Snapshot (trước khi gõ prompt & click)
      // ══════════════════════════════════════════════════════════════════════════
      const [preFlightExec] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          const cards = Array.from(document.querySelectorAll('flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item'));
          const cardIds = cards.map((c) => c.getAttribute('data-asset-id') || c.getAttribute('data-id') || c.id).filter(Boolean);

          const imgUrls = Array.from(document.querySelectorAll('img'))
            .map((im) => im.src || im.currentSrc)
            .filter((s) => s && (s.includes('googleusercontent.com') || s.includes('ai-sandbox') || s.startsWith('blob:')));

          const videoUrls = [];
          document.querySelectorAll('video').forEach((v) => {
            if (v.src) videoUrls.push(v.src);
            if (v.currentSrc) videoUrls.push(v.currentSrc);
            v.querySelectorAll('source').forEach((s) => { if (s.src) videoUrls.push(s.src); });
          });

          const snifferHistoryLen = (window.__VANHSUB_SNIFFER__?.history || []).length;
          const preFlightTimestamp = Date.now();

          return { cardIds, imgUrls, videoUrls, snifferHistoryLen, preFlightTimestamp };
        },
      });
      const preFlight = preFlightExec?.result || { cardIds: [], imgUrls: [], videoUrls: [], snifferHistoryLen: 0, preFlightTimestamp: Date.now() };

      if (taskState.cancelled) {
        send({ id, result: { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' } });
        return;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // STAGE 1 (Part A): Input Preparation (ProseMirror & Locate Button)
      // ══════════════════════════════════════════════════════════════════════════
      const [prepExec] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [{ promptText, targetMode }],
        func: async (cfg) => {
          const reqMode = (cfg.targetMode || 'IMAGE').toUpperCase();
          const text = cfg.promptText || '';

          // 1a. Xác định container chứa prompt box
          const promptBox =
            document.querySelector(
              'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
            ) || document.body;

          // 1b. Chuyển chế độ (Image vs Video) nếu cần thiết
          let trigger =
            promptBox.querySelector('button.settings-trigger-button, flow-settings-button button, [aria-haspopup="true"]') ||
            document.querySelector('button.settings-trigger-button, flow-settings-button button');

          if (trigger) {
            const curText = ((trigger.innerText || '') + ' ' + (trigger.getAttribute('aria-label') || '')).toLowerCase();
            const isVideo =
              curText.includes('video') ||
              curText.includes('veo') ||
              curText.includes('giây') ||
              curText.includes('giay') ||
              curText.includes('720p') ||
              curText.includes('1080p') ||
              curText.includes('360p');
            const isImage =
              curText.includes('hình ảnh') ||
              curText.includes('hinh anh') ||
              curText.includes('image') ||
              curText.includes('imagen') ||
              curText.includes('ảnh') ||
              curText.includes('anh');
            const needsSwitch = (reqMode === 'IMAGE' && (isVideo || !isImage)) || (reqMode === 'VIDEO' && (isImage || !isVideo));
            if (needsSwitch) {
              let pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
              if (!pane) {
                trigger.click();
                await new Promise((r) => setTimeout(r, 600));
                pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
              }
              const container = document.querySelector('.cdk-overlay-container') || pane || document.body;
              if (container) {
                const modeBtns = Array.from(
                  container.querySelectorAll('mat-button-toggle, button, [role="radio"], [role="menuitem"], [role="tab"]')
                );
                const kw = reqMode === 'IMAGE' ? ['hình ảnh', 'hinh anh', 'image', 'imagen', 'ảnh', 'anh'] : ['video', 'videocam', 'veo'];
                const t = modeBtns.find((b) => kw.some((k) => (b.innerText || b.getAttribute('aria-label') || '').toLowerCase().includes(k)));
                if (t) {
                  const clickTarget = t.querySelector('button') || t;
                  clickTarget.click();
                  await new Promise((r) => setTimeout(r, 400));
                }
              }
              const bd = document.querySelector('.cdk-overlay-backdrop');
              if (bd) bd.click();
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((r) => setTimeout(r, 400));
            }
          }

          // 1c. Tìm ô nhập prompt bên trong promptBox
          let pm = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response)');
          if (!pm) {
            pm = document.querySelector(
              'flow-prompt-box .ProseMirror, .prosemirror-editor .ProseMirror, .ProseMirror, flow-prompt-box [contenteditable="true"], [contenteditable="true"]:not([contenteditable="false"]), textarea:not(.g-recaptcha-response)'
            );
          }
          if (!pm) {
            const editables = Array.from(promptBox.querySelectorAll('[contenteditable="true"], textarea, div[role="textbox"]'));
            pm = editables.find((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 50 && rect.height > 20;
            });
          }
          if (!pm) {
            return { ok: false, error: 'NO_PROSEMIRROR' };
          }

          pm.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          await new Promise((r) => setTimeout(r, 100));

          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            pm.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          } catch (e) {}

          document.execCommand('insertText', false, text);
          pm.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          pm.dispatchEvent(new Event('input', { bubbles: true }));
          pm.dispatchEvent(new Event('change', { bubbles: true }));
          pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));

          await new Promise((r) => setTimeout(r, 600));

          // 1d. Tìm nút Generate và chờ Angular validate enable
          let btn = null;
          const waitBtnStart = Date.now();
          while (Date.now() - waitBtnStart < 3500) {
            btn = promptBox.querySelector(
              'flow-generate-icon-button button, button.generate-icon-button, button.submit-button, flow-prompt-box button[type="submit"]'
            );

            if (!btn) {
              const boxBtns = Array.from(promptBox.querySelectorAll('button')).filter((b) => {
                if (b.classList.contains('settings-trigger-button') || b.closest('flow-settings-button')) return false;
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                if (aria.includes('cài đặt') || aria.includes('settings') || aria.includes('chế độ') || aria.includes('tùy chọn')) return false;
                return true;
              });

              btn = boxBtns.find((b) => {
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                return (
                  aria.includes('bắt đầu tạo') ||
                  aria.includes('bat dau tao') ||
                  aria.includes('tạo') ||
                  aria.includes('generate') ||
                  aria.includes('create') ||
                  aria.includes('submit') ||
                  aria.includes('start') ||
                  txt === 'arrow_forward' ||
                  txt === 'arrow_upward' ||
                  txt === 'send' ||
                  txt === 'spark' ||
                  b.querySelector('mat-icon')
                );
              });

              if (!btn && boxBtns.length > 0) {
                btn = boxBtns[boxBtns.length - 1];
              }
            }

            if (btn && !btn.disabled && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
              break;
            }
            await new Promise((r) => setTimeout(r, 100));
          }

          if (!btn) {
            return { ok: false, error: 'NO_GEN_BUTTON' };
          }

          // Lưu ý: KHÔNG click DOM ở đây để tránh race condition với CDP Trusted Click!
          btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          await new Promise((r) => setTimeout(r, 80));
          const rect = btn.getBoundingClientRect();
          const cx = Math.round(rect.left + rect.width / 2);
          const cy = Math.round(rect.top + rect.height / 2);

          return { ok: true, cx, cy, disabled: btn.disabled, targetMode: reqMode };
        },
      });

      const prep = prepExec?.result;
      if (!prep?.ok) {
        send({ id, result: { ok: false, state: 'FAILED', error: prep?.error || 'PREP_FAILED', errorCode: 'UI_AUTOMATION_FAILED' } });
        return;
      }

      if (taskState.cancelled) {
        send({ id, result: { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' } });
        return;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // STAGE 1 (Part B): CDP Trusted Click Dispatch & Fallback
      // ══════════════════════════════════════════════════════════════════════════
      let cdpSuccess = false;
      const submissionTimestamp = Date.now();
      try {
        try {
          await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        } catch (attErr) {
          if (!attErr?.message?.includes('already attached')) {
            throw attErr;
          }
        }
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: prep.cx,
          y: prep.cy,
        });
        await new Promise((r) => setTimeout(r, 40));
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: prep.cx,
          y: prep.cy,
          button: 'left',
          clickCount: 1,
          modifiers: 0,
        });
        await new Promise((r) => setTimeout(r, 60));
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: prep.cx,
          y: prep.cy,
          button: 'left',
          clickCount: 1,
          modifiers: 0,
        });

        cdpSuccess = true;
        log(`🖱️ Đã phát CDP trusted click tại (${prep.cx}, ${prep.cy}) cho mode=${targetMode}`);
      } catch (cdpErr) {
        warn('CDP click gặp sự cố, fallback sang DOM click tức thì:', cdpErr.message);
      } finally {
        try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
      }

      if (!cdpSuccess) {
        // Fallback DOM click
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            const promptBox =
              document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
            const b =
              promptBox.querySelector('flow-generate-icon-button button, button.generate-icon-button, button.submit-button, button[type="submit"]') ||
              Array.from(promptBox.querySelectorAll('button')).pop();
            if (b) b.click();
          },
        });
      }

      // ══════════════════════════════════════════════════════════════════════════
      // STAGE 1 (Part C): Submission Confirmation Verification (< 6 seconds)
      // ══════════════════════════════════════════════════════════════════════════
      let submissionConfirmed = false;
      const subDeadline = Date.now() + submissionTimeoutMs;
      while (Date.now() < subDeadline) {
        if (taskState.cancelled) {
          send({ id, result: { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' } });
          return;
        }
        await new Promise((r) => setTimeout(r, 300));

        const [subProbeExec] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [{ submissionTimestamp }],
          func: (args) => {
            // 1. Kiểm tra reCAPTCHA challenge modal hoặc toast cảnh báo
            const captchaIframe = document.querySelector('iframe[src*="bframe"], iframe[src*="recaptcha/enterprise/bframe"], .g-recaptcha-bubble-arrow');
            if (captchaIframe) {
              return { accepted: false, challenge: true, error: 'RECAPTCHA_CHALLENGE_DISPLAYED' };
            }

            const toasts = Array.from(document.querySelectorAll('mat-snack-bar-container, .toast, .error-banner, [role="alert"], flow-toast'));
            const botToast = toasts.find((t) => {
              const txt = (t.innerText || t.textContent || '').toLowerCase();
              return txt.includes('unusual activity') || txt.includes('bất thường') || txt.includes('quota') || txt.includes('blocked');
            });
            if (botToast) {
              return { accepted: false, challenge: true, error: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', message: botToast.innerText };
            }

            // 2. Kiểm tra tín hiệu input đã được submit
            const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container');
            const btn = promptBox?.querySelector('flow-generate-icon-button button, button.generate-icon-button, button.submit-button, button[type="submit"]');
            const isBtnDisabled = btn ? (btn.disabled || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') : false;
            const hasSpinner = !!document.querySelector('mat-progress-spinner, mat-spinner, .loading-spinner, flow-loading-indicator, mat-progress-bar');
            const pmText = document.querySelector('.ProseMirror')?.innerText?.trim() || '';
            const isPromptCleared = pmText.length === 0;

            const hasRecentRpc = (window.__VANHSUB_SNIFFER__?.history || []).some((h) => (h.timestamp || 0) >= (args.submissionTimestamp - 500));

            const accepted = isBtnDisabled || hasSpinner || (isPromptCleared && pmText !== '') || hasRecentRpc;
            return { accepted, isBtnDisabled, hasSpinner, hasRecentRpc };
          },
        });

        const subResult = subProbeExec?.result;
        if (subResult?.challenge) {
          send({
            id,
            result: {
              ok: false,
              state: 'BLOCKED_REQUIRES_USER',
              error: subResult.error,
              errorCode: 'BLOCKED_REQUIRES_USER',
              message: subResult.message || 'Phát hiện yêu cầu xác minh bảo mật từ Google Flow',
            },
          });
          return;
        }

        if (subResult?.accepted) {
          submissionConfirmed = true;
          break;
        }

        // Nếu sau 3 giây chưa được accept, thử một lần DOM click retry
        if (Date.now() - submissionTimestamp > 3000 && !subResult?.accepted) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
              const b = document.querySelector('flow-generate-icon-button button, button.generate-icon-button, button.submit-button');
              if (b && !b.disabled) b.click();
            },
          });
        }
      }

      if (!submissionConfirmed) {
        send({
          id,
          result: {
            ok: false,
            state: 'TIMED_OUT',
            error: 'TIMEOUT_SUBMITTING: Giao diện Flow không chấp nhận lệnh tạo sau 6s',
            errorCode: 'TIMEOUT_SUBMITTING',
          },
        });
        return;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // STAGE 2: Multi-Channel Observation Loop
      // ══════════════════════════════════════════════════════════════════════════
      const procDeadline = Date.now() + processingTimeoutMs;
      let observationCompleted = false;

      while (Date.now() < procDeadline) {
        if (taskState.cancelled) {
          send({ id, result: { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' } });
          return;
        }
        await new Promise((r) => setTimeout(r, 400));

        const [obsExec] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [{ preFlight, targetMode, submissionTimestamp }],
          func: (args) => {
            const mode = (args.targetMode || 'IMAGE').toUpperCase();
            const pre = args.preFlight || { cardIds: [], imgUrls: [], videoUrls: [], preFlightTimestamp: 0 };

            // ── Kênh C: Fast Challenge & Error Toast Detection (< 500ms) + Sniffer Early Warning ──
            const earlyWarning = window.__VANHSUB_SNIFFER__?.lastWarning;
            if (earlyWarning && (earlyWarning.timestamp || 0) >= pre.preFlightTimestamp) {
              if (earlyWarning.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || earlyWarning.code === 'RECAPTCHA_REQUIRED' || earlyWarning.code === 'FORBIDDEN') {
                return { status: 'BLOCKED_REQUIRES_USER', error: earlyWarning.code, message: earlyWarning.message };
              }
              if (earlyWarning.code === 'RATE_LIMITED') {
                return { status: 'RATE_LIMITED', error: earlyWarning.code, message: earlyWarning.message };
              }
            }

            const captchaIframe = document.querySelector('iframe[src*="bframe"], iframe[src*="recaptcha/enterprise/bframe"], .g-recaptcha-bubble-arrow');
            if (captchaIframe) {
              return { status: 'BLOCKED_REQUIRES_USER', error: 'RECAPTCHA_CHALLENGE_DISPLAYED' };
            }

            const toasts = Array.from(document.querySelectorAll('mat-snack-bar-container, .toast, .error-banner, [role="alert"], flow-toast'));
            const botToast = toasts.find((t) => {
              const txt = (t.innerText || t.textContent || '').toLowerCase();
              return (
                txt.includes('unusual activity') ||
                txt.includes('hoạt động bất thường') ||
                txt.includes('try again later') ||
                txt.includes('thử lại sau') ||
                txt.includes('blocked') ||
                txt.includes('bị chặn')
              );
            });
            if (botToast) {
              return { status: 'BLOCKED_REQUIRES_USER', error: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', message: botToast.innerText };
            }

            const quotaDialog = Array.from(document.querySelectorAll('mat-dialog-container')).find((d) => {
              const txt = (d.innerText || d.textContent || '').toLowerCase();
              return txt.includes('quota') || txt.includes('limit') || txt.includes('credits') || txt.includes('hạn ngạch');
            });
            if (quotaDialog) {
              return { status: 'RATE_LIMITED', error: 'RESOURCE_EXHAUSTED', message: quotaDialog.innerText };
            }

            // ── Kênh B: Sniffer History (RPC & TRPC) ──
            const hist = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= pre.preFlightTimestamp);

            const errRpc = hist.find((h) => h.status === 403 || h.status === 429 || (h.response && (h.response.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') || h.response.includes('RESOURCE_EXHAUSTED'))));
            if (errRpc) {
              return {
                status: errRpc.status === 429 ? 'RATE_LIMITED' : 'BLOCKED_REQUIRES_USER',
                error: errRpc.response?.includes('RESOURCE_EXHAUSTED') ? 'RESOURCE_EXHAUSTED' : 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
              };
            }

            const genRpc = hist.find((h) => {
              if (!h.url || h.status !== 200 || !h.response) return false;
              if (mode === 'IMAGE') {
                return h.url.includes('ogiZ0b');
              } else {
                return h.url.includes('as29s') || h.url.includes('MZZa6b') || h.url.includes('YhhmEf') || h.url.includes('eb1hJf') || h.url.includes('/fx/api/trpc/');
              }
            });
            if (genRpc) {
              return {
                status: 'COMPLETED',
                capturedRpc: {
                  url: genRpc.url,
                  rpcid: (genRpc.url.match(/rpcids=([^&]+)/) || [])[1] || (mode === 'IMAGE' ? 'ogiZ0b' : 'as29s'),
                  status: genRpc.status,
                  response: genRpc.response,
                },
              };
            }

            // ── Kênh A: DOM Gallery Delta Observation (Strict Container & Dimension Validation) ──
            const galleryContainer = document.querySelector('flow-gallery, flow-project-view, flow-stage, flow-canvas, .gallery-container, .main-content') || document.body;
            const currentCards = Array.from(galleryContainer.querySelectorAll('flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item'));
            const existingIds = new Set(pre.cardIds || []);
            const existingImgs = new Set(pre.imgUrls || []);
            const existingVideos = new Set(pre.videoUrls || []);

            const isParentGenerating = (el) => {
              const card = el.closest('flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item');
              if (!card) return false;
              return !!card.querySelector('mat-progress-spinner, mat-spinner, flow-loading-indicator, mat-progress-bar, .loading') || card.classList.contains('generating');
            };

            // Kiểm tra thẻ đang sinh (progress spinner)
            const isCardGenerating = currentCards.some((c) => {
              const cid = c.getAttribute('data-asset-id') || c.getAttribute('data-id') || c.id;
              if (cid && !existingIds.has(cid)) {
                return !!c.querySelector('mat-progress-spinner, mat-spinner, flow-loading-indicator, mat-progress-bar') || c.classList.contains('generating');
              }
              return false;
            });

            if (mode === 'IMAGE') {
              // Strictly restrict to asset card containers (exclude generic <img>, avatars, tool icons)
              const allImgs = Array.from(galleryContainer.querySelectorAll('flow-asset-card img, flow-media-tile img, mat-card img, [data-asset-id] img, .asset-item img'));
              const targetImg = allImgs.find((im) => {
                const s = im.src || im.currentSrc || '';
                if (!s || existingImgs.has(s)) return false;
                const isValid = s.includes('googleusercontent.com') || s.includes('ai-sandbox') || s.startsWith('blob:') || s.startsWith('data:image');
                const isNotIcon = !s.includes('avatar') && !s.includes('icon') && !s.includes('.svg') && !s.includes('thumb_small') && !s.includes('placeholder');
                // Ensure image meets minimum resolution (>= 200px) to reject tiny preview thumbnails
                const isDecentSize = (im.naturalWidth >= 200 && im.naturalHeight >= 200) || (im.width >= 180 && im.height >= 180);
                const cardDone = !isParentGenerating(im);
                return isValid && isNotIcon && isDecentSize && cardDone && (im.naturalWidth > 0 || im.complete);
              });

              if (targetImg && !isCardGenerating) {
                return {
                  status: 'COMPLETED',
                  domFallback: true,
                  firstImageUrl: targetImg.src || targetImg.currentSrc,
                };
              }
            } else {
              // Mode VIDEO: strictly restrict to asset cards, ignore tutorial or background videos
              const allVideos = Array.from(galleryContainer.querySelectorAll('flow-asset-card video, flow-media-tile video, mat-card video, [data-asset-id] video, .asset-item video'));
              const targetVideo = allVideos.find((v) => {
                const s = v.src || v.currentSrc || v.querySelector('source')?.src || '';
                if (!s || existingVideos.has(s)) return false;
                const isValid = s.includes('googlevideo.com') || s.includes('storage.googleapis.com') || s.includes('googleusercontent.com') || s.includes('ai-sandbox') || s.startsWith('blob:');
                const cardDone = !isParentGenerating(v);
                return isValid && cardDone;
              });

              if (targetVideo && !isCardGenerating) {
                const src = targetVideo.src || targetVideo.currentSrc || targetVideo.querySelector('source')?.src;
                return {
                  status: 'COMPLETED',
                  domFallback: true,
                  videoUrl: src,
                };
              }

              // Kiểm tra thẻ download link hoặc blob link video mới
              const downloadLink = Array.from(galleryContainer.querySelectorAll('flow-asset-card a[download], flow-media-tile a[download], a[download]')).find((a) => {
                const h = a.href || '';
                if (!h || existingVideos.has(h)) return false;
                return h.includes('storage.googleapis.com') || h.includes('googlevideo') || h.startsWith('blob:');
              });
              if (downloadLink && !isCardGenerating) {
                return {
                  status: 'COMPLETED',
                  domFallback: true,
                  videoUrl: downloadLink.href,
                };
              }
            }

            return { status: 'PROCESSING', isCardGenerating };
          },
        });

        const obs = obsExec?.result;
        if (obs?.status === 'COMPLETED') {
          observationCompleted = true;
          const rpcid = targetMode === 'IMAGE' ? 'ogiZ0b' : 'as29s';
          const mediaUrl = obs.firstImageUrl || obs.videoUrl;
          const fallbackResponse = `)]}'\n\n100\n[["wrb.fr","${rpcid}",${JSON.stringify(JSON.stringify([null, [[null, null, null, null, null, null, null, null, null, null, null, null, null, null, mediaUrl]]]))},"generic"]]\n`;

          send({
            id,
            result: {
              ok: true,
              state: 'COMPLETED',
              jobId: params?.jobId || id,
              projectId: params?.projectId || null,
              sceneId: params?.sceneId || null,
              capturedRpc: obs.capturedRpc || {
                url: 'DOM_EXTRACTED',
                rpcid,
                status: 200,
                response: fallbackResponse,
              },
              firstImageUrl: obs.firstImageUrl,
              videoUrl: obs.videoUrl,
              domFallback: obs.domFallback || false,
            },
          });
          return;
        }

        if (obs?.status === 'BLOCKED_REQUIRES_USER') {
          send({
            id,
            result: {
              ok: false,
              state: 'BLOCKED_REQUIRES_USER',
              error: obs.error || 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
              errorCode: 'BLOCKED_REQUIRES_USER',
              message: obs.message || 'Phát hiện cơ chế chặn bot từ Google Flow',
            },
          });
          return;
        }

        if (obs?.status === 'RATE_LIMITED') {
          send({
            id,
            result: {
              ok: false,
              state: 'FAILED',
              error: obs.error || 'RESOURCE_EXHAUSTED',
              errorCode: 'RATE_LIMITED',
              message: obs.message || 'Hạn ngạch tạo media của tài khoản đã hết',
            },
          });
          return;
        }
      }

      // ══════════════════════════════════════════════════════════════════════════
      // STAGE 3: Timeout Expiration
      // ══════════════════════════════════════════════════════════════════════════
      if (!observationCompleted) {
        send({
          id,
          result: {
            ok: false,
            state: 'TIMED_OUT',
            error: `TIMEOUT_PROCESSING: Quá thời gian tạo ${targetMode} (${Math.round(processingTimeoutMs / 1000)}s)`,
            errorCode: 'TIMEOUT_PROCESSING',
          },
        });
      }
    } catch (err) {
      send({
        id,
        result: {
          ok: false,
          state: 'FAILED',
          error: err.message,
          errorCode: 'UI_AUTOMATION_FAILED',
        },
      });
    } finally {
      activeUiGenTasks.delete(id);
    }
    return;
  }

  warn('Không nhận dạng được method:', method);
  send({ id, error: `UNKNOWN_METHOD: ${method}` });
}

// ── Core RPC Execution ─────────────────────────────────────────────────────────

function waitForTabReady(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          const [res] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => !!(globalThis.WIZ_global_data && globalThis.WIZ_global_data.SNlM0e),
          });
          if (res?.result) {
            clearInterval(interval);
            setTimeout(resolve, 1500);
            return;
          }
        }
      } catch (e) {}

      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function ensureTabInProject(tab, preferredProjectId, createNew = false) {
  let currentTab = tab;
  let tabProjectId = extractProjectIdFromUrl(currentTab?.url);
  const validPreferredId = isValidProjectId(preferredProjectId) ? preferredProjectId.trim() : null;

  const oldProjectId = tabProjectId;
  if (!validPreferredId && !createNew) {
    throw new Error('FLOW_PROJECT_REQUIRED: Chưa liên kết project Flow cho tác vụ. Không sử dụng project đang mở.');
  }

  // Quyết định an toàn: Kiểm tra biến môi trường và tab sở hữu
  const isAutoOwned = typeof automationOwnedTabs !== 'undefined' && automationOwnedTabs
    ? automationOwnedTabs.has(currentTab?.id)
    : false;

  if (createNew) {
    if (chrome?.tabs?.create) {
      log('🌐 Mở tab riêng ở chế độ nền để tạo project mới (bảo vệ tab người dùng)...');
      const created = await chrome.tabs.create({ url: 'https://labs.google/fx/vi/tools/flow', active: false });
      await waitForTabReady(created.id, 15000);
      currentTab = await chrome.tabs.get(created.id);
      if (typeof automationOwnedTabs !== 'undefined' && automationOwnedTabs) {
        automationOwnedTabs.set(currentTab.id, {
          tabId: currentTab.id,
          projectId: null,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          purpose: 'automation',
        });
      }
    } else throw new Error('FLOW_PROJECT_CREATE_FAILED: Không thể mở tab test riêng.');
    tabProjectId = extractProjectIdFromUrl(currentTab.url);
    if (tabProjectId) throw new Error('FLOW_PROJECT_CREATE_FAILED: Không mở được trang tạo project mới.');
  }

  // Nếu VanhSub chỉ định projectId hợp lệ cụ thể và tab hiện tại chưa ở đúng project đó:
  if (validPreferredId && validPreferredId !== tabProjectId) {
    tabProjectId = validPreferredId;
    const baseOrigin = currentTab.url && currentTab.url.includes('labs.google')
      ? 'https://labs.google/fx/vi/tools/flow/project/'
      : 'https://flow.google.com/project/';
    const targetUrl = `${baseOrigin}${validPreferredId}`;

    if (chrome?.tabs?.create && !isAutoOwned) {
      // Tab hiện tại là của người dùng thủ công hoặc tab active: Mở tab riêng ở chế độ nền
      log(`🌐 Tab hiện tại thuộc người dùng thủ công, mở tab riêng cho project "${validPreferredId}" ở chế độ nền: ${targetUrl}`);
      const created = await chrome.tabs.create({ url: targetUrl, active: false });
      await waitForTabReady(created.id, 15000);
      currentTab = await chrome.tabs.get(created.id);
      if (typeof automationOwnedTabs !== 'undefined' && automationOwnedTabs) {
        automationOwnedTabs.set(currentTab.id, {
          tabId: currentTab.id,
          projectId: validPreferredId,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          purpose: 'automation',
        });
      }
      tabProjectId = extractProjectIdFromUrl(currentTab?.url);
    } else {
      // Tab do automation quản lý: Cho phép cập nhật URL an toàn
      log(`🎯 Điều hướng tab tới project được chỉ định: "${validPreferredId}"...`);
      await chrome.tabs.update(currentTab.id, { url: targetUrl });
      await waitForTabReady(currentTab.id, 10000);
      currentTab = await chrome.tabs.get(currentTab.id);
      tabProjectId = extractProjectIdFromUrl(currentTab?.url);
      if (typeof automationOwnedTabs !== 'undefined' && automationOwnedTabs) {
        const meta = automationOwnedTabs.get(currentTab.id);
        if (meta) {
          meta.projectId = validPreferredId;
          meta.lastUsedAt = Date.now();
        }
      }
    }
    if (tabProjectId !== validPreferredId) throw new Error('FLOW_PROJECT_MISMATCH: Không mở được đúng project đã liên kết.');
  }

  // Nếu tab đang ở trang sảnh (chưa vào /project/<uuid>), thử tự động click mở hoặc tạo dự án mới
  if (!tabProjectId && currentTab?.id) {
    try {
      log('🔄 Tab đang ở trang chủ Flow, thử tự động vào dự án hoặc bấm "+ Dự án mới"...');
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        world: 'MAIN',
        func: () => {
          const elements = Array.from(
            document.querySelectorAll(
              'button, a, [role="button"], [data-testid*="new-project"], [data-testid*="create-project"], .new-project-button, mat-button'
            )
          );
          const newProjBtn = elements.find((b) => {
            const t = (
              b.innerText ||
              b.getAttribute('aria-label') ||
              b.getAttribute('title') ||
              b.getAttribute('data-testid') ||
              ''
            ).toLowerCase();
            return (
              t.includes('new project') ||
              t.includes('dự án mới') ||
              t.includes('du an moi') ||
              t.includes('tạo dự án') ||
              t.includes('create project') ||
              t.includes('new-project') ||
              t.includes('start a new project')
            );
          });
          if (newProjBtn) {
            newProjBtn.click();
            return true;
          }
          return false;
        },
      });
      // Chờ tối đa 8s để URL chuyển sang /project/<id>
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        currentTab = await chrome.tabs.get(currentTab.id);
        tabProjectId = extractProjectIdFromUrl(currentTab?.url);
        if (tabProjectId) {
          await waitForTabReady(currentTab.id, 6000);
          break;
        }
      }
    } catch (e) {
      warn('Không thể tự động click vào project từ trang chủ:', e?.message);
    }
  }

  if (!tabProjectId || (createNew && tabProjectId === oldProjectId)) {
    throw new Error('FLOW_PROJECT_CREATE_FAILED: Chưa xác nhận được project mới. Vui lòng kiểm tra trang Flow.');
  }
  return { tab: currentTab, projectId: tabProjectId };
}

async function runBatchRpc(cmd) {
  let tab = await getFlowTab(true, cmd?.projectId, {
    jobId: cmd?.jobId,
    targetTabId: cmd?.tabId,
    allowUserTabFallback: false,
  });
  if (!tab) {
    return {
      error: 'NO_FLOW_TAB: Vui lòng mở 1 tab https://flow.google.com/ trên Google Chrome để thực hiện request.',
    };
  }

  const ensured = await ensureTabInProject(tab, cmd?.projectId);
  tab = ensured.tab;
  const tabProjectId = ensured.projectId;

  // Nếu vẫn chưa có project (tab đang ở trang chủ hoặc trang đăng nhập):
  if (!tabProjectId) {
    return {
      error: 'TAB_NOT_IN_PROJECT: Tab Google Chrome hiện chưa ở trong trang dự án (https://flow.google.com/). Vui lòng đăng nhập và bấm mở một Dự án (Project) hoặc "+ New project" trên Google Chrome!',
    };
  }

  const effectiveProjectId = tabProjectId;
  let freqStr = cmd.freq;

  // 1. Luôn thay thế placeholder __PROJECT_ID_SLOT__ hoặc __PROJECT_ID__ bằng project thật đang mở
  freqStr = freqStr.split('__PROJECT_ID_SLOT__').join(effectiveProjectId);
  freqStr = freqStr.split('__PROJECT_ID__').join(effectiveProjectId);

  // 2. Nếu cmd.projectId hợp lệ được cung cấp và khác effectiveProjectId, thay thế nó
  if (isValidProjectId(cmd.projectId) && cmd.projectId !== effectiveProjectId) {
    log(`🎯 Thay thế projectId "${cmd.projectId}" → project thật "${effectiveProjectId}"`);
    freqStr = freqStr.split(cmd.projectId).join(effectiveProjectId);
  }

  // 3. Fallback an toàn: Nếu trong securityBlock vị trí projectId bị rỗng
  freqStr = freqStr.replace(/null,22,null,null,null,"",/g, `null,22,null,null,null,"${effectiveProjectId}",`);
  freqStr = freqStr.replace(/null,22,null,null,null,\\"\\",/g, `null,22,null,null,null,\\"${effectiveProjectId}\\",`);
  freqStr = freqStr.replace(/null,22,null,null,null,\\\\\\"\\\\\\",/g, `null,22,null,null,null,\\\\\\"${effectiveProjectId}\\\\\\",`);
  // 2. Đảm bảo injected.js đã sẵn sàng trong MAIN world của tab trước khi thực thi RPC
  try {
    const [check] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => typeof window.mintCaptcha === 'function',
    });
    if (!check?.result) {
      log('🔄 Tab chưa nạp injected.js trong MAIN world, đang tự động nạp...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        files: ['injected.js'],
      });
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (injectErr) {
    warn('Không thể tự động nạp injected.js vào tab:', injectErr.message);
  }

  // 3. Thực thi trong MAIN world của trang Flow
  try {
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [cmd.rpcid, freqStr, effectiveProjectId, cmd.captchaAction],
      func: async (rpcid, freq, projectId, captchaAction) => {
        let wiz = globalThis.WIZ_global_data || {};
        let at = wiz.SNlM0e;
        let sid = wiz.FdrFJe;
        let bl = wiz.cfb2h;

        // Chờ WIZ_global_data hydrate nếu trang vừa nạp
        if (!at) {
          for (let i = 0; i < 6 && !at; i++) {
            await new Promise((r) => setTimeout(r, 500));
            wiz = globalThis.WIZ_global_data || {};
            at = wiz.SNlM0e;
            sid = wiz.FdrFJe;
            bl = wiz.cfb2h;
          }
        }

        if (!at) {
          try {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const s of scripts) {
              const text = s.textContent || '';
              const patterns = [
                /"SNlM0e"\s*:\s*"([^"]{20,}?)"/,
                /"at"\s*:\s*"(AIQ-[^"]+?)"/,
                /"at"\s*:\s*"(AF[^"]+?)"/,
                /"csrfToken"\s*:\s*"([^"]+?)"/,
              ];
              for (const pattern of patterns) {
                const m = text.match(pattern);
                if (m && m[1]) {
                  at = m[1];
                  break;
                }
              }
              if (at) break;
            }
          } catch (e) {}
        }

        if (!at) {
          try {
            const meta = document.querySelector('meta[name="at"], meta[name="_at"]');
            if (meta) {
              const content = meta.getAttribute('content');
              if (content) at = content;
            }
          } catch (e) {}
        }

        if (!at) {
          return { error: 'NO_AT_TOKEN: Không tìm thấy CSRF at token (WIZ_global_data.SNlM0e) trong trang Flow' };
        }

        let finalFreq = freq;
        if (projectId) {
          finalFreq = finalFreq.split('__PROJECT_ID_SLOT__').join(projectId).split('__PROJECT_ID__').join(projectId);
          finalFreq = finalFreq.replace(/null,22,null,null,null,"",/g, `null,22,null,null,null,"${projectId}",`);
          finalFreq = finalFreq.replace(/null,22,null,null,null,\\"\\",/g, `null,22,null,null,null,\\"${projectId}\\",`);
          finalFreq = finalFreq.replace(/null,22,null,null,null,\\\\\\"\\\\\\",/g, `null,22,null,null,null,\\\\\\"${projectId}\\\\\\",`);
          finalFreq = finalFreq.replace(/(null,22,null,null,null,)(?:\\*["']){2},/g, `$1\\"${projectId}\\",`);
        }

        // Nếu RPC yêu cầu CAPTCHA, mint fresh reCAPTCHA token qua invisible widget (chuẩn FlowKit)
        if (captchaAction && (finalFreq.includes('__CAPTCHA__') || finalFreq.includes('__CAPTCHA_TOKEN_SLOT__'))) {
          try {
            console.log(`[VanhSub:exec] 🔐 Đang mint CAPTCHA token trong MAIN world (action=${captchaAction})...`);
            let token = null;

            // Đợi window.mintCaptcha sẵn sàng (tối đa 15s) nếu injected.js đang nạp
            let waitMint = 0;
            while (typeof window.mintCaptcha !== 'function' && waitMint < 30) {
              await new Promise((r) => setTimeout(r, 500));
              waitMint++;
            }

            if (typeof window.mintCaptcha === 'function') {
              token = await window.mintCaptcha(captchaAction);
            } else if (typeof window.executeWithRetry === 'function') {
              const sk = typeof window.resolveSitekey === 'function' ? window.resolveSitekey() : '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
              token = await window.executeWithRetry(sk, captchaAction);
            } else if (window.grecaptcha?.enterprise) {
              await new Promise((res) => {
                try { window.grecaptcha.enterprise.ready(res); } catch (e) { res(); }
                setTimeout(res, 5000);
              });
              const siteKey = (function() {
                try {
                  if (window.WIZ_global_data && typeof window.WIZ_global_data.xZbWve === 'string' && window.WIZ_global_data.xZbWve.length > 20) {
                    return window.WIZ_global_data.xZbWve;
                  }
                  const cfg = window.___grecaptcha_cfg || {};
                  const clients = cfg.clients || {};
                  for (const k of Object.keys(clients)) {
                    const c = clients[k];
                    if (!c) continue;
                    if (typeof c === 'string' && (c.length > 20 || c.startsWith('6L'))) return c;
                    if (c.sitekey) return c.sitekey;
                    if (c.siteKey) return c.siteKey;
                    if (c.site_key) return c.site_key;
                  }
                } catch (e) {}
                return window.WIZ_global_data?.xZbWve || '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
              })();

              // Ưu tiên 1: Tận dụng existing widget của Flow để lấy trọn vẹn behavioral signals của người dùng
              const existingWidgetId = (function() {
                try {
                  const cfg = window.___grecaptcha_cfg || {};
                  const clients = cfg.clients || {};
                  const keys = Object.keys(clients);
                  if (keys.length > 0) return Number(keys[0]);
                } catch (e) {}
                return null;
              })();

              if (existingWidgetId !== null && !isNaN(existingWidgetId)) {
                try {
                  token = await Promise.race([
                    window.grecaptcha.enterprise.execute(existingWidgetId, { action: captchaAction }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
                  ]);
                  if (token && typeof token === 'string' && token.length > 50) {
                    console.log(`[VanhSub:exec] ✅ Đã mint CAPTCHA token từ existing widgetId=${existingWidgetId} (${token.length} chars)`);
                  }
                } catch (e) {}
              }

              // Ưu tiên 2: Gọi execute trực tiếp với siteKey
              if (!token) {
                try {
                  token = await Promise.race([
                    window.grecaptcha.enterprise.execute(siteKey, { action: captchaAction }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
                  ]);
                  if (token && typeof token === 'string' && token.length > 50) {
                    console.log(`[VanhSub:exec] ✅ Đã mint CAPTCHA token trực tiếp qua siteKey (${token.length} chars)`);
                  }
                } catch (e) {}
              }

              // Ưu tiên 3: Fallback render invisible widget nếu cần
              if (!token) {
                for (let att = 0; att < 2 && !token; att++) {
                  try {
                    let host = document.getElementById('flowkit-recaptcha-host');
                    if (!host) {
                      host = document.createElement('div');
                      host.id = 'flowkit-recaptcha-host';
                      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
                      (document.documentElement || document.body).appendChild(host);
                    } else if (typeof host.hasChildNodes === 'function' && host.hasChildNodes()) {
                      host.remove();
                      host = document.createElement('div');
                      host.id = 'flowkit-recaptcha-host';
                      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
                      (document.documentElement || document.body).appendChild(host);
                    }
                    const widgetId = await new Promise((res, rej) => {
                      try {
                        const wid = window.grecaptcha.enterprise.render(host, {
                          sitekey: siteKey,
                          size: 'invisible',
                          callback: () => {},
                          'error-callback': (m) => rej(new Error('render_error: ' + m)),
                        });
                        res(wid);
                      } catch (e) { rej(e); }
                    });
                    token = await Promise.race([
                      window.grecaptcha.enterprise.execute(widgetId, { action: captchaAction }),
                      new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
                    ]);
                  } catch (fallbackErr) {
                    if (att === 1) throw fallbackErr;
                    await new Promise((r) => setTimeout(r, 600));
                  }
                }
              }
            }
            if (!token) {
              return { error: 'EMPTY_CAPTCHA_TOKEN: grecaptcha trả về token rỗng' };
            }
            console.log(`[VanhSub:exec] ✅ Đã mint CAPTCHA token thành công (${token.length} chars)`);
            finalFreq = finalFreq.split('__CAPTCHA__').join(token).split('__CAPTCHA_TOKEN_SLOT__').join(token);
          } catch (captchaErr) {
            return { error: 'CAPTCHA_EXECUTE_ERROR: ' + (captchaErr.message || String(captchaErr)) };
          }
        }

        window.__vanhsub_reqseq = ((window.__vanhsub_reqseq || 0) + 1);
        const now = new Date();
        const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const reqid = (window.__vanhsub_reqseq * 100000) + secondsSinceMidnight;
        const sourcePath = projectId ? `/project/${projectId}` : (location.pathname || '/');
        const hl = (document.documentElement.lang || navigator.language || 'vi').split('-')[0];

        // Chuẩn hoá URL dạng relative cùng origin theo chuẩn FlowKit
        const url =
          `/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${encodeURIComponent(rpcid)}` +
          `&source-path=${encodeURIComponent(sourcePath)}` +
          `&bl=${encodeURIComponent(bl || '')}&f.sid=${encodeURIComponent(sid || '')}` +
          `&hl=${encodeURIComponent(hl)}&_reqid=${reqid}&rt=c`;

        // Chuẩn hoá POST body với trailing & chuẩn Google batchexecute theo phân tích HAR
        const body = `f.req=${encodeURIComponent(finalFreq)}&at=${encodeURIComponent(at)}&`;

        const headers = {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-same-domain': '1',
        };

        try {
          console.log(`[VanhSub:exec] 📡 Đang fetch thuần RPC rpcid=${rpcid}...`);
          const res = await window.fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body,
          });
          const text = await res.text();
          return {
            status: res.status,
            ok: res.ok,
            body: text,
          };
        } catch (fetchErr) {
          return { error: 'FETCH_EXCEPTION: ' + (fetchErr.message || String(fetchErr)) };
        }
      },
    });

    return execResult?.result || { error: 'SCRIPT_EXECUTION_EMPTY' };
  } catch (err) {
    return { error: `EXECUTE_SCRIPT_ERROR: ${err.message}` };
  }
}

// Khởi chạy khi service worker bật
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('pairing.html')) return;
  if (message?.type === 'BRIDGE_PAIRING_STATUS') {
    respond({ connected: bridgeAuthenticated && ws?.readyState === WebSocket.OPEN });
  } else if (message?.type === 'BRIDGE_PAIR') {
    if (typeof message.code !== 'string' || !/^[a-f0-9]{32}$/.test(message.code)) { respond({ ok: false, error: 'Mã ghép đôi không hợp lệ.' }); return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) { connectWebSocket(); respond({ ok: false, error: 'Mở VANHSUB rồi thử lại sau vài giây.' }); return; }
    (async () => {
      const key = await sha(message.code);
      pendingPairKey = key;
      if (authContext && !bridgeAuthenticated && ws?.readyState === WebSocket.OPEN) await sendAuthProof(ws, authContext);
      else { const previous = ws; ws = null; bridgeAuthenticated = false; previous?.close(); connectWebSocket(); }
      respond({ ok: true });
    })().catch(() => respond({ ok: false, error: 'Không thể ghép đôi.' }));
    return true;
  }
});
connectWebSocket();

chrome.runtime.onStartup.addListener(() => {
  connectWebSocket();
});

chrome.alarms.create('reconnect_alarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnect_alarm') {
    connectWebSocket();
  }
});
