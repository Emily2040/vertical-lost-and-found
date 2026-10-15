# The Vertical Lost & Found

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

https://github.com/user-attachments/assets/b126354c-ce20-4bfc-b07f-9eb815dfc5b7

[Download the original 1080p60 video (MP4, 57 MB)](https://github.com/Emily2040/vertical-lost-and-found/raw/HEAD/showcase-1080p60.mp4)

## Prompt

```text
Build a climbing puzzle across a monumental wall of drawers inside an abandoned railway hall.

Begin with a drawer bursting open beneath me. Its contents roll into a receiving tray, pulling a counterweight that opens the next drawer just in time for my jump.

Let me climb the mechanism while changing its loads. Pull drawers along rails, latch them at visible notches and transfer substantial objects between connected trays. A drawer can become a step, lift or counterweight depending on how I use it.

Fill the wall with recognisable belongings: trunks, rolled carpets, boxed instruments and ceramic parcels. Model rails, rollers, exposed cables and transfer chutes in Blender. Use Nano Banana for handled lacquer, luggage canvas and worn lining.

Stage one builds a staircase from three drawers. Stage two moves one heavy case between linked drawers to raise a lift while preserving a return route. Stage three requires an ascending sequence of load transfers, moving platforms and timed jumps.

Preserve object identity and mass. My weight must affect an unlocked platform, and latches must engage real notches.

Finish by opening the final drawer from inside. Daylight reveals a rooftop garden beyond the colossal storage wall. Capture the complete progression in an energetic one-minute showcase.
```

Expanded build briefs: [English](prompts/en.md) · [简体中文](prompts/zh-CN.md) · [日本語](prompts/ja.md) · [한국어](prompts/ko.md) · [Prompt guide](prompts/README.md).

## Overview

Built with **Gemini 4 in Google Antigravity**, using Nano Banana texture imagery, Blender and Three.js.

A climbing puzzle inside a railway archive. Pull drawers along their rails, lock them into place and move luggage to drive the lifts. Three stages lead from the first drawer to a rooftop garden.

This is a development build shared for review. The mechanics work through the saved routes, but the character, repeated cabinetry and lighting still fall short of the photographic target. Full motion, listening and audiovisual sync review remain unperformed. The project took multiple iterations; a prompt cannot guarantee identical generated assets or results. To run this exact implementation, use the committed source and assets below.

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
