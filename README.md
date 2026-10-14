# The Vertical Lost & Found

[English](README.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

https://github.com/user-attachments/assets/b126354c-ce20-4bfc-b07f-9eb815dfc5b7

[Download the original 1080p60 video](showcase-1080p60.mp4)

Built with **Gemini 4 in Google Antigravity**, using Nano Banana texture imagery, Blender and Three.js.

A climbing puzzle inside a railway archive. Pull drawers along their rails, lock them into place and move luggage to drive the lifts. Three stages lead from the first drawer to a rooftop garden.

This is a development build shared for review. The mechanics work through the saved routes, but the character, repeated cabinetry and lighting still fall short of the photographic target. Full motion, listening and audiovisual sync review remain unperformed.

## Build prompt

Copy the complete prompt in your preferred language: [English](prompts/en.md) · [简体中文](prompts/zh-CN.md) · [한국어](prompts/ko.md) · [日本語](prompts/ja.md).

These are equivalent versions of a consolidated brief for rebuilding the experience with Gemini 4, Nano Banana, Blender and Three.js. The project took multiple iterations; a prompt cannot guarantee identical generated assets or results. To run this exact implementation, use the committed source and assets below. The [prompt guide](prompts/README.md) also includes the original English brief and explains the difference between the visual target and this build.

## Run locally

Use Node.js 20 or newer. No API key is needed to play.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For the production build:

```sh
npm run build
npm run preview
```

## Controls

| Control | Action |
|---|---|
| W A S D | Move |
| Space | Jump |
| Tab / Shift + Tab | Select a reachable mechanism / cargo |
| Q / E | Push / pull the selected rail |
| L | Lock or release a rail notch |
| H | Open or close a cargo hatch |
| F | Pick up, place or dispatch cargo |
| G | Open the final drawer from inside |
| R | Restore the latest checkpoint |

The in-game hints explain the selected target. Sound starts after an interaction and can be muted.

## Verify and edit

```sh
npm run verify
```

This builds the application and runs 77 mechanics checks plus four ordinary-control routes. Generated test evidence goes into `.run/verification/`. Human difficulty testing remains separate.

Editable `.blend` files are in `assets/blender/`. Geometry builders, raw generated textures, material preparation scripts and the persistent scene records are included. See [authoring](docs/authoring.md), [recording](docs/recording.md) and [verification](docs/verification.md).

The one-minute showcase contains 3,600 simulation samples at 1920 × 1080 with stereo audio. It was captured offline through the actual game controls. The separate replay benchmark measured 37.33 renders/s on the tested machine; that is not a full live-play FPS result.

The project uses a constrained character/support controller and analytic mechanisms, with discrete cargo pickup and placement. It is not a general rigid-body simulator.

[Material provenance](docs/provenance.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
