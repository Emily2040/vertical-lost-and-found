# Editable assets

The main sources are `assets/blender/vertical_lost_and_found.blend` and `assets/blender/railway_hall.blend`. The hero proof scene is included for material inspection.

The builders were used with Blender 5.2. Python material preparation requires Python 3.10+, Pillow and NumPy.

```sh
python -m pip install -r requirements-verification.txt
python scripts/prepare_materials.py --manifest material-sources.json --output-root .
python scripts/validate_materials.py .
blender --background --python-exit-code 1 --python scripts/build_blender_assets.py
blender --background --python-exit-code 1 --python authoring/railway-hall/build_hall.py -- --deliver-root .
```

Material preparation uses the supplied raw images and preserves the existing labels. It does not call an image-generation service. Normal and roughness maps are authored approximations, not measured scans. The hall's procedural materials supplement the generated wood, canvas and felt.

`contract.json` defines units and interfaces. `world.json` stores entities, transforms, material choices and camera/light decisions. `material-sources.json` retains the generation prompts and raw image hashes. Keep glTF material transforms intact when changing the loader.

Asset edits require fresh build and mechanics checks, visual inspection and a new recording where they affect appearance or motion.
