/**
 * test_rpc_phase1.ts
 *
 * ═══════════════════════════════════════════════════════════════
 *   GIAI ĐOẠN 1 — Test Script: Xác minh P1–P4
 * ═══════════════════════════════════════════════════════════════
 *
 * Mục tiêu: Xác minh toàn bộ token stack + upload 1 ảnh nhỏ thật.
 *   - P1: at token extraction (window.WIZ_global_data.SNlM0e)
 *   - P2: body field `at=` = CAPTCHA hay XSRF?
 *   - P3: Inner payload ogiZ0b (chỉ LOG — chưa gửi thật)
 *   - P4: maseQ upload format (thử và log response)
 *
 * KHÔNG TIÊU CREDIT — chỉ upload ảnh test nhỏ (maseQ không charge credit).
 * KHÔNG thay đổi production code.
 *
 * ── Cách chạy ──────────────────────────────────────────────────
 * Gọi function testRpcPhase1() từ main process SAU KHI lobbyWindow đã
 * mở và đang ở flow.google.com/project/<id>:
 *
 *   // Trong main.ts hoặc IPC handler:
 *   import { testRpcPhase1 } from '../workflow/flow-engine/rpc/test_rpc_phase1';
 *
 *   ipcMain.handle('debug:test-rpc-phase1', async (_, projectId) => {
 *     const sessionMgr = GoogleVeoSessionManager.getInstance();
 *     const win = sessionMgr.getLobbyWindow();
 *     return await testRpcPhase1(win, projectId);
 *   });
 *
 * ── Kết quả mong đợi ────────────────────────────────────────────
 * Nếu P1–P4 đều OK → console output:
 *   ✅ PHASE 1 COMPLETE: media_id = <uuid>
 *   → Giai đoạn 1 XÁC NHẬN thành công. Sẵn sàng Giai đoạn 2.
 *
 * Nếu có VERIFY FAILED → xem console để biết điểm nào sai.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { FlowRpcClient } from './FlowRpcClient';
import {
  buildGenImagePayload,
  type GenImagePayloadOptions,
} from './FlowBatchBuilder';
import {
  CAPTCHA_ACTION_IMAGE,
  RECAPTCHA_SITE_KEY,
  WIZ_DATA_AT_TOKEN_KEY,
  RPC_GEN_IMAGE,
} from './FlowBatchConstants';

export interface Phase1Result {
  success: boolean;
  results: {
    p1_atToken: 'pass' | 'fail' | 'skip';
    p2_captchaField: 'pending_manual_verify';  // cần Network capture thủ công
    p3_payloadLog: string;
    p4_uploadMediaId: string | null;
    p4_uploadStatus: 'pass' | 'fail' | 'skip';
    p7_captchaAvailable: 'pass' | 'fail' | 'skip';
  };
  errors: string[];
  rawLogs: string[];
}

/**
 * Chạy full Phase 1 test. Gọi từ IPC handler sau khi lobbyWindow sẵn sàng.
 *
 * @param win lobbyWindow đang ở flow.google.com/project/<id>
 * @param projectId UUID project từ URL (ví dụ: copy từ URL thanh địa chỉ)
 * @param testImagePath Đường dẫn ảnh test nhỏ để upload.
 *   Default: tạo file PNG 1×1 pixel tạm thời.
 */
export async function testRpcPhase1(
  win: Electron.BrowserWindow,
  projectId: string,
  testImagePath?: string
): Promise<Phase1Result> {
  const logs: string[] = [];
  const errors: string[] = [];
  const result: Phase1Result = {
    success: false,
    results: {
      p1_atToken: 'skip',
      p2_captchaField: 'pending_manual_verify',
      p3_payloadLog: '',
      p4_uploadMediaId: null,
      p4_uploadStatus: 'skip',
      p7_captchaAvailable: 'skip',
    },
    errors,
    rawLogs: logs,
  };

  const log = (msg: string) => {
    console.log('[Phase1Test]', msg);
    logs.push(`[${new Date().toISOString()}] ${msg}`);
  };
  const err = (msg: string) => {
    console.error('[Phase1Test] ❌', msg);
    errors.push(msg);
    logs.push(`[${new Date().toISOString()}] ❌ ${msg}`);
  };

  log('══════════════════════════════════════════');
  log('  GIAI ĐOẠN 1 — RPC Transport Test');
  log(`  projectId: ${projectId}`);
  const currentUrl = win.webContents?.getURL?.() ?? '';
  log(`  Current URL: ${currentUrl}`);

  // Chuyển hướng vào trang project nếu đang ở trang chủ hoặc ngoài project
  if (projectId && !currentUrl.includes(projectId)) {
    const targetUrl = `https://flow.google.com/project/${projectId}`;
    log(`  🔄 lobbyWindow đang ở ngoài project, tự động chuyển hướng vào: ${targetUrl}`);
    await win.loadURL(targetUrl);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    log(`  Current URL sau chuyển hướng: ${win.webContents?.getURL?.() ?? ''}`);
  }
  log('');

  const client = new FlowRpcClient('persist:google_veo');

  // ── Test 1: Cookie string ───────────────────────────────────────────────
  log('── Test 1: Cookie string ──');
  try {
    const cookieStr = await client.getCookieString();
    const cookieCount = cookieStr.split(';').length;
    const hasSID = cookieStr.includes('SID=');
    const hasSecure1PSID = cookieStr.includes('__Secure-1PSID=');
    log(`Cookie count: ${cookieCount}`);
    log(`Has SID: ${hasSID}`);
    log(`Has __Secure-1PSID: ${hasSecure1PSID}`);
    log(`Cookie string (200 chars): ${cookieStr.slice(0, 200)}`);
    if (!hasSID && !hasSecure1PSID) {
      err('Cookie thiếu SID và __Secure-1PSID — session có thể chưa đăng nhập hoặc partition sai');
    } else {
      log('✅ Cookie OK');
    }
  } catch (e: any) {
    err(`Cookie test failed: ${e.message}`);
  }
  log('');

  // ── Test 2: at Token (VERIFY P1) ───────────────────────────────────────
  log('── Test 2: at Token (VERIFY P1) ──');
  log(`  Tìm window.WIZ_global_data.${WIZ_DATA_AT_TOKEN_KEY}`);
  try {
    // Inspect WIZ_global_data keys để debug P1
    const wizInspect: any = await win.webContents.executeJavaScript(`
      (function() {
        const wgd = window.WIZ_global_data;
        if (!wgd) return { exists: false };
        const keys = Object.keys(wgd);
        // Tìm key có pattern token (dài > 20 chars, không phải URL)
        const tokenCandidates = keys.filter(k => {
          const v = wgd[k];
          return typeof v === 'string' && v.length > 20 && !v.includes('/') && !v.includes('http');
        });
        return {
          exists: true,
          allKeys: keys.slice(0, 20),
          tokenCandidates: tokenCandidates.slice(0, 5),
          SNlM0e: wgd['SNlM0e'] ? wgd['SNlM0e'].slice(0, 30) + '...' : null,
        };
      })()
    `);

    log(`WIZ_global_data exists: ${wizInspect?.exists}`);
    log(`WIZ_global_data keys (first 20): ${wizInspect?.allKeys?.join(', ')}`);
    log(`Token candidate keys: ${wizInspect?.tokenCandidates?.join(', ')}`);
    log(`WIZ_global_data.SNlM0e: ${wizInspect?.SNlM0e ?? 'NOT FOUND'}`);

    const atToken = await client.getAtToken(win);
    log(`✅ VERIFY P1 PASS: at token length=${atToken.length}, preview=${atToken.slice(0, 30)}...`);
    result.results.p1_atToken = 'pass';
  } catch (e: any) {
    err(`VERIFY P1 FAIL: ${e.message}`);
    result.results.p1_atToken = 'fail';
  }
  log('');

  // ── Test 3: reCAPTCHA (VERIFY P7) ─────────────────────────────────────
  log('── Test 3: reCAPTCHA availability (VERIFY P7) ──');
  try {
    const captchaToken = await client.mintCaptchaToken(win, CAPTCHA_ACTION_IMAGE);
    log(`✅ VERIFY P7 PASS: CAPTCHA minted thành công, length=${captchaToken.length}`);
    result.results.p7_captchaAvailable = 'pass';
  } catch (e: any) {
    err(`VERIFY P7 FAIL: ${e.message}`);
    result.results.p7_captchaAvailable = 'fail';
  }
  log('');

  // ── Test 4: Log payload ogiZ0b (VERIFY P3) — KHÔNG gửi ─────────────────
  log('── Test 4: Log payload ogiZ0b (VERIFY P3 — chỉ xem, không gửi) ──');
  const sampleOpts: GenImagePayloadOptions = {
    prompt: 'A test scene for phase 1 verification',
    aspectRatio: '16:9',
    outputCount: 1,
    referenceMediaIds: ['PLACEHOLDER_CHAR_MEDIA_ID'],
    projectId,
    imageModel: 'GEM_PIX_2',
    captchaToken: 'PLACEHOLDER_CAPTCHA_TOKEN',
  };
  const samplePayload = buildGenImagePayload(sampleOpts);
  const payloadJson = JSON.stringify(samplePayload, null, 2);
  log(`ogiZ0b inner payload structure:\n${payloadJson}`);
  log('  → Sau khi chụp Network tab thực tế, so sánh với payload này để VERIFY P3');
  result.results.p3_payloadLog = payloadJson;
  log('');

  // ── Test 5: Upload ảnh nhỏ (VERIFY P4) ────────────────────────────────
  log('── Test 5: Upload reference image (VERIFY P4) ──');
  log('  ⚠️ Sẽ tạo và upload file PNG 1×1 pixel test, KHÔNG tiêu credit');

  // Tạo ảnh PNG 1×1 pixel tạm thời nếu không có file test
  let imagePath = testImagePath;
  let tempCreated = false;
  if (!imagePath || !fs.existsSync(imagePath)) {
    const tempDir = os.tmpdir();
    imagePath = path.join(tempDir, `flowrpc_phase1_test_${Date.now()}.png`);
    // PNG 1×1 pixel đỏ (binary minimal valid PNG)
    const minimalPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG header
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB, CRC
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    fs.writeFileSync(imagePath, minimalPng);
    tempCreated = true;
    log(`  Tạo file PNG test: ${imagePath} (${minimalPng.length} bytes)`);
  } else {
    log(`  Dùng file test có sẵn: ${imagePath}`);
  }

  try {
    const uploadResult = await client.uploadReferenceImage(win, imagePath, projectId);
    log(`✅ VERIFY P4 PASS: Upload thành công! media_id = ${uploadResult.mediaId}`);
    result.results.p4_uploadMediaId = uploadResult.mediaId;
    result.results.p4_uploadStatus = 'pass';
    result.success = true;
  } catch (e: any) {
    err(`VERIFY P4 FAIL: ${e.message}`);
    result.results.p4_uploadStatus = 'fail';

    // Hướng dẫn debug P4
    log('');
    log('  ── Hướng dẫn debug VERIFY P4 ──');
    log('  1. Mở DevTools của lobbyWindow (BrowserWindow.openDevTools())');
    log('  2. Vào tab Network, filter "batchexecute"');
    log('  3. Thực hiện thủ công: upload 1 ảnh vào Flow project qua UI');
    log('  4. Tìm request có rpcids=maseQ (hoặc tên RPC upload)');
    log('  5. Copy payload f.req từ tab Payload → so sánh với format trong FlowBatchBuilder.ts');
    log('  6. Cập nhật buildUploadPayload() theo format thực tế');
  } finally {
    if (tempCreated && imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      log(`  Đã xóa file PNG test tạm thời`);
    }
  }

  // ── P2 Manual Verify Note ─────────────────────────────────────────────
  log('');
  log('── P2 Hướng dẫn VERIFY P2 (thủ công) ──');
  log('  VERIFY P2 cần capture Network tab thủ công:');
  log('  1. Mở DevTools → Network → filter "batchexecute"');
  log('  2. Tạo 1 ảnh thủ công trong Flow UI');
  log('  3. Tìm request POST batchexecute, xem Payload tab');
  log('  4. Kiểm tra: field `at` trong body = CAPTCHA token hay XSRF token?');
  log('     - CAPTCHA token bắt đầu bằng "03A..." hoặc tương tự reCAPTCHA format');
  log('     - XSRF token bắt đầu bằng "AF..." và ngắn hơn');
  log('  5. Cập nhật BODY_CAPTCHA_FIELD constant nếu tên field khác "at"');

  // ── Summary ───────────────────────────────────────────────────────────
  log('');
  log('══════════════════════════════════════════');
  log('  KẾT QUẢ GIAI ĐOẠN 1');
  log('══════════════════════════════════════════');
  log(`  P1 (at token):       ${result.results.p1_atToken}`);
  log(`  P2 (captcha field):  ${result.results.p2_captchaField}`);
  log(`  P3 (ogiZ0b payload): logged`);
  log(`  P4 (upload):         ${result.results.p4_uploadStatus} — media_id: ${result.results.p4_uploadMediaId ?? 'N/A'}`);
  log(`  P7 (grecaptcha):     ${result.results.p7_captchaAvailable}`);
  log(`  Errors (${errors.length}): ${errors.join(' | ') || 'none'}`);
  log('');

  if (result.success) {
    log('🎉 GIAI ĐOẠN 1 THÀNH CÔNG! RPC transport hoạt động.');
    log('   Bước tiếp theo: Giai đoạn 2 — port ogiZ0b generate image.');
  } else {
    log('⚠️  GIAI ĐOẠN 1 CÓ LỖI. Xem errors[] để biết điểm cần fix.');
  }
  log('══════════════════════════════════════════');

  return result;
}
