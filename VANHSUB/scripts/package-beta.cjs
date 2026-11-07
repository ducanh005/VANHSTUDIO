/** Offline, isolated packaging using a previously verified runtime closure. Never installs over Beta. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'..'),build=path.resolve(process.env.VANHSUB_BETA_BUILD||''),seed=path.resolve(process.env.VANHSUB_BETA_SEED_ROOT||''),parent=path.resolve(process.env.VANHSUB_BETA_OUTPUT_PARENT||'');
for(const key of ['VANHSUB_BETA_BUILD','VANHSUB_BETA_SEED_ROOT','VANHSUB_BETA_OUTPUT_PARENT'])assert.ok(process.env[key],key+' required');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),manifest=JSON.parse(fs.readFileSync(path.join(build,'build-check-result.json')));
assert.ok(manifest.results.every(r=>r.exitCode===0));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source,'package-lock.json'))),JSON.parse(fs.readFileSync(path.join(seed,'package-lock.json'))),'Seed runtime lockfile content mismatch');
for(const [f,h]of Object.entries(manifest.sourceFiles))assert.equal(hash(path.join(source,f)),h,'Build/source drift '+f);
const deps=manifest.dependencies,asar=require(path.join(deps,'@electron/asar')),archive=path.join(seed,'dist/win-unpacked/resources/app.asar');
assert.ok(fs.existsSync(archive));fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'package-')),extracted=path.join(root,'seed-runtime'),project=path.join(root,'project');
asar.extractAll(archive,extracted);fs.mkdirSync(project);fs.cpSync(path.join(extracted,'node_modules'),path.join(project,'node_modules'),{recursive:true,errorOnExist:true,filter:f=>!/^\.env(?:\.|$)|^\.npmrc$/.test(path.basename(f))});
fs.cpSync(path.join(build,'app'),path.join(project,'app'),{recursive:true,filter:f=>!f.endsWith('.map')});
for(const f of ['package.json','package-lock.json','electron-builder.yml'])fs.copyFileSync(path.join(source,f),path.join(project,f));
for(const f of ['extension','main/ocr/paddle','main/asr/python','resources'])fs.cpSync(path.join(source,f),path.join(project,f),{recursive:true});
// Seed's unpacked whisper tree may be pruned; use the verified build dependency binary, never compile/install.
const whisper='node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/Release';fs.cpSync(path.join(deps,whisper.replace(/^node_modules\//,'')),path.join(project,whisper),{recursive:true});
const electronDist=path.join(deps,'electron/dist'),electronVersion=require(path.join(deps,'electron/package.json')).version;
const args=[path.join(deps,'electron-builder/out/cli/cli.js'),'--dir','--win','--x64','--config.npmRebuild=false','--config.nodeGypRebuild=false','--config.win.signAndEditExecutable=false',`--config.electronVersion=${electronVersion}`,`--config.electronDist=${electronDist}`];
const run=spawnSync(process.execPath,args,{cwd:project,encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:16*1024*1024});fs.writeFileSync(path.join(root,'package.log'),(run.stdout||'')+(run.stderr||''));
const result={root,project,build,executable:path.join(project,'dist/win-unpacked/VANHSUB.exe'),archive:path.join(project,'dist/win-unpacked/resources/app.asar'),seedArchiveSha256:hash(archive),exitCode:run.status,error:run.error?.message,electronVersion,signed:false,installer:false,piperModelBundled:false};
fs.writeFileSync(path.join(parent,'package-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(run.status!==0)process.exitCode=1;
