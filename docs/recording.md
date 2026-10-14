# Record the application

The included `showcase-1080p60.mp4` is the original 60-second recording. It has 3,600 progressive 1920 × 1080 frames at constant 60 FPS, H.264/yuv420p/Rec.709 picture and stereo 48 kHz AAC audio.

SHA-256: `711304524056e081327fad794ca02be4bfe617888848d93df4b89f01512f2b7c`.

The camera starts with the drawer catch, follows the load transfers and hardest ascent, then finishes at the garden. Stage two begins at 18.300 seconds, stage three at 29.433 seconds and earned completion at 48.317 seconds. The garden camera cue follows at 51 seconds.

## Reproduce a capture

Install FFmpeg/ffprobe and Chrome, or install Playwright Chromium and pass `--browser-channel chromium`. Use `--ffmpeg` with an executable path if FFmpeg is not on PATH.

```sh
npm run build
node scripts/capture.mjs --trace replays/showcase-ordinary-trace.json --camera-timeline replays/showcase-camera-timeline.json --duration 3 --out capture-test
```

Inspect that short picture-and-audio qualification before a full run. A full recording requires an approval JSON file. For a candidate with known visual gaps, its fields are `mechanicsApproved: true`, `visualReviewed: true`, `candidateCaptureApproved: true`, `visualApproved: false`, plus a nonempty `knownVisualGaps` array. These fields record an actual review decision; they must not be used to skip review.

```sh
node scripts/capture.mjs --trace replays/showcase-ordinary-trace.json --camera-timeline replays/showcase-camera-timeline.json --duration 60 --out capture-full --approval-file approved-capture.json
node scripts/verify-capture.mjs capture-full/showcase-1080p60.mp4 --duration 60
node scripts/performance-probe.mjs --out .run/performance.json
```

Capture serves the production build through Vite preview. Each output directory must be new and empty. Keep runtime sources and assets unchanged during recording. Run the performance probe separately from capture, encoding and other rendering work.

Offline capture advances the real application at defined simulation times and renders its original audio. It does not duplicate low-frame-rate footage or prove real-time 60 FPS. The performance probe measures wall-time-paced replay through the capture path, excluding live audio synthesis and interactive input delivery.

The original raw frames and local session transcripts are not included in this source repository. The exact MP4, replay inputs and capture scripts are included. Full motion, listening and event-level audiovisual sync remain unreviewed.
