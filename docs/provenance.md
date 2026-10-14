# Material and build provenance

This project was built with Gemini 4 in Google Antigravity, then iterated through geometry, material, runtime and verification revisions. It is not presented as an untouched single-prompt output.

Three fresh native image-generation outputs provide lacquered wood, luggage canvas and felt imagery. The original images are 1024 × 1024; prepared material maps are 2048 × 2048. Resizing does not add native image detail. The exact image backend model ID was not exposed in the generation response.

The generation prompts and raw image hashes are retained in `material-sources.json`. `assets/textures/provenance.json` records material preparation and the preserved label assets. Numeric roughness and normal response were authored separately; these are approximate materials, not measured PBR scans. Architectural textures include procedural supplements.

The parent generation session reached its headless timeout after producing the three saved images. Successful outputs were checked separately from the parent session status. Local session transcripts and machine paths are omitted from this repository.

The Blender source scenes, glTF exports, raw and prepared textures, builders and replay/capture scripts are included. Publication changes to optional metadata are documented in `asset-metadata-review.json`; the original video is retained unchanged.
