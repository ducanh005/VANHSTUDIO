import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function main() {
  const sockets: any[] = [], stored: any = {}, handled: any[] = [];
  let listener: any, trusted = false;
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0; sent: any[] = []; onopen: any; onmessage: any; onclose: any;
    constructor() { sockets.push(this); }
    send(text: string) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const extension = 'chrome-extension://' + 'a'.repeat(32) + '/';
  const context: any = { crypto: crypto.webcrypto, TextEncoder, WebSocket: Socket, console: { log() {}, warn() {}, error() {} }, setInterval: () => 1, clearInterval() {}, setTimeout,
    handled, chrome: {
      storage: { local: {
        setAccessLevel: async ({ accessLevel }: any) => { trusted = accessLevel === 'TRUSTED_CONTEXTS'; },
        get: async () => ({ ...stored }), set: async (value: any) => { assert.ok(trusted); Object.assign(stored, value); },
      } },
      tabs: { onRemoved: { addListener() {} } },
      runtime: { id: 'a'.repeat(32), getURL: (file: string) => extension + file, getManifest: () => ({ version: '1.0.8' }),
        onConnect: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn: any) { listener = fn; } } },
      alarms: { create() {}, onAlarm: { addListener() {} } },
    } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('extension/background.js', 'utf8') + '\nhandleMessage = async message => handled.push(message.type);', context);
  const socket = sockets[0]; socket.readyState = Socket.OPEN; await socket.onopen();
  assert.equal(socket.sent[0].type, 'HANDSHAKE');
  await socket.onmessage({ data: JSON.stringify({ type: 'EXECUTE_RPC' }) }); assert.equal(handled.length, 0);
  const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
  const hmac = (k: string, v: string) => crypto.createHmac('sha256', k).update(v).digest('hex');
  const nonce = 'n'.repeat(43), value = extension.slice(0, -1) + '|9222|' + nonce;
  await socket.onmessage({ data: JSON.stringify({ type: 'AUTH_CHALLENGE', protocol: 2, port: 9222, nonce }) });
  const code = 'a'.repeat(32); let response: any;
  listener({ type: 'BRIDGE_PAIR', code }, { id: 'a'.repeat(32), tab: { id: 1 }, url: extension + 'pairing.html' }, (v: any) => { response = v; });
  assert.equal(response, undefined, 'Content scripts cannot issue pairing');
  listener({ type: 'BRIDGE_PAIR', code }, { id: 'a'.repeat(32), url: extension + 'other.html' }, (v: any) => { response = v; });
  assert.equal(response, undefined);
  await new Promise<void>(resolve => listener({ type: 'BRIDGE_PAIR', code }, { id: 'a'.repeat(32), url: extension + 'pairing.html' }, (v: any) => { response = v; resolve(); }));
  assert.equal(response.ok, true); assert.equal(socket.sent.at(-1).type, 'PAIR');
  assert.equal(socket.sent.at(-1).proof, hmac(sha(code), 'client|' + value));
  assert.ok(!JSON.stringify(socket.sent).includes(code));
  const token = 'a'.repeat(43);
  const authenticating = socket.onmessage({ data: JSON.stringify({ type: 'AUTH_OK', protocol: 2, token, serverProof: hmac(sha(code), 'server|' + value + '|' + sha(token)) }) });
  const immediateCommand = socket.onmessage({ data: JSON.stringify({ type: 'EXECUTE_RPC' }) });
  await Promise.all([authenticating, immediateCommand]);
  assert.equal(stored.bridgePairingToken, token);
  assert.equal(handled.length, 1, 'Command arriving during async proof verification must not be dropped');
  socket.close();
  vm.runInContext('connectWebSocket()', context);
  const reconnected = sockets[1]; reconnected.readyState = Socket.OPEN; await reconnected.onopen();
  assert.equal(reconnected.sent[0].token, undefined, 'Reconnect never sends bearer token');
  const nextNonce = 'b'.repeat(43), nextValue = extension.slice(0, -1) + '|9222|' + nextNonce;
  await reconnected.onmessage({ data: JSON.stringify({ type: 'AUTH_CHALLENGE', protocol: 2, port: 9222, nonce: nextNonce }) });
  assert.equal(reconnected.sent.at(-1).proof, hmac(sha(token), 'client|' + nextValue));
  assert.ok(!JSON.stringify(reconnected.sent).includes(token));
  await reconnected.onmessage({ data: JSON.stringify({ type: 'AUTH_OK', protocol: 2, serverProof: hmac(sha(token), 'server|' + nextValue) }) });
  vm.runInContext("handleMessage = async message => { handled.push(message.type); if (message.type === 'LONG_JOB') await new Promise(resolve => globalThis.releaseLong = resolve); };", context);
  const longJob = reconnected.onmessage({ data: JSON.stringify({ type: 'LONG_JOB' }) });
  await new Promise(resolve => setImmediate(resolve));
  await reconnected.onmessage({ data: JSON.stringify({ type: 'CANCEL_JOB' }) });
  assert.deepEqual(handled.slice(-2), ['LONG_JOB', 'CANCEL_JOB'], 'Cancellation is not queued behind a long-running handler');
  context.releaseLong(); await longJob;
  vm.runInContext("handleMessage = async () => { throw new Error('FLOW_PROJECT_REQUIRED: Project must be linked'); };", context);
  await reconnected.onmessage({ data: JSON.stringify({ id: 'missing-project-request', method: 'batch_rpc' }) });
  assert.equal(reconnected.sent.at(-1).id, 'missing-project-request');
  assert.match(reconnected.sent.at(-1).error, /^FLOW_PROJECT_REQUIRED:/, 'Rejected handlers reply immediately rather than leaving the app waiting for timeout');
  socket.onclose();
  listener({ type: 'BRIDGE_PAIRING_STATUS' }, { id: 'a'.repeat(32), url: extension + 'pairing.html' }, (value: any) => { response = value; });
  assert.equal(response.connected, true, 'Stale socket callback does not reset new connection');
  assert.equal(response.token, undefined);
  // A fake listener's AUTH_OK cannot authorize commands or overwrite the token.
  reconnected.close(); vm.runInContext('connectWebSocket()', context);
  const fake = sockets.at(-1); fake.readyState = Socket.OPEN; await fake.onopen();
  await fake.onmessage({ data: JSON.stringify({ type: 'AUTH_OK', protocol: 2, token: 'z'.repeat(43) }) });
  await fake.onmessage({ data: JSON.stringify({ type: 'EXECUTE_RPC' }) });
  assert.equal(handled.length, 3); assert.equal(stored.bridgePairingToken, token);
  vm.runInContext('connectWebSocket()', context);
  const crossPort = sockets.at(-1); crossPort.readyState = Socket.OPEN; await crossPort.onopen();
  await crossPort.onmessage({ data: JSON.stringify({ type: 'AUTH_CHALLENGE', protocol: 2, port: 8765, nonce }) });
  assert.equal(crossPort.readyState, 3, 'Wrong-port challenge rejected');
  vm.runInContext('connectWebSocket()', context);
  const wrongProof = sockets.at(-1); wrongProof.readyState = Socket.OPEN; await wrongProof.onopen();
  await wrongProof.onmessage({ data: JSON.stringify({ type: 'AUTH_CHALLENGE', protocol: 2, port: 9222, nonce }) });
  await wrongProof.onmessage({ data: JSON.stringify({ type: 'AUTH_OK', protocol: 2, serverProof: '0'.repeat(64) }) });
  await wrongProof.onmessage({ data: JSON.stringify({ type: 'EXECUTE_RPC' }) });
  assert.equal(wrongProof.readyState, 3); assert.equal(handled.length, 3);
  console.log('PASS: extension mutual proofs reject fake server and cross-port challenges; popup/storage isolation and token-free reconnect');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
