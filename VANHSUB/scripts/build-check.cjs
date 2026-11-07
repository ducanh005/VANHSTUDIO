/** Cross-drive-safe production build in a new directory; never writes shared dependencies or a running app. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const deps = fs.realpathSync(process.env.VANHSUB_BUILD_DEPENDENCIES || path.join(source, 'node_modules'));
const parent = fs.realpathSync(process.env.VANHSUB_BUILD_STAGE_PARENT || path.dirname(deps));
if (process.platform === 'win32' && path.parse(parent).root.toLowerCase() !== path.parse(deps).root.toLowerCase()) {
  throw new Error('Build stage and dependencies must be on the same Windows drive.');
}
const stage = fs.mkdtempSync(path.join(parent, 'vanhsub-build-check-'));
const files = {};
function copy(relative) {
  const from = path.join(source, relative), stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) throw new Error('Source symlink outside allowlist: ' + relative);
  if (stat.isDirectory()) {
    if (['node_modules', '.next', '.git', 'app', 'dist', 'out', 'build'].includes(path.basename(relative))) return;
    for (const name of fs.readdirSync(from)) copy(path.join(relative, name));
  } else if (!path.basename(relative).startsWith('.env') && !relative.endsWith('.tsbuildinfo')) {
    const bytes = fs.readFileSync(from), to = path.join(stage, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, bytes);
    files[relative] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
}
for (const name of ['main', 'renderer', 'shared', 'resources', 'extension', 'package.json', 'package-lock.json', 'tsconfig.json', 'nextron.config.js']) copy(name);
fs.symlinkSync(deps, path.join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
const results = [];
for (const [name, args] of [
  ['renderer', [path.join(deps, 'next/dist/bin/next'), 'build', path.join(stage, 'renderer'), '--webpack']],
  ['main-preload', ['--require', path.join(__dirname, 'webpack-check.cjs'), path.join(deps, 'nextron/bin/webpack.config.cjs')]],
]) {
  const start = Date.now();
  const run = spawnSync(process.execPath, args, { cwd: stage, env: { ...process.env, NODE_ENV: 'production', NEXT_EXPORT: 'true', NEXT_TELEMETRY_DISABLED: '1' }, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 360000 });
  fs.writeFileSync(path.join(stage, name + '.log'), (run.stdout || '') + (run.stderr || ''));
  results.push({ name, exitCode: run.status, elapsedMs: Date.now() - start, error: run.error?.message });
  console.log(JSON.stringify(results.at(-1)));
  if (run.status !== 0) { process.exitCode = 1; break; }
}
const artifacts = ['main.js', 'preload.js', 'home/index.html'].map(file => ({ file, exists: fs.existsSync(path.join(stage, 'app', file)) }));
if (artifacts.some(x => !x.exists)) process.exitCode = 1;
const result = { stage, source, dependencies: deps, sourceFiles: files, results, artifacts, installerGenerated: false };
fs.writeFileSync(path.join(stage, 'build-check-result.json'), JSON.stringify(result, null, 2));
console.log('BUILD EVIDENCE: ' + path.join(stage, 'build-check-result.json'));
// Preserve this run's artifacts/logs for review. Never remove a worktree, shared cache or active build.
