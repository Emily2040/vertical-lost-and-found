#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HELP = `Usage: node verify-capture.mjs FILE.mp4 [--duration SECONDS] [--ffmpeg PATH] [--ffprobe PATH] [--out-dir DIRECTORY]
Default expected duration: 60 seconds. Expected frame count must be an integer at 60 fps.
Executables: command options, then FFMPEG_PATH / FFPROBE_PATH, then PATH.
When ffmpeg is an absolute path, an existing sibling ffprobe is tried before PATH.
Writes FILE.verification.json and FILE.verification.commands.json beside the input,
or in --out-dir when supplied.
Exit 0: technical checks pass. Exit 1: failed checks. Exit 2: usage/input error.
This does not establish visual quality, valid gameplay, smooth scene motion or clean-sounding audio.`;

function options(args) {
  const opt = { duration: 60 };
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (['--duration', '--ffmpeg', '--ffprobe', '--out-dir'].includes(a)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${a}`);
      opt[a.slice(2)] = a === '--duration' ? Number(args[++i]) : args[++i];
    } else if (!a.startsWith('-') && !opt.input) opt.input = path.resolve(a);
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!opt.input) throw new Error('Provide an MP4 input path.');
  if (!Number.isFinite(opt.duration) || opt.duration <= 0 || Math.abs(opt.duration * 60 - Math.round(opt.duration * 60)) > 1e-7)
    throw new Error('--duration must be positive and correspond to an integer number of 60 fps frames.');
  if (!fs.existsSync(opt.input) || !fs.statSync(opt.input).isFile()) throw new Error(`Input file does not exist: ${opt.input}`);
  if (opt['out-dir']) {
    opt['out-dir'] = path.resolve(opt['out-dir']);
    fs.mkdirSync(opt['out-dir'], { recursive: true });
  }
  return opt;
}

let opt;
try { opt = options(process.argv.slice(2)); }
catch (error) { console.error(`${error.message}\n${HELP}`); process.exit(2); }
if (opt.help) { console.log(HELP); process.exit(0); }

const ffmpeg = opt.ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg';
const siblingFfprobe = path.isAbsolute(ffmpeg)
  ? path.join(path.dirname(ffmpeg), path.extname(ffmpeg).toLowerCase() === '.exe' ? 'ffprobe.exe' : 'ffprobe')
  : null;
const executables = {
  ffmpeg,
  ffprobe: opt.ffprobe || process.env.FFPROBE_PATH ||
    (siblingFfprobe && fs.existsSync(siblingFfprobe) ? siblingFfprobe : 'ffprobe')
};
const executable = name => executables[name];
const stem = path.join(opt['out-dir'] || path.dirname(opt.input), path.basename(opt.input, path.extname(opt.input)));
const reportPath = `${stem}.verification.json`;
const logPath = `${stem}.verification.commands.json`;
const commands = [];
const checks = [];
const expectedFrames = Math.round(opt.duration * 60);
const report = {
  schema: 'vertical-lost-and-found.capture-technical-verification.v1',
  generatedAt: new Date().toISOString(), input: opt.input,
  expected: { seconds: opt.duration, frames: expectedFrames, width: 1920, height: 1080, fps: '60/1',
    videoCodec: 'h264', pixelFormat: 'yuv420p', fieldOrder: 'progressive', colour: 'bt709',
    audioCodec: 'aac', audioSampleRate: 48000, audioChannels: 2, maxTruePeakDbtp: -1 },
  boundaries: [
    'Technical inspection only; visual quality, scene motion, gameplay correctness and listening review are unverified.',
    'Constant presentation timing does not prove unique rendered content or real-time capture performance.',
    'Integrated loudness is measured, with no LUFS target imposed. Silence/non-finite measurements fail.',
    'True peak is measured on the decoded source, not on the loudnorm filter output.'
  ],
  commandLog: logPath, checks, measurements: {}, passed: false
};

const check = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });
const number = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const close = (a, b, tolerance) => a !== null && Number.isFinite(a) && Math.abs(a - b) <= tolerance;
function rational(value) {
  const [a, b] = String(value || '').split('/').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null;
}
function run(name, exe, args) {
  const started = Date.now();
  const result = spawnSync(exe, args, { shell: false, windowsHide: true, encoding: 'utf8',
    timeout: Math.max(120000, opt.duration * 2000), maxBuffer: 128 * 1024 * 1024 });
  const record = { name, executable: exe, args, exitCode: result.status, signal: result.signal,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    elapsedMs: Date.now() - started, stdout: result.stdout || '', stderr: result.stderr || '' };
  commands.push(record);
  check(`command.${name}`, result.status === 0 && !result.error,
    { exitCode: result.status, signal: result.signal, error: record.error, commandLogEntry: commands.length - 1 });
  return record;
}
function probe(name, args) {
  const result = run(name, executable('ffprobe'), ['-v', 'error', ...args, '-of', 'json', opt.input]);
  check(`${name}.no_probe_errors`, result.stderr.trim() === '', { stderr: result.stderr });
  try { return JSON.parse(result.stdout); }
  catch (error) { check(`${name}.json`, false, error.message); return {}; }
}
const timestamp = frame => number(frame.best_effort_timestamp_time) ?? number(frame.pts_time);
const duration = frame => number(frame.duration_time) ?? number(frame.pkt_duration_time);
function describeTiming(frames, tolerance, expectedStep = null) {
  const pts = frames.map(timestamp);
  const durations = frames.map(duration);
  const stepErrors = [];
  const gapErrors = [];
  let maxStepError = 0;
  let minDelta = Infinity;
  let maxDelta = -Infinity;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i] === null || pts[i - 1] === null) { stepErrors.push(i); continue; }
    const delta = pts[i] - pts[i - 1];
    minDelta = Math.min(minDelta, delta); maxDelta = Math.max(maxDelta, delta);
    if (expectedStep !== null) {
      const error = Math.abs(delta - expectedStep);
      maxStepError = Math.max(maxStepError, error);
      if (error > tolerance || delta <= 0) stepErrors.push(i);
    } else if (delta <= 0) stepErrors.push(i);
    if (durations[i - 1] === null || Math.abs(delta - durations[i - 1]) > tolerance) gapErrors.push(i);
  }
  return {
    frameCount: frames.length, timestampCount: pts.filter(x => x !== null).length,
    durationCount: durations.filter(x => x !== null && x > 0).length,
    firstPts: pts[0] ?? null, lastPts: pts.at(-1) ?? null,
    lastDuration: durations.at(-1) ?? null,
    endPts: pts.at(-1) !== null && durations.at(-1) !== null && pts.length ? pts.at(-1) + durations.at(-1) : null,
    minDelta: Number.isFinite(minDelta) ? minDelta : null,
    maxDelta: Number.isFinite(maxDelta) ? maxDelta : null,
    maxStepError, stepErrorCount: stepErrors.length, firstStepErrorFrames: stepErrors.slice(0, 20),
    gapErrorCount: gapErrors.length, firstGapErrorFrames: gapErrors.slice(0, 20), tolerance
  };
}

try {
  const initialStat = fs.statSync(opt.input);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(opt.input)) hash.update(chunk);
  report.inputEvidence = { bytes: initialStat.size, modifiedAt: initialStat.mtime.toISOString(), sha256: hash.digest('hex') };
  check('input.non_empty', initialStat.size > 0, initialStat.size);
  check('input.mp4_extension', path.extname(opt.input).toLowerCase() === '.mp4', path.extname(opt.input));
  for (const name of ['ffmpeg', 'ffprobe']) {
    const version = run(`${name}_version`, executable(name), ['-version']);
    report.measurements[`${name}Version`] = version.stdout.split(/\r?\n/)[0];
  }
  const metadata = probe('metadata', ['-count_frames', '-show_streams', '-show_format']);
  const videoStreams = (metadata.streams || []).filter(s => s.codec_type === 'video');
  const audioStreams = (metadata.streams || []).filter(s => s.codec_type === 'audio');
  const video = videoStreams[0] || {};
  const audio = audioStreams[0] || {};
  report.measurements.streams = metadata.streams || [];
  report.measurements.format = metadata.format || {};
  check('container.mp4_family', String(metadata.format?.format_name || '').split(',').includes('mp4'), metadata.format?.format_name);
  check('streams.one_video_one_audio', videoStreams.length === 1 && audioStreams.length === 1,
    { video: videoStreams.length, audio: audioStreams.length });
  check('video.dimensions', video.width === 1920 && video.height === 1080, { width: video.width, height: video.height });
  check('video.codec', video.codec_name === 'h264', video.codec_name);
  check('video.pixel_format', video.pix_fmt === 'yuv420p', video.pix_fmt);
  check('video.progressive_metadata', video.field_order === 'progressive', video.field_order);
  check('video.rate_metadata', video.r_frame_rate === '60/1' && video.avg_frame_rate === '60/1',
    { r_frame_rate: video.r_frame_rate, avg_frame_rate: video.avg_frame_rate });
  check('video.rec709_tags', video.color_space === 'bt709' && video.color_transfer === 'bt709' && video.color_primaries === 'bt709',
    { matrix: video.color_space, transfer: video.color_transfer, primaries: video.color_primaries, range: video.color_range });
  check('audio.codec', audio.codec_name === 'aac', audio.codec_name);
  check('audio.sample_rate', Number(audio.sample_rate) === 48000, audio.sample_rate);
  check('audio.stereo', audio.channels === 2 && audio.channel_layout === 'stereo',
    { channels: audio.channels, layout: audio.channel_layout });

  const vf = probe('video_frames', ['-select_streams', 'v:0', '-show_frames', '-show_entries',
    'frame=pts_time,best_effort_timestamp_time,duration_time,pkt_duration_time,interlaced_frame,width,height,pix_fmt']).frames || [];
  const videoTick = rational(video.time_base);
  // Half a time-base tick bounds rounding onto the intended timeline. Also
  // compare every absolute PTS below, so small local errors cannot accumulate.
  const vt = Math.max(videoTick && videoTick > 0 ? videoTick / 2 : 0, 0.000002);
  check('video.usable_time_base', videoTick !== null && videoTick > 0 && videoTick <= 1 / 60, video.time_base);
  const timing = describeTiming(vf, vt, 1 / 60);
  report.measurements.videoTiming = timing;
  check('video.decoded_frame_count', vf.length === expectedFrames && number(video.nb_read_frames) === expectedFrames,
    { expected: expectedFrames, decodedFrames: vf.length, nbReadFrames: video.nb_read_frames, metadataNbFrames: video.nb_frames });
  check('video.every_frame_progressive', vf.length > 0 && vf.every(f => f.interlaced_frame === 0),
    { interlacedOrUnknown: vf.filter(f => f.interlaced_frame !== 0).length });
  check('video.every_frame_format', vf.length > 0 && vf.every(f => f.width === 1920 && f.height === 1080 && f.pix_fmt === 'yuv420p'),
    { mismatches: vf.filter(f => f.width !== 1920 || f.height !== 1080 || f.pix_fmt !== 'yuv420p').length });
  check('video.constant_frame_timing', vf.length > 0 && timing.timestampCount === vf.length && timing.durationCount === vf.length &&
    timing.stepErrorCount === 0 && timing.gapErrorCount === 0 && vf.every(f => close(duration(f), 1 / 60, vt)), timing);
  const offGridFrames = vf.map((f, i) => close(timestamp(f), i / 60, vt) ? null : i).filter(i => i !== null);
  check('video.absolute_frame_timeline', vf.length > 0 && offGridFrames.length === 0,
    { offGridFrameCount: offGridFrames.length, firstOffGridFrames: offGridFrames.slice(0, 20), tolerance: vt });
  check('video.timestamp_endpoints', close(timing.firstPts, 0, vt) && close(timing.lastPts, (expectedFrames - 1) / 60, vt) && close(timing.endPts, opt.duration, vt),
    { first: timing.firstPts, last: timing.lastPts, end: timing.endPts, expectedEnd: opt.duration, tolerance: vt });
  check('video.stream_duration', close(number(video.duration), opt.duration, vt), { actual: video.duration, expected: opt.duration, tolerance: vt });
  check('video.stream_start', close(number(video.start_time), 0, vt), { actual: video.start_time, tolerance: vt });

  const af = probe('audio_frames', ['-select_streams', 'a:0', '-show_frames', '-show_entries',
    'frame=pts_time,best_effort_timestamp_time,duration_time,pkt_duration_time,nb_samples']).frames || [];
  const at = 1 / 48000 + 0.000002;
  const paddingTolerance = 1024 / 48000 + at;
  const audioTiming = describeTiming(af, at);
  const decodedSamples = af.reduce((sum, f) => sum + (number(f.nb_samples) || 0), 0);
  report.measurements.audioTiming = { ...audioTiming, decodedSamples, decodedSampleSeconds: decodedSamples / 48000, paddingTolerance };
  check('audio.decoded_frames', af.length > 0 && number(audio.nb_read_frames) === af.length && af.every(f => number(f.nb_samples) > 0),
    { decodedFrames: af.length, nbReadFrames: audio.nb_read_frames, decodedSamples });
  check('audio.contiguous_timestamps', af.length > 0 && audioTiming.timestampCount === af.length && audioTiming.durationCount === af.length &&
    audioTiming.stepErrorCount === 0 && audioTiming.gapErrorCount === 0, audioTiming);
  check('audio.timestamp_endpoints', close(audioTiming.firstPts, 0, at) && audioTiming.endPts !== null &&
    audioTiming.endPts >= opt.duration - at && audioTiming.endPts <= opt.duration + paddingTolerance,
    { first: audioTiming.firstPts, end: audioTiming.endPts, expectedEnd: opt.duration, paddingTolerance });
  check('audio.decoded_sample_duration', decodedSamples / 48000 >= opt.duration - at && decodedSamples / 48000 <= opt.duration + paddingTolerance,
    { decodedSampleSeconds: decodedSamples / 48000, expected: opt.duration, paddingTolerance });
  check('audio.stream_duration', close(number(audio.duration), opt.duration, paddingTolerance),
    { actual: audio.duration, expected: opt.duration, paddingTolerance });
  check('audio.stream_start', close(number(audio.start_time), 0, at), { actual: audio.start_time, tolerance: at });
  check('container.duration', close(number(metadata.format?.duration), opt.duration, paddingTolerance),
    { actual: metadata.format?.duration, expected: opt.duration, paddingTolerance });
  check('container.start', close(number(metadata.format?.start_time), 0, Math.max(vt, at)), metadata.format?.start_time);

  const decode = run('clean_decode', executable('ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode',
    '-i', opt.input, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  check('decode.no_errors', decode.exitCode === 0 && decode.stderr.trim() === '', { exitCode: decode.exitCode, stderr: decode.stderr });
  const loudness = run('source_loudness', executable('ffmpeg'), ['-hide_banner', '-nostdin', '-nostats', '-i', opt.input,
    '-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']);
  const loudnessBlocks = [...loudness.stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
  let sourceLoudness = null;
  if (loudnessBlocks.length) {
    try { sourceLoudness = JSON.parse(loudnessBlocks.at(-1)[0]); } catch { /* explicit failed check below */ }
  }
  const integratedLufs = number(sourceLoudness?.input_i);
  const truePeakDbtp = number(sourceLoudness?.input_tp);
  report.measurements.sourceLoudness = { integratedLufs, truePeakDbtp, rawMeasurement: sourceLoudness };
  check('audio.finite_loudness', integratedLufs !== null && truePeakDbtp !== null, { integratedLufs, truePeakDbtp });
  check('audio.true_peak_ceiling', truePeakDbtp !== null && truePeakDbtp <= -1, { actualDbtp: truePeakDbtp, maximumDbtp: -1 });
  const finalStat = fs.statSync(opt.input);
  check('input.unchanged_during_verification', initialStat.size === finalStat.size && initialStat.mtimeMs === finalStat.mtimeMs,
    { initialBytes: initialStat.size, finalBytes: finalStat.size, initialMtimeMs: initialStat.mtimeMs, finalMtimeMs: finalStat.mtimeMs });
} catch (error) {
  check('verifier.completed', false, { message: error.message, stack: error.stack });
}

report.passed = checks.length > 0 && checks.every(c => c.pass);
report.failedChecks = checks.filter(c => !c.pass).map(c => c.id);
report.finishedAt = new Date().toISOString();
fs.writeFileSync(logPath, JSON.stringify({ schema: 'capture-command-log.v1', input: opt.input, commands }, null, 2) + '\n');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, failedChecks: report.failedChecks, report: reportPath, commandLog: logPath }, null, 2));
process.exitCode = report.passed ? 0 : 1;
