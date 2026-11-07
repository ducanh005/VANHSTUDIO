import assert from 'node:assert/strict';
import path from 'node:path';
import { validateIpcPayload as check } from '../main/security/ipcPayload';
check('downloader:checkTask', ['valid-id', 'source']);
check('downloader:cancelCheck', ['valid-id']);
check('aiStudio:voices:kokoro', []);
check('downloader:download', [{ cleanMetadata: false }]);
const file = path.resolve('synthetic media.mp4');
check('tasks:create', [{ fileName: 'synthetic media.mp4', filePath: file }]);
check('tasks:update', ['valid-id', { srtPath: path.resolve('phụ đề.srt'), ttsNeedsRegeneration: true }]);
check('export:start', ['valid-id', 'hardsub', null, null, { formatOptions: { resolution: '1080p' } }]);
// Exact default hardsub shape sent by ExportPage (optional effects are null).
check('export:start', ['valid-id', 'hardsub', null, { fontName: 'Arial', fontSize: 18 }, {
  videoSource: 'auto', customMask: null, customMasks: [], watermark: null,
  formatOptions: null, dualSubtitles: null, kineticConfig: null,
}]);
for (const [channel, args] of [
  ['tasks:create', [{ fileName: 'x', filePath: '../outside.mp4' }]],
  ['tasks:update', ['id', { id: 'other' }]],
  ['tasks:start', ['../task']],
  ['downloader:checkTask', ['../task', 'source']],
  ['downloader:checkTask', ['valid-id', 'arbitrary']],
  ['downloader:cancelCheck', ['../task']],
  ['aiStudio:voices:kokoro', [{ endpoint: 'https://example.invalid' }]],
  ['downloader:download', [{ cleanMetadata: 'false' }]],
  ['tasks:readSrt', [path.resolve('secrets.json')]],
  ['export:start', ['id', 'arbitrary']],
  ['export:start', ['id', 'hardsub', null, null, { formatOptions: { resolution: '4k' } }]],
  ['export:start', ['id', 'hardsub', null, null, { formatOptions: [] }]],
  ['export:start', ['id', 'hardsub', null, null, { formatOptions: 1 }]],
  ['tts:start', ['id', 'voice', NaN]],
  ['workflow:run', [JSON.parse('{"__proto__":{"polluted":true}}')]],
  ['workflow:run', [{ constructor: {} }]],
  ['aiStudio:scene:updateFillMode', [{ sessionId: '../episode' }]],
  ['any', ['x'.repeat(16 * 1024 * 1024 + 1)]],
] as Array<[string, unknown[]]>) assert.throws(() => check(channel, args), /IPC_PAYLOAD_INVALID/);
let nested: any = {}; for (let i = 0; i < 30; i++) nested = { nested };
assert.throws(() => check('any', [nested]), /IPC_PAYLOAD_INVALID/);
assert.equal(({} as any).polluted, undefined);
check('aiStudio:readiness', []);
assert.throws(() => check('aiStudio:readiness', [{apiKey:'cannot-submit-keys-here'}]), /IPC_PAYLOAD_INVALID/);
console.log('PASS: IPC bounds/depth/prototype keys, task identity/path schemas and critical export/TTS/subtitle validation');
