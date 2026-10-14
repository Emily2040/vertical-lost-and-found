"""Validate saved material outputs. A passing result never certifies visual quality."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    args = ap.parse_args()
    root = args.root.resolve()
    p = json.loads((root/"assets/textures/provenance.json").read_text())
    config = json.loads((root/"material-config.json").read_text())
    errors = []
    findings = []
    expected_tiles = {"handled_lacquer": 0.5, "luggage_canvas": 0.10, "worn_lining": 0.25}
    rough_ranges = {"handled_lacquer": (0.28, 0.40), "luggage_canvas": (0.75, 0.86), "worn_lining": (0.86, 0.96)}
    for m in p["material_families"]:
        fam = m["family_id"]
        raw = root/m["raw_output_path"]
        if digest(raw) != m["raw_sha256"]:
            errors.append(f"{fam}: raw hash differs")
        if list(Image.open(raw).size) != m["native_dimensions"]:
            errors.append(f"{fam}: native dimension record differs")
        maps = {}
        for channel, entry in m["derived_maps"].items():
            path = root/entry["path"]
            if digest(path) != entry["sha256"]:
                errors.append(f"{fam}/{channel}: derived hash differs")
            img = Image.open(path)
            if list(img.size) != entry["dimensions"]:
                errors.append(f"{fam}/{channel}: dimensions differ")
            if entry["color_space"] != ("sRGB" if channel == "basecolor" else "Non-Color"):
                errors.append(f"{fam}/{channel}: colour space wrong")
            maps[channel] = np.asarray(img).astype(float)/255
        if np.max(maps["metalness"]) != 0:
            errors.append(f"{fam}: dielectric has nonzero metalness")
        lo, hi = rough_ranges[fam]
        if maps["roughness"].min() < lo-1/255 or maps["roughness"].max() > hi+1/255:
            errors.append(f"{fam}: roughness outside declared range")
        n = maps["normal"]*2-1
        norm = np.linalg.norm(n, axis=-1)
        if np.max(np.abs(norm-1)) > 0.015 or np.min(n[:, :, 2]) <= 0:
            errors.append(f"{fam}: invalid tangent-space normal")
        angle = np.degrees(np.arccos(np.clip(n[:, :, 2]/norm, -1, 1)))
        max_angle = {"handled_lacquer": 8, "luggage_canvas": 13, "worn_lining": 10}[fam]
        if angle.max() > max_angle:
            errors.append(f"{fam}: numerical relief is too strong")
        c = config["materials"][fam]
        if c["tile_size_m"] != expected_tiles[fam] or abs(c["blender_mapping_scale"]*c["tile_size_m"] - 1) > 1e-9:
            errors.append(f"{fam}: physical UV scale is inconsistent")
        if c["base_color_multiplier"] != [1, 1, 1]:
            errors.append(f"{fam}: unapproved shader tint")
        findings.append({"family_id": fam, "raw_hash": "pass", "channel_hashes": "pass",
                         "native_dimensions": m["native_dimensions"], "tile_size_m": c["tile_size_m"],
                         "normal_max_angle_degrees": round(float(angle.max()), 3)})
    for label in p.get("payload_label_decals", []):
        if digest(root/label["source_raw_output_path"]) != label["source_raw_sha256"]:
            errors.append(f"{label['catalog_id']}: original label source differs")
        for channel, entry in label["derived_maps"].items():
            if digest(root/entry["path"]) != entry["sha256"]:
                errors.append(f"{label['catalog_id']}/{channel}: exact label changed")
    report = {"passed": not errors, "state": p["state"], "errors": errors, "materials": findings,
              "exact_label_count": len(p.get("payload_label_decals", [])),
              "visual_quality": "requires rendered source, hero and browser review", "production_ready": False}
    (root/"validation-report.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report))
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
