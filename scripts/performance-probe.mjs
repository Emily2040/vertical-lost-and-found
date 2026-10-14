import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {
  parseOptions, findProjectRoot, projectRuntime, sourceOverrides as makeOverrides,
  inventory as getInventory, installOverrides, waitForOwnedVite, sha256
} from './runtime-tools.mjs';

const HELP = [
  'Usage: node performance-probe.mjs [--project-root DIR] [--out FILE] [--port 5186]',
  '  [--trace FILE] [--camera-timeline FILE] [--duration 60]',
  '  [--browser-channel chrome|chromium] [--playwright-path DIR]',
  '  [--ui-dir DIR] [--physics-dir DIR] [--data-dir DIR] [--inspect-config]',
  'Measures a 60-second wall-time-paced ordinary route through the capture path.',
  'One application render per distinct own requestAnimationFrame timestamp.',
  'No screenshot, encoder or live audio DSP. This is not full live-play FPS.',
  'The passed field qualifies evidence and earned route completion, with no FPS threshold.'
].join('\n');
const options = parseOptions(process.argv.slice(2),
  ['--project-root','--out','--port','--trace','--camera-timeline','--duration',
   '--browser-channel','--playwright-path','--ui-dir','--physics-dir','--data-dir'],
  ['--help','-h','--inspect-config']);
if (options['--help'] || options['-h']) { console.log(HELP); process.exit(0); }
const root = findProjectRoot(options['--project-root'], import.meta.url);
const out = path.resolve(options['--out'] || path.join(root, 'capture/performance-final.json'));
const port = Number(options['--port'] || 5186);
const duration = Number(options['--duration'] || 60);
if (duration !== 60) throw new Error('This route qualification requires exactly 60 seconds.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
const tracePath = path.resolve(options['--trace'] || path.join(root, 'replays/showcase-ordinary-trace.json'));
const cameraTimelinePath = path.resolve(options['--camera-timeline'] || path.join(root, 'replays/showcase-camera-timeline.json'));
const {chromium, vite, launchOptions} = projectRuntime(root, options);
const sourceOverrides = makeOverrides(root, options);
const captureBuildMode = Object.keys(sourceOverrides).length
  ? 'Vite dev server with explicit staging overrides'
  : 'Frozen production dist served by Vite preview; source and dist are hash-bound; no filesystem watcher or request interception';
const serverMode = Object.keys(sourceOverrides).length ? 'development-staging' : 'production-preview';
const servedRoot = Object.keys(sourceOverrides).length ? 'project-source' : 'dist';
if (options['--inspect-config']) {
  console.log(JSON.stringify({projectRoot:root,out,port,duration,tracePath,cameraTimelinePath,
    sourceOverrides,captureBuildMode,vite,launchOptions}, null, 2));
  process.exit(0);
}
const traceSource = fs.readFileSync(tracePath);
const cameraSource = fs.readFileSync(cameraTimelinePath);
const trace = JSON.parse(traceSource);
const cameraTimeline = JSON.parse(cameraSource);
const traceHash = sha256(traceSource);
const cameraTimelineHash = sha256(cameraSource);
const probeScriptSha256 = sha256(fs.readFileSync(new URL(import.meta.url)));
const runtimeToolsSha256 = sha256(fs.readFileSync(new URL('./runtime-tools.mjs', import.meta.url)));
const inventory = () => Object.fromEntries(Object.entries(getInventory(root, sourceOverrides))
  .map(([logical, item]) => [logical, item.sha256]));
const sourceHashesBefore = inventory();
const servedDistHashes = Object.fromEntries(Object.entries(sourceHashesBefore).filter(([logical])=>logical.startsWith('dist/')));
const errors = [];
let browser, server, report;
const generatedAt = new Date().toISOString();
try {
  const url = 'http://127.0.0.1:' + port + '/';
  server = spawn(process.execPath,
    [vite,...(Object.keys(sourceOverrides).length ? [] : ['preview']),'--host','127.0.0.1','--port',String(port),'--strictPort'],
    {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  await waitForOwnedVite(server, url);
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  await installOverrides(page, sourceOverrides);
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url + '?capture');
  // Timer polling does not introduce another measured animation-frame callback.
  await page.waitForFunction(() => window.ready || window.bootError, null,
    {timeout:120000,polling:100});
  const bootError = await page.evaluate(() => window.bootError);
  if (bootError) throw new Error(bootError);
  await page.evaluate(({trace,cameraTimeline}) => {
    gameController.loadOrdinaryReplayTimeline(trace);
    gameController.loadCaptureCameraTimeline(cameraTimeline);
    renderAt(0);
  }, {trace,cameraTimeline});
  await page.waitForTimeout(1000);
  console.log('Starting 60-second wall-time-paced route measurement');
  const runtime = await page.evaluate(duration => new Promise((resolve,reject) => {
    const controller = gameController;
    const view = controller.view;
    const originalRender = view.render;
    const frames = [];
    let applicationRenderCalls = 0;
    let activeFrame = null;
    let firstRafTimeMs = null;
    let previousRafTimeMs = null;
    let skippedNonDistinctTimestamps = 0;
    let callbackId = null;
    let settled = false;
    const watchdog = setTimeout(() => finish(new Error('Route measurement exceeded 90 seconds of browser wall time')), 90000);

    // Count application renders. WebGLRenderer.render performs multiple passes.
    view.render = function (...args) {
      applicationRenderCalls++;
      if (activeFrame) activeFrame.renderCalls++;
      const start = performance.now();
      try { return originalRender.apply(this, args); }
      finally {
        if (activeFrame) activeFrame.viewRenderCpuDurationMs += performance.now() - start;
      }
    };
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (callbackId !== null) cancelAnimationFrame(callbackId);
      view.render = originalRender;
      if (error) { reject(error); return; }
      const renderer = view.renderer;
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const evidence = controller.getCaptureEvidence();
      resolve({
        timestampsMs:frames.map(frame => frame.rafTimeMs),
        frames,
        renderedFrameCount:frames.length,
        applicationRenderCalls,
        skippedNonDistinctTimestamps,
        measurementStartRafTimeMs:firstRafTimeMs,
        measurementEndRafTimeMs:frames.at(-1).rafTimeMs,
        userAgent:navigator.userAgent,
        gpu:ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
        viewport:[innerWidth,innerHeight],
        drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],
        pixelRatio:renderer.getPixelRatio(),
        contextAttributes:gl.getContextAttributes(),
        cameraMode:view.cameraMode,
        observation:controller.getObservation(),
        finalSimulationTime:controller.sim.time,
        actionLog:evidence.actionLog,
        cameraLog:evidence.cameraLog,
        inputTrace:evidence.inputTrace,
        replayCursor:evidence.replayCursor,
        audioEventCount:evidence.audioEvents.length
      });
    }
    function sample(rafTimeMs) {
      if (settled) return;
      try {
        if (!Number.isFinite(rafTimeMs)) throw new Error('Non-finite rAF timestamp');
        if (previousRafTimeMs !== null && rafTimeMs <= previousRafTimeMs) {
          skippedNonDistinctTimestamps++;
          callbackId = requestAnimationFrame(sample);
          return;
        }
        if (firstRafTimeMs === null) firstRafTimeMs = rafTimeMs;
        const wallElapsedSeconds = (rafTimeMs - firstRafTimeMs) / 1000;
        const rawWallTargetSeconds = Math.min(wallElapsedSeconds, duration);
        // renderAt rounds to the nearest simulation tick and resets on rewind.
        // Floor targets to avoid a short later wall interval rewinding that tick.
        const targetSeconds = Math.floor(rawWallTargetSeconds * 120) / 120;
        const frame = {
          index:frames.length,rafTimeMs,wallElapsedSeconds,rawWallTargetSeconds,targetSeconds,
          renderCalls:0,viewRenderCpuDurationMs:0
        };
        activeFrame = frame;
        frame.renderStartMs = performance.now();
        const observation = renderAt(targetSeconds);
        frame.renderEndMs = performance.now();
        frame.renderAtCpuDurationMs = frame.renderEndMs - frame.renderStartMs;
        activeFrame = null;
        frame.simulationTime = controller.sim.time;
        frame.stage = observation.stage;
        frame.completed = observation.completed;
        frame.cameraMode = view.cameraMode;
        frames.push(frame);
        previousRafTimeMs = rafTimeMs;
        if (rawWallTargetSeconds >= duration) finish();
        else callbackId = requestAnimationFrame(sample);
      } catch (error) {
        activeFrame = null;
        finish(error);
      }
    }
    callbackId = requestAnimationFrame(sample);
  }), duration);
  runtime.browserVersion = await browser.version();
  const intervalsMs = runtime.timestampsMs.slice(1)
    .map((value,index) => value-runtime.timestampsMs[index]);
  const sorted = [...intervalsMs].sort((a,b) => a-b);
  const elapsedMs = runtime.timestampsMs.at(-1)-runtime.timestampsMs[0];
  const statistics = {
    frames:runtime.frames.length,
    elapsedMs,
    meanFps:intervalsMs.length*1000/intervalsMs.reduce((sum,value) => sum+value,0),
    medianMs:sorted[Math.floor(sorted.length*.5)],
    p95Ms:sorted[Math.floor(sorted.length*.95)],
    maxMs:sorted.at(-1),
    intervalsAbove20ms:intervalsMs.filter(value => value>20).length,
    intervalsAbove250ms:intervalsMs.filter(value => value>250).length
  };
  const sourceHashesAfter = inventory();
  const sourcesUnchanged = JSON.stringify(sourceHashesBefore) === JSON.stringify(sourceHashesAfter);
  const inputSourcesUnchanged = traceHash === sha256(fs.readFileSync(tracePath))
    && cameraTimelineHash === sha256(fs.readFileSync(cameraTimelinePath));
  const probeSourcesUnchanged = probeScriptSha256 === sha256(fs.readFileSync(new URL(import.meta.url)))
    && runtimeToolsSha256 === sha256(fs.readFileSync(new URL('./runtime-tools.mjs',import.meta.url)));
  const sampleChecks = {
    distinctTimestamps:runtime.frames.length>=3 && intervalsMs.every(value => Number.isFinite(value)&&value>0),
    oneApplicationRenderPerSample:runtime.renderedFrameCount===runtime.frames.length
      && runtime.applicationRenderCalls===runtime.frames.length
      && runtime.frames.every(frame => frame.renderCalls===1),
    simulationTracksQuantizedWallTime:runtime.frames.every((frame,index) =>
      Math.abs(frame.simulationTime-frame.targetSeconds)<1e-6
      && frame.rawWallTargetSeconds-frame.simulationTime>=-1e-7
      && frame.rawWallTargetSeconds-frame.simulationTime<=1/120+1e-7
      && (!index || frame.simulationTime>=runtime.frames[index-1].simulationTime-1e-8)),
    completeWallWindow:elapsedMs>=60000-1e-5 && Math.abs(runtime.finalSimulationTime-60)<1e-6,
    cpuDurationsValid:runtime.frames.every(frame =>
      Number.isFinite(frame.renderAtCpuDurationMs) && frame.renderAtCpuDurationMs>=0
      && frame.viewRenderCpuDurationMs>=0
      && frame.viewRenderCpuDurationMs<=frame.renderAtCpuDurationMs+1e-6),
    sourcesUnchanged,inputSourcesUnchanged,probeSourcesUnchanged
  };
  for (const [name,pass] of Object.entries(sampleChecks)) if (!pass) errors.push('Measurement check failed: '+name);
  const measurementValid = errors.length===0;
  const expectedReplayEvents = trace.filter(event =>
    (Number.isFinite(event.t) ? event.t : Number(event.tick)/120)<duration-1e-8).length;
  const seenStages = new Set(runtime.frames.map(frame => frame.stage));
  const routeCompleted = [1,2,3].every(stage => seenStages.has(stage))
    && runtime.observation.completed===true && runtime.observation.stage===3
    && runtime.replayCursor>=expectedReplayEvents;
  if (!routeCompleted) errors.push('Ordinary route did not demonstrate all three stages and earned completion');
  const stageStatistics = [1,2,3].map(stage => {
    const deltas = intervalsMs.filter((_,index) => runtime.frames[index+1].stage===stage);
    const ordered = [...deltas].sort((a,b) => a-b);
    return {
      stage,intervalAttribution:'stage of ending frame',
      frames:runtime.frames.filter(frame => frame.stage===stage).length,
      intervalCount:deltas.length,elapsedMs:deltas.reduce((a,b)=>a+b,0),
      meanFps:deltas.length ? deltas.length*1000/deltas.reduce((a,b)=>a+b,0) : null,
      medianMs:ordered[Math.floor(ordered.length*.5)]??null,
      p95Ms:ordered[Math.floor(ordered.length*.95)]??null,
      maxMs:ordered.at(-1)??null,
      intervalsAbove250ms:deltas.filter(value => value>250).length
    };
  });
  report = {
    measurementSchemaVersion:2,
    measurementKind:'wall-time-paced-capture-path-route',
    measurementValid,
    generatedAt,finishedAt:new Date().toISOString(),
    method:'60-second wall-time-paced ordinary-route replay through the application capture path. One explicit renderAt call and one view.render call per distinct own rAF timestamp. Targets are floored to 120 Hz; raw wall time is retained.',
    scope:{
      livePlayFpsMeasured:false,audioDspIncluded:false,screenshotsIncluded:false,encoderIncluded:false,
      gpuCompletionTimingMeasured:false,interactiveInputDeliveryMeasured:false,
      hudRenderingIncluded:true,ordinaryMechanicsIncluded:true,
      liveUpdateMaxDeltaSeconds:.25,capturePathCatchup:'all elapsed fixed simulation steps',
      cpuTimingMeaning:'CPU simulation and render submission work, not GPU completion'
    },
    sourceRoot:root,nodeVersion:process.version,captureBuildMode,serverMode,servedRoot,servedDistHashes,sourceOverrides,duration,
    probeScriptSha256,runtimeToolsSha256,probeSourcesUnchanged,
    tracePath,traceHash,cameraTimelinePath,cameraTimelineHash,inputSourcesUnchanged,
    sourceHashesBefore,sourceHashesAfter,sourcesUnchanged,
    machine:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0]?.model,
      logicalCpus:os.cpus().length,totalRamBytes:os.totalmem(),freeRamBytes:os.freemem()},
    runtime,intervalsMs,statistics,stageStatistics,sampleChecks,
    route:{completed:routeCompleted,expectedReplayEvents,replayCursor:runtime.replayCursor,
      stageTransitions:runtime.frames.filter((frame,index) => !index||frame.stage!==runtime.frames[index-1].stage)
        .map(frame => ({wallElapsedSeconds:frame.wallElapsedSeconds,simulationTime:frame.simulationTime,stage:frame.stage})),
      firstCompletedFrame:runtime.frames.find(frame=>frame.completed)?.index??null},
    errors,
    limitations:[
      'This measures wall-time-paced route replay through the capture path, not full live-play FPS or presented display frames.',
      'Live adapter.update caps each frame delta at250ms; renderAt catches up all elapsed fixed steps. Long intervals therefore differ from live input handling.',
      'Live audio DSP, pointer/keyboard delivery, screenshots and encoding are excluded. Ordinary action dispatch, simulation, camera and HUD rendering are included.',
      'CPU duration records simulation and render submission, not GPU completion.',
      'This is one bounded headless route measurement, not a sustained thermal benchmark. Concurrent machine workloads can affect timing.'
    ],
    passed:measurementValid&&routeCompleted
  };
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({out,passed:report.passed,measurementValid,statistics,route:report.route,errors}));
  if (!report.passed) process.exitCode=1;
} catch (error) {
  errors.push(String(error.stack||error));
  report = {
    measurementSchemaVersion:2,measurementKind:'wall-time-paced-capture-path-route',
    measurementValid:false,passed:false,generatedAt,finishedAt:new Date().toISOString(),
    sourceRoot:root,probeScriptSha256,runtimeToolsSha256,tracePath,traceHash,
    cameraTimelinePath,cameraTimelineHash,sourceHashesBefore,errors
  };
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.error(JSON.stringify({out,passed:false,errors}));
  process.exitCode=1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
