# Verification and limits

The production run passed 82 mechanics checks and four ordinary-control routes. The checks cover rail limits, latches, balanced and unbalanced loads, moving supports, chutes, stage progression, failure and retry. Run `npm run verify` to rebuild and repeat those checks from this checkout.

The exact included MP4 passed 44 technical checks: 60 seconds, 3,600 decoded frames, constant 60 FPS, progressive 1920 × 1080, Rec.709 colour tags, stereo 48 kHz AAC and a clean full decode. Encoded audio measured −23.19 LUFS and −1.47 dBTP; the source PCM had no clipped samples. Those measurements do not establish listening quality.

The separate replay benchmark counted 2,241 distinct application renders over 60.0115 seconds, averaging 37.33 renders/s. Median frame interval was 33.3 ms, p95 33.5 ms and maximum 400.7 ms. Two intervals exceeded 250 ms. This was a capture-path replay on a Ryzen 7 5800H system with integrated AMD graphics, not a full live-play FPS test.

Six encoded frames were inspected at 0, 9, 21, 31, 43 and 57 seconds. Stage labels, representative mechanisms and the garden ending were visible. These stills do not qualify full motion or sync.

The photographic target remains unmet. The simplified character, repeated cabinetry and dark material response need further work. Full normal-speed motion, end-to-end listening and audiovisual sync remain unreviewed. Human playtesting is also needed to judge difficulty and input comfort.

This repository is a source-sharing copy. Workstation paths, session identifiers and optional author metadata have been removed. Runtime geometry and texture data are preserved; asset metadata checks are recorded separately. The private production audit and its raw capture frames are not presented as a fresh audit of every publication file.
