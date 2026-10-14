"""Portable material preparation. Generated colour and authored numeric maps stay distinct.

Requires Python 3.10+, Pillow and NumPy. No API calls, source overwrites or implicit model claims.
Run: python prepare_materials.py --manifest sources.json --output-root production
"""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

SPEC = {
    "handled_lacquer": {"material_slot": "mat_handled_lacquer", "tile_m": 0.5,
                        "roughness": 0.34, "roughness_range": [0.28, 0.40],
                        "max_slope": 0.12, "seed": 204101,
                        "mesh_ids": ["mesh_hero_drawer", "mesh_garden_drawer", "mesh_transfer_chute"]},
    "luggage_canvas": {"material_slot": "mat_luggage_canvas", "tile_m": 0.10,
                       "roughness": 0.80, "roughness_range": [0.75, 0.86],
                       "max_slope": 0.10, "seed": 204102,
                       "mesh_ids": ["mesh_steamer_trunk", "mesh_rolled_carpet", "mesh_ceramic_parcel", "mesh_rolling_parcel", "mesh_umbrella_case", "mesh_boxed_instruments"]},
    "worn_lining": {"material_slot": "mat_worn_lining", "tile_m": 0.25,
                    "roughness": 0.91, "roughness_range": [0.86, 0.96],
                    "max_slope": 0.16, "seed": 204103,
                    "mesh_ids": ["mesh_hero_drawer", "mesh_garden_drawer", "mesh_load_cage"]},
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def periodic_component(a):
    """Periodic-plus-smooth boundary correction, independently per RGB channel.

    Removes only the smooth field induced by opposite boundary differences.
    It is documented image preparation, not inferred lighting or relighting.
    """
    h, w = a.shape[:2]
    boundary = np.zeros_like(a, dtype=np.float64)
    boundary[0] = a[-1] - a[0]
    boundary[-1] = -boundary[0]
    boundary[:, 0] += a[:, -1] - a[:, 0]
    boundary[:, -1] -= a[:, -1] - a[:, 0]
    denom = 2*np.cos(2*np.pi*np.arange(h)[:, None]/h) + 2*np.cos(2*np.pi*np.arange(w)[None, :]/w) - 4
    denom[0, 0] = 1
    field = np.fft.fft2(boundary, axes=(0, 1)) / denom[:, :, None]
    field[0, 0] = 0
    smooth = np.fft.ifft2(field, axes=(0, 1)).real
    return np.clip(a - smooth, 0, 1)


def filtered_noise(rng, n, sigma_x_px, sigma_y_px=None):
    """Periodic filtered stochastic field with unit standard deviation."""
    sy = sigma_x_px if sigma_y_px is None else sigma_y_px
    fx = np.fft.rfftfreq(n)[None, :]
    fy = np.fft.fftfreq(n)[:, None]
    kernel = np.exp(-2*np.pi*np.pi*(sigma_x_px**2*fx**2 + sy**2*fy**2))
    noise = np.fft.irfft2(np.fft.rfft2(rng.normal(size=(n, n))) * kernel, s=(n, n))
    return (noise / max(float(noise.std()), 1e-10)).astype(np.float32)


def suppress_broad_colour_variation(a, sigma_px, strength):
    """Reduce low spatial frequency tile patches in linear RGB, preserving fine colour contrast."""
    linear=np.where(a<=0.04045,a/12.92,((a+0.055)/1.055)**2.4)
    h,w=a.shape[:2]
    fx=np.fft.rfftfreq(w)[None,:];fy=np.fft.fftfreq(h)[:,None]
    kernel=np.exp(-2*np.pi*np.pi*sigma_px*sigma_px*(fx*fx+fy*fy))
    low=np.fft.irfft2(np.fft.rfft2(linear,axes=(0,1))*kernel[:,:,None],s=(h,w),axes=(0,1)).real
    mean=linear.mean(axis=(0,1),keepdims=True)
    corrected=linear*(mean/np.maximum(low,0.0001))**strength
    corrected*=mean/np.maximum(corrected.mean(axis=(0,1),keepdims=True),0.0001)
    return np.clip(np.where(corrected<=0.0031308,corrected*12.92,1.055*corrected**(1/2.4)-0.055),0,1)


def author_numeric(family, n):
    """Independent, approximate microstructure in metres; never reads albedo."""
    s = SPEC[family]
    rng = np.random.default_rng(s["seed"])
    pixels_per_m = n / s["tile_m"]
    slow = filtered_noise(rng, n, 0.008*pixels_per_m)
    if family == "handled_lacquer":
        # Smooth finish with weak directional pores, not carved wood/grand cracks.
        relief = filtered_noise(rng, n, 0.00035*pixels_per_m, 0.0014*pixels_per_m)
        height = relief * 0.000004
        roughness = s["roughness"] + slow*0.012 + relief*0.004
        construction = "4 micrometre RMS smooth directional finish relief; 0.35/1.4 mm correlation; independent roughness variation"
    elif family == "luggage_canvas":
        # The source already depicts irregular interlaced threads. Do not layer an
        # unrelated periodic weave over it and create beating or conflicting relief.
        relief = filtered_noise(rng, n, 0.00014*pixels_per_m)
        height = relief*0.0000015
        roughness = s["roughness"] + slow*0.012 + relief*0.006
        construction = "1.5 micrometre RMS stochastic fibre relief, 0.14 mm correlation; no second weave grid and no colour embossing; photographic weave scale is controlled by the 0.10 m tile"
    else:
        relief = filtered_noise(rng, n, 0.00022*pixels_per_m)
        height = relief * 0.000005
        roughness = s["roughness"] + slow*0.010 + relief*0.008
        construction = "5 micrometre RMS isotropic felt nap, 0.22 mm correlation; no ticking stripe field or albedo-derived relief"
    dx = (np.roll(height, -1, 1)-np.roll(height, 1, 1)) * (0.5*pixels_per_m)
    dy = (np.roll(height, -1, 0)-np.roll(height, 1, 0)) * (0.5*pixels_per_m)
    slope = np.sqrt(dx*dx+dy*dy)
    limiter = np.minimum(1, s["max_slope"]/np.maximum(slope, 1e-9))
    normal = np.stack([-dx*limiter, dy*limiter, np.ones_like(dx)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    normal8 = np.rint((normal*0.5+0.5)*255).astype(np.uint8)
    roughness = np.clip(roughness, *s["roughness_range"])
    decoded = normal8.astype(np.float32)/255*2-1
    decoded /= np.linalg.norm(decoded, axis=-1, keepdims=True)
    angles = np.degrees(np.arccos(np.clip(decoded[:, :, 2], -1, 1)))
    result = {"normal": normal8, "roughness": np.rint(roughness*255).astype(np.uint8),
              "metalness": np.zeros((n, n), dtype=np.uint8)}
    validation = {"authored_not_measured": True, "numeric_maps_independent_of_albedo": True,
                  "construction": construction, "height_rms_m": float(height.std()),
                  "normal_angle_degrees_p50_p95_max": np.percentile(angles, [50, 95, 100]).round(4).tolist(),
                  "roughness_p05_p50_p95": np.percentile(roughness, [5, 50, 95]).round(4).tolist(),
                  "metalness_min_max": [0, 0], "slope_cap": s["max_slope"],
                  "slope_clamped_fraction": float(np.mean(limiter < 1))}
    return result, validation


def save_image(path, array):
    Image.fromarray(array).save(path, compress_level=4)
    return {"path": path.as_posix(), "sha256": sha(path), "dimensions": list(Image.open(path).size)}


def relative_path(path, parent):
    return str(path.relative_to(parent)).replace("\\", "/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--output-root", type=Path, required=True)
    ap.add_argument("--size", type=int, default=2048)
    ap.add_argument("--test-fixture", action="store_true")
    args = ap.parse_args()
    if args.size < 256 or args.size > 4096:
        raise ValueError("Map size must be 256..4096")
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    source_base = manifest_path.parent
    root = args.output_root.resolve()
    raw_dir = root / "assets/textures/raw"
    pbr_dir = root / "assets/textures/pbr"
    raw_dir.mkdir(parents=True, exist_ok=True)
    pbr_dir.mkdir(parents=True, exist_ok=True)
    records = []
    validations = []
    for family, spec in SPEC.items():
        record = manifest["sources"][family]
        source = (source_base / record["path"]).resolve()
        if not source.is_file():
            raise FileNotFoundError(source)
        if record.get("expected_sha256") and sha(source) != record["expected_sha256"]:
            raise ValueError(f"Source hash mismatch: {family}")
        if not args.test_fixture and (not record.get("model_tool") or not record.get("prompt")):
            raise ValueError("Production sources require actual model/tool and prompt provenance")
        raw_target = raw_dir / (family + "_raw" + source.suffix.lower())
        if source != raw_target:
            shutil.copy2(source, raw_target)
        raw_hash = sha(source)
        image = Image.open(source).convert("RGB")
        native_dimensions = list(image.size)
        actions = []
        if record.get("crop_pixels"):
            crop = record["crop_pixels"]
            if len(crop) != 4 or not (0 <= crop[0] < crop[2] <= image.width and 0 <= crop[1] < crop[3] <= image.height):
                raise ValueError(f"Invalid crop: {family}")
            image = image.crop(crop)
            actions.append({"operation": "crop", "pixel_bounds": crop})
        if image.width != image.height:
            raise ValueError("Choose an explicit square crop; do not distort source aspect")
        if image.size != (args.size, args.size):
            actions.append({"operation": "Lanczos_resize", "from_dimensions": list(image.size),
                            "to_dimensions": [args.size, args.size],
                            "native_detail_increased": False})
            image = image.resize((args.size, args.size), Image.Resampling.LANCZOS)
        before = np.asarray(image).astype(np.float64)/255
        after = periodic_component(before) if record.get("repair_seams", True) else before
        if record.get("repair_seams", True):
            actions.append({"operation": "periodic_plus_smooth_boundary_repair",
                            "mean_absolute_srgb_delta": float(np.abs(after-before).mean()),
                            "max_absolute_srgb_delta": float(np.abs(after-before).max()),
                            "albedo_recolouring": False})
        if record.get("broad_colour_suppression"):
            setting=record["broad_colour_suppression"]
            previous=after
            after=suppress_broad_colour_variation(after,setting["sigma_fraction"]*args.size,setting["strength"])
            actions.append({"operation":"suppress_broad_source_colour_variation",
                            "working_space":"linear RGB; normalised gain preserves average linear RGB and fine local contrast",
                            "sigma_fraction":setting["sigma_fraction"],"strength":setting["strength"],
                            "purpose":"Prevent repeated brightness patches seen in physical-size material proof; no measured relighting claim",
                            "mean_absolute_srgb_delta":float(np.abs(after-previous).mean()),
                            "mean_rgb_before":previous.mean(axis=(0,1)).tolist(),
                            "mean_rgb_after":after.mean(axis=(0,1)).tolist()})
        if record.get("colour_microcontrast") is not None:
            amount=float(record["colour_microcontrast"])
            if not 0<amount<=1: raise ValueError("Colour microcontrast must be in (0,1]")
            linear=np.where(after<=0.04045,after/12.92,((after+0.055)/1.055)**2.4)
            mean=linear.mean(axis=(0,1),keepdims=True)
            linear=mean+amount*(linear-mean)
            after=np.clip(np.where(linear<=0.0031308,linear*12.92,1.055*linear**(1/2.4)-0.055),0,1)
            actions.append({"operation":"reduce_photographic_microcontrast_in_linear_RGB",
                            "retained_contrast_fraction":amount,
                            "purpose":"Restrained dyed-cotton albedo at intended camera scale; reduce baked thread contrast and repeated coarse source patches; native fibre arrangement retained",
                            "numeric_relief_added_from_colour":False})
        maps, validation = author_numeric(family, args.size)
        maps["basecolor"] = np.rint(after*255).astype(np.uint8)
        paths = {}
        for channel, arr in maps.items():
            path = pbr_dir / f"{family}_{channel}.png"
            info = save_image(path, arr)
            info["path"] = relative_path(path, root)
            info["color_space"] = "sRGB" if channel == "basecolor" else "Non-Color"
            paths[channel] = info
        validation.update({"family_id": family, "tile_size_m": spec["tile_m"],
                           "basecolor_mean_srgb": after.mean(axis=(0, 1)).round(4).tolist(),
                           "source_image_semantic_acceptance": "unreviewed",
                           "applied_mesh_browser_acceptance": "unreviewed"})
        validations.append(validation)
        records.append({"family_id": family,
                        "model_tool": record.get("model_tool", "legacy test fixture; no generation in this run"),
                        "prompt": record.get("prompt", "not a fresh generation"),
                        "reference_inputs": record.get("reference_inputs", []),
                        "generation_metadata": record.get("generation_metadata", {}),
                        "source_original_path": record.get("original_generation_path", str(source)),
                        "preparation_input_path": str(source), "raw_output_path": relative_path(raw_target, root),
                        "raw_sha256": raw_hash, "native_dimensions": native_dimensions,
                        "target_production_dimensions": [args.size, args.size],
                        "repairs_and_authoring": actions + [validation["construction"]],
                        "numeric_map_boundary": "Authored approximate microstructure, independent of source colour; not measured PBR",
                        "mesh_ids": spec["mesh_ids"], "uv_set": "UVMap", "material_slot": spec["material_slot"],
                        "physical_tile_size_m": spec["tile_m"],
                        "texture_channel_assignment": {"baseColor": paths["basecolor"]["path"],
                            "normal": paths["normal"]["path"], "roughness": paths["roughness"]["path"],
                            "metalness": paths["metalness"]["path"]}, "derived_maps": paths})
    # Preserve existing exact labels as independent legacy assets, with explicit provenance.
    labels = []
    label_source = manifest.get("label_source_root")
    if label_source:
        label_root = (source_base / label_source).resolve()
        original = json.loads((label_root/"assets/textures/provenance.json").read_text(encoding="utf-8-sig"))
        for item in original.get("payload_label_decals", []):
            item = dict(item)
            item["preservation_note"] = "Existing exact label copied byte-for-byte; not fresh Nano Banana output"
            legacy_raw = label_root / item["source_raw_output_path"]
            if sha(legacy_raw) != item["source_raw_sha256"]:
                raise ValueError("Legacy label source hash mismatch")
            legacy_dest = raw_dir / "legacy_labels" / legacy_raw.name
            legacy_dest.parent.mkdir(parents=True, exist_ok=True)
            if legacy_raw != legacy_dest:
                shutil.copy2(legacy_raw, legacy_dest)
            item["source_raw_output_path"] = relative_path(legacy_dest, root)
            for channel, info in item["derived_maps"].items():
                src = label_root / info["path"]
                if sha(src) != info["sha256"]:
                    raise ValueError(f"Label hash mismatch: {src}")
                dst = root / info["path"]
                dst.parent.mkdir(parents=True, exist_ok=True)
                if src != dst:
                    shutil.copy2(src, dst)
            labels.append(item)
    output = {"project": "vertical-lost-and-found", "revision": "retry02-materials",
              "generated_at": datetime.now(timezone.utc).isoformat(),
              "state": "legacy-source-test-fixture" if args.test_fixture else "prepared-awaiting-visual-review",
              "production_ready": False, "material_families": records, "payload_label_decals": labels,
              "preparation_script_sha256": sha(Path(__file__))}
    config = {"uv_convention": "1 UV unit per metre for material surfaces; labels retain deliberate [0,1] UVs",
              "normal_convention": "OpenGL tangent-space; GLB image flipY=false in Three.js",
              "runtime_rule": "Preserve GLTFLoader material and KHR_texture_transform; no arbitrary tint or repeat overrides",
              "materials": {fam: {"material_slot": s["material_slot"], "tile_size_m": s["tile_m"],
                 "blender_mapping_scale": 1/s["tile_m"], "base_color_multiplier": [1, 1, 1],
                 "normal_strength": 1.0, "metalness": 0.0} for fam, s in SPEC.items()}}
    for path, obj in [(root/"assets/textures/provenance.json", output),
                      (root/"material-config.json", config), (root/"material-validation.json", validations)]:
        path.write_text(json.dumps(obj, indent=2)+"\n", encoding="utf-8")
    # Self-contained input manifest for rebuilding after moving the whole output directory.
    rebuild = json.loads(json.dumps(manifest))
    rebuild["label_source_root"] = "." if labels else None
    for record in records:
        rebuild["sources"][record["family_id"]]["path"] = record["raw_output_path"]
        rebuild["sources"][record["family_id"]]["expected_sha256"] = record["raw_sha256"]
    (root/"rebuild-sources.json").write_text(json.dumps(rebuild,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"output_root": str(root), "state": output["state"], "families": len(records),
                      "preserved_labels": len(labels), "visual_acceptance": "unreviewed"}))


if __name__ == "__main__":
    main()
