"""Fly the drone along the beach, ask Gemini which lights are visible, locate them, write GeoJSON.

Run inside the container while `gz sim world.sdf` is running:
    python3 fly.py

Writes:
    captures/wpNN.png      one image per waypoint
    flight.geojson         the drone track: one point per waypoint with GPS, heading, image, raw boxes
    detections.geojson     one point per located light, with the views it was triangulated from
"""

import hashlib
import io
import json
import math
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from google import genai
from google.genai import errors, types
from gz.msgs10.image_pb2 import Image as GzImage
from gz.transport13 import Node
from PIL import Image

import locate
import scene

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
HEADING_DEG = scene.INLAND_BEARING_DEG  # the drone faces inland
HERE = Path(__file__).parent
CAPTURES = HERE / "captures"

BATCH_SIZE = 9  # images per Gemini request; the free tier allows 20 requests per model per day
CACHE = CAPTURES / "gemini_cache.json"

PROMPT = """These are {n} night photos, in order, taken by a drone flying along a Fort Myers Beach (Lee County, Florida) sea turtle nesting beach during nesting season, looking inland across the sand at the buildings behind the dunes.
Sea turtle hatchlings crawl toward artificial light instead of the ocean. Judge each photo by these local rules:
- Any artificial light source directly visible from the beach is a violation.
- A window lit from inside but glazed with tinted "turtle glass" (45 percent visible light transmittance or less) is compliant. It shows as a dim bronze or amber glow, far darker than a normal lit window.
- Shadow rule (Lee County LDC 14-73): a shadow cast by artificial lighting on an object in nesting habitat (the sand seaward of the dunes) is a presumed violation, even when the light itself is out of frame.

Report two kinds of items in each photo:
- "light": every artificial light source (lit windows, balcony or patio lights, streetlights, floodlights). Ignore dark windows and the moon. Objects on the sand, such as beach umbrellas or chairs, are never lights. Draw one tight box around only the glowing part (the lit window pane, or the lamp head, never a pole).
- "shadow": every shadow on the sand cast by artificial light. Draw the box around the shadow itself.

Return JSON: {{"images": [{{"index": 0, "lights": [...]}}, ...]}} with one entry per photo, index 0 to {last}. Both kinds go in "lights".
Each item has:
- "kind": "light" or "shadow"
- "box_2d": [ymin, xmin, ymax, xmax] scaled 0 to 1000, in that photo's own coordinates
- "light_type": short description, e.g. "lit window, no blinds", "window behind turtle glass", "shadow of beach umbrella on the sand"
- "compliant": true only for lights that meet the rules (such as turtle glass), otherwise false
- "severity": "high", "medium" or "low" for violations (how visible and bright from the beach); "ok" when compliant
- "rule": the rule it breaks or meets, in a few words
- "fix": one sentence, written to whoever controls the light (for a compliant light, say that no action is needed)
"""

SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1, "ok": 0}


def is_shadow(d):
    return d.get("kind") == "shadow"


def is_compliant(d):
    return not is_shadow(d) and d.get("compliant") is True


def is_violation(d):
    return not is_shadow(d) and not is_compliant(d)


def subset(frames, keep):
    """Frames with only the detections that pass keep(); detection indices refer to the subset."""
    return [{**f, "detections": [d for d in f["detections"] if keep(d)]} for f in frames]


class Drone:
    """Moves the simulated drone and reads its camera over one gz-transport node."""

    def __init__(self):
        self._lock = threading.Lock()
        self._frame = None
        self._stamp = 0.0
        self._node = Node()
        if not self._node.subscribe(GzImage, scene.CAMERA_TOPIC, self._on_image):
            raise RuntimeError(f"could not subscribe to {scene.CAMERA_TOPIC}; is gz sim running?")

    def _on_image(self, msg):
        frame = Image.frombytes("RGB", (msg.width, msg.height), msg.data)
        with self._lock:
            self._frame = frame
            self._stamp = time.monotonic()

    def close(self):
        # Unsubscribe before interpreter shutdown, or a late frame callback aborts the process.
        self._node.unsubscribe(scene.CAMERA_TOPIC)

    def move(self, x):
        # ponytail: the gz CLI is used because Node.request from Python fails intermittently in this container.
        req = (
            f'name: "{scene.DRONE_NAME}", '
            f"position: {{x: {x}, y: {scene.DRONE_Y}, z: {scene.DRONE_Z}}}, "
            "orientation: {x: 0, y: 0, z: 0.7071068, w: 0.7071068}"
        )
        cmd = [
            "gz", "service", "-s", f"/world/{scene.WORLD_NAME}/set_pose",
            "--reqtype", "gz.msgs.Pose", "--reptype", "gz.msgs.Boolean",
            "--timeout", "3000", "--req", req,
        ]
        detail = ""
        for _ in range(3):
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            except subprocess.TimeoutExpired:
                detail = "gz service hung for 10 s"
                continue
            if "data: true" in out.stdout:
                return
            detail = f"{out.stdout.strip()} {out.stderr.strip()}"
            time.sleep(0.5)
        raise RuntimeError(f"set_pose failed 3 times: {detail}")

    def frame_after(self, t, timeout=15.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            with self._lock:
                if self._frame is not None and self._stamp > t:
                    return self._frame
            time.sleep(0.05)
        raise TimeoutError("no camera frame; is the simulation running (gz sim -r)?")


def valid_light(d):
    box = d.get("box_2d") if isinstance(d, dict) else None
    return (
        isinstance(box, list)
        and len(box) == 4
        and all(isinstance(v, (int, float)) and 0 <= v <= 1000 for v in box)
        and box[0] < box[2]
        and box[1] < box[3]
    )


def ask_gemini(client, pngs):
    """One request for a batch of images.

    Returns one entry per image: a list of lights, or None when Gemini skipped that
    image or answered with something unusable, so the caller can retry it later
    instead of caching "no lights".
    """
    prompt = PROMPT.format(n=len(pngs), last=len(pngs) - 1)
    parts = [types.Part.from_bytes(data=b, mime_type="image/png") for b in pngs] + [prompt]
    config = types.GenerateContentConfig(response_mime_type="application/json", temperature=0)
    for attempt in range(3):
        try:
            resp = client.models.generate_content(model=MODEL, contents=parts, config=config)
            break
        except errors.APIError as e:
            # A per-day 429 will not clear today, so stop; per-minute 429s and 5xx overloads clear in seconds.
            if e.code == 429 and "PerDay" in str(e):
                raise SystemExit(
                    f"Gemini daily quota exhausted for {MODEL}. Set GEMINI_MODEL in .env to another model, "
                    "use a teammate's key, or enable billing. Cached waypoints rerun for free."
                ) from e
            if (e.code != 429 and e.code < 500) or attempt == 2:
                raise
            print(f"  Gemini {e.code}, retrying in {10 * (attempt + 1)}s")
            time.sleep(10 * (attempt + 1))
    out = [None] * len(pngs)
    try:
        data = json.loads(resp.text or "")
    except json.JSONDecodeError:
        print("  Gemini returned invalid JSON; these images will be retried on the next run")
        return out
    entries = data.get("images", []) if isinstance(data, dict) else data
    for entry in entries if isinstance(entries, list) else []:
        i = entry.get("index") if isinstance(entry, dict) else None
        lights = entry.get("lights") if isinstance(entry, dict) else None
        if isinstance(i, int) and 0 <= i < len(pngs) and out[i] is None and isinstance(lights, list):
            out[i] = [d for d in lights if valid_light(d)]
    return out


def cache_key(x):
    world = (HERE / "world.sdf").read_bytes()
    return hashlib.sha256(world + MODEL.encode() + PROMPT.encode() + str(x).encode()).hexdigest()[:16]


def capture_frames(drone):
    frames = []
    for i, x in enumerate(scene.WAYPOINT_XS, start=1):
        drone.move(x)
        t = time.monotonic()
        time.sleep(0.3)
        frame = drone.frame_after(t)
        name = f"wp{i:02d}.png"
        frame.save(CAPTURES / name)
        buf = io.BytesIO()
        frame.save(buf, format="PNG")
        lat, lon = scene.to_lat_lon(x, scene.DRONE_Y)
        frames.append(
            {"waypoint": i, "x": x, "lat": lat, "lon": lon, "image": f"captures/{name}", "png": buf.getvalue()}
        )
    print(f"captured {len(frames)} waypoints")
    return frames


def detect(client, frames):
    """Fill frame["detections"], reusing cached answers so reruns of an unchanged scene cost no quota."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [f for f in frames if cache_key(f["x"]) not in cache]
    for start in range(0, len(todo), BATCH_SIZE):
        batch = todo[start : start + BATCH_SIZE]
        results = ask_gemini(client, [f["png"] for f in batch])
        for f, dets in zip(batch, results):
            if dets is not None:
                cache[cache_key(f["x"])] = dets
        tmp = CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache))
        tmp.replace(CACHE)
        skipped = sum(d is None for d in results)
        note = f", {skipped} skipped by Gemini" if skipped else ""
        print(f"  Gemini request {start // BATCH_SIZE + 1}: {len(batch)} images{note}")
    for f in frames:
        f["detections"] = cache.get(cache_key(f["x"]), [])
        del f["png"]
        print(f"waypoint {f['waypoint']:2d} x={f['x']:+4d}: Gemini saw {len(f['detections'])} lights")


def view(frame, det):
    u, _ = locate.box_center_px(det["box_2d"])
    return {
        "waypoint": frame["waypoint"],
        "image": frame["image"],
        "drone": [round(frame["lon"], 7), round(frame["lat"], 7), scene.DRONE_Z],
        "heading_deg": HEADING_DEG,
        "bearing_deg": round((HEADING_DEG + locate.bearing_deg(u)) % 360, 1),
        "box_2d": det["box_2d"],
    }


def write_geojson(frames, lights, fixtures):
    """lights: find_all() output."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    track = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(f["lon"], 7), round(f["lat"], 7)]},
            "properties": {
                "waypoint": f["waypoint"],
                "altitude_m": scene.DRONE_Z,
                "heading_deg": HEADING_DEG,
                "hfov_deg": round(math.degrees(scene.HFOV), 2),
                "image": f["image"],
                "image_size": [scene.IMAGE_W, scene.IMAGE_H],
                "detections": f["detections"],
            },
        }
        for f in frames
    ]
    (HERE / "flight.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": track}, indent=2))

    features = light_features(subset(frames, is_violation), lights["violations"], fixtures, now)
    features += light_features(subset(frames, is_compliant), lights["compliant"], fixtures, now, compliant=True)
    (HERE / "detections.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=2))
    return features


def light_features(frames, lights, fixtures, now, compliant=False):
    features, ids = [], set()
    for n, light in enumerate(lights, start=1):
        x, y, z = light["point"]
        lat, lon = scene.to_lat_lon(x, y)
        dets = [frames[fi]["detections"][di] for fi, di in light["views"]]
        worst = max(dets, key=lambda d: SEVERITY_RANK.get(d.get("severity"), 0))
        kinds = [d.get("light_type", "light") for d in dets]
        light_type = max(set(kinds), key=kinds.count)
        fx = locate.nearest_fixture(light["point"], fixtures)
        fid = fx["id"] if fx else f"light-{n}"
        if fid in ids:
            fid = f"{fid}-{n}"
        ids.add(fid)
        views = [view(frames[fi], frames[fi]["detections"][di]) for fi, di in sorted(light["views"])]
        # The photo where the light sits nearest the centre shows it most clearly.
        central = min(views, key=lambda v: abs((v["box_2d"][1] + v["box_2d"][3]) / 2 - 500))
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                "properties": {
                    "id": fid,
                    "kind": "light",
                    "building": fx["building"] if fx else "unknown",
                    "unit": fx["unit"] if fx else None,
                    "light_type": light_type,
                    "compliant": compliant,
                    "severity": "ok" if compliant else worst.get("severity", "medium"),
                    "rule": worst.get("rule", ""),
                    "visible_from_beach": True,
                    "fix": worst.get("fix", ""),
                    "notify": None if compliant else (fx["notify"] if fx else "city"),
                    "height_m": round(z, 1),
                    "distance_from_drone_m": round(y - scene.DRONE_Y, 1),
                    "method": "triangulated",
                    "image": central["image"],
                    "box_2d": central["box_2d"],
                    "views": views,
                    "captured_at": now,
                },
            }
        )
    return features


def find_all(frames):
    """Violating and compliant lights are triangulated separately.

    Gemini also reports shadows on the sand (Lee County's shadow rule); they stay in
    flight.geojson but are not located yet, because shadows at the bottom edge of the
    frame get clipped boxes that scatter on the ground.
    """
    return {
        "violations": locate.locate_lights(subset(frames, is_violation)),
        "compliant": locate.locate_lights(subset(frames, is_compliant)),
    }


def main():
    if not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("GEMINI_API_KEY is not set; put it in the repo's .env")
    client = genai.Client(
        http_options=types.HttpOptions(timeout=120_000, retry_options=types.HttpRetryOptions(attempts=1))
    )
    drone = Drone()
    fixtures = scene.fixtures()
    CAPTURES.mkdir(exist_ok=True)

    try:
        frames = capture_frames(drone)
    finally:
        drone.close()
    detect(client, frames)
    found = find_all(frames)
    features = write_geojson(frames, found, fixtures)

    truth = {f["id"]: f for f in scene.violations()}
    tinted = {f["id"] for f in fixtures if f["tinted"]}
    caught, errs, flagged_tinted = set(), [], set()
    for light in found["violations"]:
        fx = locate.nearest_fixture(light["point"], fixtures)
        if fx and fx["id"] in truth:
            caught.add(fx["id"])
            errs.append(math.dist(light["point"], fx["pos"]))
        elif fx and fx["id"] in tinted:
            flagged_tinted.add(fx["id"])
    passed_violations = set()
    for light in found["compliant"]:
        fx = locate.nearest_fixture(light["point"], fixtures)
        if fx and fx["id"] in truth:
            passed_violations.add(fx["id"])
    mean_err = sum(errs) / len(errs) if errs else float("nan")
    print(
        f"wrote flight.geojson ({len(frames)} waypoints) and detections.geojson ({len(features)} features)\n"
        f"violations: caught {len(caught)}/{len(truth)}, {len(found['violations']) - len(caught)} unmatched or false, "
        f"mean location error {mean_err:.2f} m\n"
        f"turtle glass: {len(found['compliant'])} marked compliant, {len(flagged_tinted)} wrongly flagged as violations, "
        f"{len(passed_violations)} violations wrongly passed as compliant"
    )
    missed = sorted(set(truth) - caught)
    if missed:
        print("missed: " + ", ".join(missed))


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    # ponytail: gz-transport's pybind threads can abort during interpreter teardown; skip teardown once output is written.
    os._exit(0)
