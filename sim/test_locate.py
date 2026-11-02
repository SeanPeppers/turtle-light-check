"""Geometry self-check. Runs anywhere with Python 3: python3 test_locate.py"""

import math
import random

import locate
import scene

W, H = scene.IMAGE_W, scene.IMAGE_H
fixtures = scene.fixtures()
lit = [f for f in fixtures if f["lit"]]

# A point straight ahead of the camera lands on the image centre.
u, v = locate.project((10.0, scene.BUILDING_Y, scene.DRONE_Z), cam_x=10.0)
assert abs(u - W / 2) < 1e-6 and abs(v - H / 2) < 1e-6

# Right of and above the drone means right of and above the centre; bearing is east of north.
u, v = locate.project((15.0, scene.BUILDING_Y, scene.DRONE_Z + 3), cam_x=10.0)
assert u > W / 2 and v < H / 2
assert 0 < locate.bearing_deg(u) < 90
assert 270 < locate.bearing_deg(W / 2 - 100) < 360

# Exact pixels from two waypoints recover every lit fixture, windows and streetlights at different depths.
for f in lit:
    x1 = f["pos"][0] - 4
    x2 = x1 + 8
    u1, v1 = locate.project(f["pos"], x1)
    u2, v2 = locate.project(f["pos"], x2)
    p = locate.triangulate(u1, v1, x1, u2, v2, x2)
    assert p and math.dist(p, f["pos"]) < 1e-6, (f["id"], p)

# Swapped or nonsense pairs are rejected (negative or huge depth).
assert locate.triangulate(640, 300, 0, 640, 300, 8) is None


def fake_gemini(cam_x, noise_px, rng):
    """Boxes Gemini would draw: every lit fixture in view, centres jittered by noise_px, in 0-1000 units."""
    dets = []
    for f in lit:
        u, v = locate.project(f["pos"], cam_x)
        if not (0 <= u < W and 0 <= v < H):
            continue
        u += rng.gauss(0, noise_px)
        v += rng.gauss(0, noise_px)
        cx, cy = u / W * 1000, v / H * 1000
        dets.append({"box_2d": [cy - 12, cx - 15, cy + 12, cx + 15], "severity": "high", "id_truth": f["id"]})
    rng.shuffle(dets)
    return dets


def run_pipeline(noise_px, seed, drop=0.0, false_per_frame=0):
    """Fake flight: optionally drop boxes Gemini misses and add spurious boxes it invents."""
    rng = random.Random(seed)
    frames = []
    for x in scene.WAYPOINT_XS:
        dets = [d for d in fake_gemini(x, noise_px, rng) if rng.random() >= drop]
        for _ in range(false_per_frame):
            cy, cx = rng.uniform(50, 950), rng.uniform(50, 950)
            dets.append({"box_2d": [cy - 10, cx - 10, cy + 10, cx + 10], "id_truth": None})
        frames.append({"x": x, "detections": dets})
    lights = locate.locate_lights(frames)
    found, errs, mixed = set(), [], 0
    for light in lights:
        truths = {frames[fi]["detections"][di]["id_truth"] for fi, di in light["views"]}
        mixed += len(truths) > 1
        fx = locate.nearest_fixture(light["point"], fixtures)
        if fx and fx["lit"]:
            found.add(fx["id"])
            errs.append(math.dist(light["point"], fx["pos"]))
    return found, errs, mixed, len(lights) - len(found)


all_lit = {f["id"] for f in lit}

# Perfect boxes: every lit fixture found exactly, nothing extra, no light built from two different sources.
found, errs, mixed, false = run_pipeline(0.0, seed=0)
assert found == all_lit and false == 0 and mixed == 0 and max(errs) < 1e-6, (found, false, mixed)


def sweep(label, max_err_m, max_missed=0, max_false=0, **kw):
    worst_err, worst_mixed, missed, false_total = 0.0, 0, 0, 0
    for seed in range(20):
        found, errs, mixed, false = run_pipeline(seed=seed, **kw)
        missed += len(all_lit - found)
        false_total += false
        worst_err = max([worst_err, *errs])
        worst_mixed = max(worst_mixed, mixed)
    print(f"{label}: missed {missed}/{20 * len(lit)}, false {false_total}, worst error {worst_err:.2f} m, worst mixed {worst_mixed}")
    assert missed <= max_missed and false_total <= max_false and worst_err < max_err_m


sweep("5 px jitter", 1.5, noise_px=5.0)
# Heavier jitter, dropped boxes and invented boxes are stress levels: a few misses or extras out of 180 are allowed.
sweep("10 px jitter", 2.0, noise_px=10.0)
sweep("5 px jitter, Gemini misses 20% of boxes", 2.0, max_missed=6, noise_px=5.0, drop=0.2)
sweep("5 px jitter, 3 invented boxes per frame", 1.5, max_false=2, noise_px=5.0, false_per_frame=3)

# World to lat/lon keeps distances and points +y inland (north-east at Fort Myers Beach).
lat, lon = scene.to_lat_lon(0, 100)
north = (lat - scene.ORIGIN_LAT) * 111_320
east = (lon - scene.ORIGIN_LON) * 111_320 * math.cos(math.radians(scene.ORIGIN_LAT))
assert abs(math.hypot(east, north) - 100) < 1e-6
assert abs(math.degrees(math.atan2(east, north)) - scene.INLAND_BEARING_DEG) < 1e-6
lat, lon = scene.to_lat_lon(100, 0)
assert lat < scene.ORIGIN_LAT and lon > scene.ORIGIN_LON  # along the shore is south-east
print("ok")
