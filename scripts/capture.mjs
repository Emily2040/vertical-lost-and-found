import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {parseOptions,findProjectRoot,projectRuntime,sourceOverrides as makeOverrides,inventory as getInventory,installOverrides,waitForOwnedVite,evaluateCaptureApproval,sha256 as hash} from './runtime-tools.mjs';
const HELP=`Usage: node capture.mjs --trace FILE [--project-root DIR] [--duration 60] [--out DIR]
  [--camera-timeline FILE] [--approval-file FILE] [--port 5187]
  [--ffmpeg PATH] [--browser-channel chrome|chromium] [--playwright-path DIR]
  [--ui-dir DIR] [--physics-dir DIR] [--data-dir DIR] [--inspect-config]
Defaults to frozen production dist served by Vite preview, with source and dist hash binding and no filesystem watcher.
Staged overrides require explicit flags. Full captures longer than five seconds require the root's gate file.
Accepted showcase or explicitly reviewed candidate capture are separate approval paths; a candidate records known visual gaps and never grants final delivery approval.
Output: showcase-1080p60.mp4 for longer captures, qualification-1080p60.mp4 for short tests.
This is offline 60 Hz simulation capture, not evidence of real-time 60 FPS performance.`;
const options=parseOptions(process.argv.slice(2),['--project-root','--trace','--duration','--out','--camera-timeline','--approval-file','--port','--ffmpeg','--browser-channel','--playwright-path','--ui-dir','--physics-dir','--data-dir'],['--help','-h','--inspect-config']);
if(options['--help']||options['-h']){console.log(HELP);process.exit(0);}
const opt=(key,fallback)=>options[key]??fallback;
const root=findProjectRoot(options['--project-root'],import.meta.url);
const duration=Number(opt('--duration','60'));
const port=Number(opt('--port','5187'));
const out=path.resolve(opt('--out',root+'/renders/'+(duration>5?'showcase':'qualification')));
if(!options['--trace'])throw new Error('Supply --trace with the ordinary input trace to capture.');
const tracePath=path.resolve(options['--trace']);
const sourceOverrides=makeOverrides(root,options);
const staged=Object.keys(sourceOverrides).length>0;
const serverMode=staged?'development-staging':'production-preview';
const servedRoot=staged?'project-source':'dist';
const captureBuildMode=staged?'Vite dev server with explicit staged source overrides; dist is inventoried but not served':'Frozen production dist served by Vite preview; no filesystem watcher or request interception; source and served dist are inventoried';
const ffmpeg=opt('--ffmpeg',process.env.FFMPEG_PATH||'ffmpeg');
const {chromium,vite,launchOptions}=projectRuntime(root,options);
const serverArgs=[vite,...(staged?[]:['preview']),'--host','127.0.0.1','--port',String(port),'--strictPort'];
const fps=60,frames=Math.round(duration*fps);
if(!Number.isFinite(duration)||duration<=0||Math.abs(frames/fps-duration)>1e-9)throw new Error('Duration must be a positive multiple of 1/60 s');
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid --port');
if(options['--inspect-config']){console.log(JSON.stringify({projectRoot:root,out,tracePath,duration,fps,frames,sourceOverrides,captureBuildMode,serverMode,servedRoot,serverArgs,vite,launchOptions,ffmpeg,fullCaptureRequiresApproval:duration>5},null,2));process.exit(0);}
if(!staged&&!fs.existsSync(path.join(root,'dist/index.html')))throw new Error('Frozen production dist is missing. Build before capture.');
if(fs.existsSync(out)&&fs.readdirSync(out).length)throw new Error('Capture output directory is not empty. Preserve the previous attempt and choose a fresh output directory.');
const captureAttemptId=randomUUID();
const attempt={captureSchemaVersion:2,captureAttemptId,captureStatus:'starting',startedAt:new Date().toISOString(),serverMode,servedRoot,sourceOverrides,outputDirectoryInitiallyEmpty:true,resumed:false,nodePid:process.pid};
let approvalSource=null;
let captureApproval={purpose:'technical-qualification',status:'short-qualification',visualTargetPassed:null,knownVisualGaps:[],finalDeliveryApproved:false};
if(duration>5){
  const approvalFile=opt('--approval-file','');
  if(!approvalFile||!fs.existsSync(approvalFile))throw new Error('Full capture is blocked until root authorises an accepted showcase or reviewed candidate');
  approvalSource=fs.readFileSync(approvalFile);
  const gates=JSON.parse(approvalSource);
  captureApproval=evaluateCaptureApproval(gates);
}
const ffmpegVersion=spawnSync(ffmpeg,['-version'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024});
if(ffmpegVersion.status!==0)throw new Error('FFmpeg is unavailable. Supply --ffmpeg or install it on PATH.');
const traceSource=fs.readFileSync(tracePath);
const trace=JSON.parse(traceSource);
const cameraPath=opt('--camera-timeline','');
const cameraTimeline=cameraPath?JSON.parse(fs.readFileSync(cameraPath)):[{t:0,mode:'follow'}];
fs.mkdirSync(out+'/frames',{recursive:true});
const write=(name,value)=>fs.writeFileSync(out+'/'+name,JSON.stringify(value,null,2));
write('attempt.json',attempt);
fs.writeFileSync(out+'/input-trace-source.json',traceSource);
const captureScriptSource=fs.readFileSync(new URL(import.meta.url));
fs.writeFileSync(out+'/capture-script.mjs',captureScriptSource);
const runtimeToolsSource=fs.readFileSync(new URL('./runtime-tools.mjs',import.meta.url));
fs.writeFileSync(out+'/runtime-tools.mjs',runtimeToolsSource);
if(approvalSource)fs.writeFileSync(out+'/root-gates.json',approvalSource);
write('camera-timeline.json',cameraTimeline);
const inventory=()=>getInventory(root,sourceOverrides);
const inventoryBefore=inventory();write('capture-inventory-before.json',inventoryBefore);
const servedDistHashes=Object.fromEntries(Object.entries(inventoryBefore).filter(([logical])=>logical.startsWith('dist/')).map(([logical,entry])=>[logical,entry.sha256]));
const sourceHashesBefore=Object.fromEntries(Object.values(inventoryBefore).map(entry=>[entry.path,entry.sha256]));
const outputFile=out+(duration>5?'/showcase-1080p60.mp4':'/qualification-1080p60.mp4');
let server,browser;
const errors=[],frameEvidence=[];
async function withDeadline(promise,label,timeoutMs=60000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' exceeded '+timeoutMs+' ms')),timeoutMs);})]);}finally{clearTimeout(timer);}}
try{
  server=spawn(process.execPath,serverArgs,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  attempt.serverPid=server.pid;write('attempt.json',attempt);
  const serverLog=fs.createWriteStream(out+'/vite.log');server.stdout.pipe(serverLog);server.stderr.pipe(serverLog);
  await waitForOwnedVite(server,`http://127.0.0.1:${port}/`);
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const cdp=await page.context().newCDPSession(page);
  page.on('pageerror',e=>errors.push(String(e)));
  await installOverrides(page,sourceOverrides);
  await page.goto(`http://127.0.0.1:${port}/?capture`);
  await page.waitForFunction(()=>window.ready||window.bootError,null,{timeout:120000});
  const bootError=await page.evaluate(()=>window.bootError);if(bootError)throw new Error(bootError);
  await page.evaluate(({trace,cameraTimeline})=>{gameController.loadOrdinaryReplayTimeline(trace);gameController.loadCaptureCameraTimeline(cameraTimeline);},{trace,cameraTimeline});
  const browserInfo=await page.evaluate(()=>{const gl=gameController.view.renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',dpr:devicePixelRatio,viewport:[innerWidth,innerHeight]};});
  const captureStarted=performance.now();
  for(let i=0;i<frames;i++){
    if(server.exitCode!==null)throw new Error('Owned capture server exited with code '+server.exitCode);
    const start=performance.now();const {observation,simulationTime}=await withDeadline(page.evaluate(t=>({observation:renderAt(t),simulationTime:gameController.sim.time}),i/fps),'Simulation frame '+i);
    if(!Number.isFinite(simulationTime)||Math.abs(simulationTime-i/fps)>1e-8||Math.round(simulationTime*120)!==i*2)throw new Error(`Simulation cadence mismatch at frame ${i}: ${simulationTime}`);
    const png=Buffer.from((await withDeadline(cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,optimizeForSpeed:true,fromSurface:true}),'Screenshot frame '+i)).data,'base64');
    fs.writeFileSync(out+`/frames/${String(i).padStart(6,'0')}.png`,png);
    frameEvidence.push({captureAttemptId,index:i,sampleTime:i/fps,simulationTime,simulationTick:Math.round(simulationTime*120),stage:observation.stage,completed:observation.completed,player:observation.player,sha256:hash(png),captureWallMs:performance.now()-start});
    fs.appendFileSync(out+'/frame-samples.ndjson',JSON.stringify(frameEvidence.at(-1))+'\n');
    if(i%60===0)console.log(`Captured ${i}/${frames} samples`);
  }
  // Advance the final half-open video interval so audio events up to duration are retained.
  await page.evaluate(t=>renderAt(t),duration);
  const evidence=await page.evaluate(()=>gameController.getCaptureEvidence());
  const wav=await page.evaluate(async seconds=>{
    const buffer=await gameController.audio.renderOffline(seconds);
    if(buffer.sampleRate!==48000||buffer.numberOfChannels!==2||buffer.length!==Math.round(seconds*48000))throw new Error(`Unexpected offline audio format: ${buffer.sampleRate} Hz, ${buffer.numberOfChannels} channels, ${buffer.length} samples`);
    const count=buffer.length,channels=buffer.numberOfChannels,bytes=new ArrayBuffer(44+count*channels*2),dv=new DataView(bytes);
    const text=(offset,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(offset+i,s.charCodeAt(i));};
    text(0,'RIFF');dv.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,channels,true);dv.setUint32(24,48000,true);dv.setUint32(28,48000*channels*2,true);dv.setUint16(32,channels*2,true);dv.setUint16(34,16,true);text(36,'data');dv.setUint32(40,count*channels*2,true);
    let peak=0,clipped=0;const data=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));
    for(let i=0;i<count;i++)for(let c=0;c<channels;c++){const sample=data[c][i];if(!Number.isFinite(sample))throw new Error(`Non-finite audio sample at ${i}, channel ${c}`);peak=Math.max(peak,Math.abs(sample));if(Math.abs(sample)>1)clipped++;dv.setInt16(44+(i*channels+c)*2,Math.round(Math.max(-1,Math.min(1,sample))*32767),true);}
    let binary='';const u8=new Uint8Array(bytes);for(let i=0;i<u8.length;i+=32768)binary+=String.fromCharCode(...u8.subarray(i,i+32768));
    return {base64:btoa(binary),sampleFrames:count,channels,sampleRate:48000,peak,clipped};
  },duration);
  fs.writeFileSync(out+'/application-audio.wav',Buffer.from(wav.base64,'base64'));delete wav.base64;
  const inventoryAfter=inventory();write('capture-inventory-after.json',inventoryAfter);
  const sourceHashes=Object.fromEntries(Object.values(inventoryAfter).map(entry=>[entry.path,entry.sha256]));
  const sourcesUnchanged=JSON.stringify(sourceHashes)===JSON.stringify(sourceHashesBefore)&&JSON.stringify(inventoryBefore)===JSON.stringify(inventoryAfter);
  const featureTimestamps={stageTransitions:frameEvidence.filter((f,i)=>i===0||f.stage!==frameEvidence[i-1].stage).map(f=>({t:f.sampleTime,stage:f.stage})),successfulActions:evidence.actionLog.filter(a=>a.result?.ok).map(a=>({t:a.t,action:a.action,params:a.params})),completion:frameEvidence.find(f=>f.completed)?.sampleTime??null};
  const manifest={...attempt,captureStatus:'encoding',capturedFrameCount:frameEvidence.length,servedDistHashes,method:'Deterministic offline capture of the actual application at 60 simulation samples/second; not a real-time performance benchmark',projectRoot:root,captureApproval,nodeVersion:process.version,ffmpegVersion:ffmpegVersion.stdout.split(/\r?\n/)[0],captureBuildMode,sourceOverrides,duration,fps,frames,browserInfo,captureWallSeconds:(performance.now()-captureStarted)/1000,sourceHashes,sourceHashesBefore,sourcesUnchanged,inventoryBefore:{path:out+'/capture-inventory-before.json',sha256:hash(fs.readFileSync(out+'/capture-inventory-before.json'))},inventoryAfter:{path:out+'/capture-inventory-after.json',sha256:hash(fs.readFileSync(out+'/capture-inventory-after.json'))},tracePath:out+'/input-trace-source.json',originalTracePath:tracePath,traceHash:hash(traceSource),captureScript:{path:out+'/capture-script.mjs',sha256:hash(captureScriptSource)},runtimeTools:{path:out+'/runtime-tools.mjs',sha256:hash(runtimeToolsSource)},approval:approvalSource?{path:out+'/root-gates.json',sha256:hash(approvalSource)}:null,cameraTimeline:{path:out+'/camera-timeline.json',sha256:hash(fs.readFileSync(out+'/camera-timeline.json'))},audio:wav,evidence,featureTimestamps,errors,uniqueFrameHashes:new Set(frameEvidence.map(f=>f.sha256)).size,frameInterval:{firstSample:frameEvidence[0]?.sampleTime,lastSample:frameEvidence.at(-1)?.sampleTime,finalSimulationTime:await page.evaluate(()=>gameState.time)},realTimePerformance:'unmeasured',motionReview:'unreviewed',listeningReview:'unreviewed'};
  write('capture-evidence.json',manifest);
  write('frame-samples.json',frameEvidence);write('replayed-input.json',trace);
  if(errors.length)throw new Error('Browser errors occurred; inspect capture evidence');
  if(!sourcesUnchanged)throw new Error('Source changed during capture; recapture the approved revision');
  if(wav.clipped)throw new Error('Offline synth clipped; refusing encode');
  const filter='scale=in_range=full:out_range=full:out_color_matrix=bt709,format=yuv444p,colorspace=ispace=bt709:iprimaries=bt709:itrc=srgb:irange=pc:space=bt709:primaries=bt709:trc=bt709:range=tv:format=yuv420p';
  const command=['-y','-hide_banner','-framerate','60','-start_number','0','-i',out+'/frames/%06d.png','-i',out+'/application-audio.wav','-map','0:v:0','-map','1:a:0','-vf',filter,'-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-fps_mode','cfr','-video_track_timescale','60000','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-t',String(duration),'-movflags','+faststart',outputFile];
  write('encode-command.json',{executable:ffmpeg,args:command,colorInterpretation:'Browser PNG is full-range sRGB with BT.709 primaries. Scale explicitly converts RGB into full-range BT.709 YUV; colorspace converts sRGB transfer to BT.709 transfer and limited-range yuv420p.'});
  const encoded=spawnSync(ffmpeg,command,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});fs.writeFileSync(out+'/encode.log',(encoded.stdout||'')+(encoded.stderr||''));if(encoded.status!==0)throw new Error('FFmpeg encode failed; inspect encode.log');
  manifest.video={path:outputFile,sha256:hash(fs.readFileSync(outputFile)),bytes:fs.statSync(outputFile).size};manifest.captureStatus='complete';manifest.finishedAt=new Date().toISOString();write('capture-evidence.json',manifest);write('attempt.json',{...attempt,captureStatus:'complete',capturedFrameCount:frameEvidence.length,finishedAt:manifest.finishedAt,video:manifest.video});
  console.log(JSON.stringify({output:outputFile,frames,audio:wav,browserErrors:errors}));
}catch(error){write('attempt.json',{...attempt,captureStatus:'failed',capturedFrameCount:frameEvidence.length,error:String(error.stack||error),failedAt:new Date().toISOString()});throw error;}finally{if(browser)await browser.close();if(server)server.kill();}
