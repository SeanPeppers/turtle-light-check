"""Demo flight: the drone glides along the beach, draws a sight line to every light it
sees, and drops a marker where the sight lines meet.

    python3 demo.py            # live, for the Gazebo GUI; the GUI camera follows the drone
    python3 demo.py --record   # also renders demo.mp4 from a chase camera, with overlays

It replays detections.geojson and flight.geojson from fly.py, so it makes no Gemini
calls and runs the same every time.
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

from gz.msgs10.boolean_pb2 import Boolean
from gz.msgs10.entity_factory_pb2 import EntityFactory
from gz.msgs10.entity_pb2 import Entity
from gz.msgs10.pose_pb2 import Pose
from gz.msgs10.stringmsg_pb2 import StringMsg
from gz.transport13 import Node
from PIL import Image, ImageDraw, ImageFont

import locate
import scene

HERE = Path(__file__).parent
FPS = 30
STEP_M = 0.4  # drone travel per frame, 12 m/s at 30 fps
PAUSE_FRAMES = 8  # hover at each waypoint while the photo is "taken"
END_FRAMES = 4 * FPS
# Gazebo writes chase frames here; reading files avoids an in-process image subscription,
# which makes gz-transport service calls from Python stall.
CHASE_DIR = HERE / ".chase_frames"
CHASE_W, CHASE_H = 1280, 720
OUT_W, OUT_H = 1920, 1080

RESIDENT_RGB = (255, 70, 50)
CITY_RGB = (255, 165, 0)
RAY_RGB = (90, 220, 255)
BG = (10, 14, 28)
PANEL = (22, 28, 48)
TEXT = (230, 236, 245)
MUTED = (140, 150, 175)

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"

# Real basemap of Fort Myers Beach for the video's map panel: OpenStreetMap tiles, darkened to
# match the video, fetched once and kept in maptiles/ so renders work offline.
TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
TILE_ZOOM = 18
TILE_DIR = HERE / "maptiles"
MAP_W, MAP_H = 550, 360
ATTRIBUTION = "© OpenStreetMap contributors"


def world_px(lat, lon, z=TILE_ZOOM):
    """Web Mercator pixel coordinates at zoom z."""
    n = 256 * 2**z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def basemap(center_lat, center_lon):
    """MAP_W x MAP_H dark street map centred on a point, plus a lat/lon -> panel pixel function."""
    import urllib.request

    TILE_DIR.mkdir(exist_ok=True)
    cx, cy = world_px(center_lat, center_lon)
    left, top = cx - MAP_W / 2, cy - MAP_H / 2
    img = Image.new("RGB", (MAP_W, MAP_H), (20, 20, 24))
    for tx in range(int(left // 256), int((left + MAP_W) // 256) + 1):
        for ty in range(int(top // 256), int((top + MAP_H) // 256) + 1):
            path = TILE_DIR / f"{TILE_ZOOM}_{tx}_{ty}.png"
            if not path.exists():
                req = urllib.request.Request(
                    TILE_URL.format(z=TILE_ZOOM, x=tx, y=ty), headers={"User-Agent": "turtle-light-check-hackathon/0.1"}
                )
                path.write_bytes(urllib.request.urlopen(req, timeout=20).read())
            img.paste(Image.open(path).convert("RGB"), (round(tx * 256 - left), round(ty * 256 - top)))
    img = Image.blend(img, Image.new("RGB", img.size, BG), 0.45)

    def to_panel(lat, lon):
        x, y = world_px(lat, lon)
        return x - left, y - top

    return img, to_panel


def font(size, bold=False):
    return ImageFont.truetype(FONT_DIR + ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"), size)


def quat(roll, pitch, yaw):
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return (
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
        cr * cp * cy + sr * sp * sy,
    )


def look_at(src, dst):
    """(roll, pitch, yaw) that points a model's +x axis from src toward dst."""
    dx, dy, dz = (d - s for s, d in zip(src, dst))
    return 0.0, math.atan2(-dz, math.hypot(dx, dy)), math.atan2(dy, dx)


def mat(rgb, glow=True):
    c = " ".join(f"{v / 255:.3f}" for v in rgb) + " 1"
    return f"<material><ambient>{c}</ambient><diffuse>{c}</diffuse>{f'<emissive>{c}</emissive>' if glow else ''}</material>"


def model_sdf(name, pose_xyz, rpy, body):
    x, y, z = pose_xyz
    r, p, yw = rpy
    return (
        f'<sdf version="1.9"><model name="{name}"><static>true</static>'
        f"<pose>{x} {y} {z} {r} {p} {yw}</pose><link name='link'>{body}</link></model></sdf>"
    )


def drone_body_sdf():
    """A quadcopter-looking visual that follows the real (camera) drone model."""
    parts = [f"<visual name='body'><geometry><box><size>0.9 0.9 0.25</size></box></geometry>{mat((40, 40, 48), False)}</visual>"]
    for i, (ax, ay) in enumerate([(1, 1), (1, -1), (-1, 1), (-1, -1)]):
        parts.append(
            f"<visual name='arm{i}'><pose>{ax * 0.45} {ay * 0.45} 0 0 0 {math.atan2(ay, ax)}</pose>"
            f"<geometry><box><size>0.9 0.12 0.08</size></box></geometry>{mat((60, 60, 70), False)}</visual>"
        )
        parts.append(
            f"<visual name='rotor{i}'><pose>{ax * 0.8} {ay * 0.8} 0.12 0 0 0</pose>"
            f"<geometry><cylinder><radius>0.42</radius><length>0.03</length></cylinder></geometry>{mat((150, 160, 175), False)}</visual>"
        )
    # Navigation lights: red port, green starboard, white strobe on top.
    for name, (px, py, pz), rgb in [("port", (0, 0.5, 0), (255, 30, 30)), ("star", (0, -0.5, 0), (30, 255, 60)), ("strobe", (0, 0, 0.2), (255, 255, 255))]:
        parts.append(
            f"<visual name='{name}'><pose>{px} {py} {pz} 0 0 0</pose>"
            f"<geometry><sphere><radius>0.12</radius></sphere></geometry>{mat(rgb)}</visual>"
        )
    return "".join(parts)


def chase_cam_sdf():
    return (
        "<sensor name='chase' type='camera'>"
        f"<topic>/chase/camera</topic><update_rate>{FPS}</update_rate><always_on>true</always_on>"
        f"<camera><horizontal_fov>1.25</horizontal_fov><image><width>{CHASE_W}</width><height>{CHASE_H}</height>"
        "<format>R8G8B8</format></image><clip><near>0.1</near><far>400</far></clip>"
        f"<save enabled='true'><path>{CHASE_DIR}</path></save></camera></sensor>"
    )


class Gz:
    def __init__(self):
        self.node = Node()
        time.sleep(1.5)  # let gz-transport discover the world's services before the first request

    def call(self, service, req, req_type, rep_type=Boolean, timeout=5000):
        for _ in range(4):
            ok, rep = self.node.request(service, req, req_type, rep_type, timeout)
            if ok:
                return rep
            time.sleep(0.2)
        raise RuntimeError(f"{service} did not answer; is gz sim running with world.sdf?")

    def set_pose(self, name, xyz, rpy):
        req = Pose(name=name)
        req.position.x, req.position.y, req.position.z = xyz
        req.orientation.x, req.orientation.y, req.orientation.z, req.orientation.w = quat(*rpy)
        self.call(f"/world/{scene.WORLD_NAME}/set_pose", req, Pose)

    def spawn(self, sdf):
        self.call(f"/world/{scene.WORLD_NAME}/create", EntityFactory(sdf=sdf), EntityFactory)

    def remove(self, name):
        ok, _ = self.node.request(f"/world/{scene.WORLD_NAME}/remove", Entity(name=name, type=Entity.MODEL), Entity, Boolean, 1000)
        return ok

    def follow(self, name):
        """Point the GUI camera at a model; harmless when no GUI is running."""
        self.node.request("/gui/follow", StringMsg(data=name), StringMsg, Boolean, 1000)

    def chase_frame(self, timeout=60.0):
        """A chase frame rendered after this call: waits for three new files and reads the middle one,
        so the frame is both after the last pose change and completely written."""
        for f in CHASE_DIR.iterdir():
            f.unlink(missing_ok=True)
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            # Files are named ..._<frame number>.png; sort numerically, not as text.
            files = sorted(CHASE_DIR.iterdir(), key=lambda f: int(f.stem.rsplit("_", 1)[-1]))
            if len(files) >= 3:
                try:
                    return Image.open(files[1]).convert("RGB")
                except (OSError, SyntaxError):
                    pass
            time.sleep(0.005)
        raise TimeoutError("chase camera stopped writing frames")


def load():
    det = json.loads((HERE / "detections.geojson").read_text())
    flight = json.loads((HERE / "flight.geojson").read_text())
    waypoints = {}
    for f in flight["features"]:
        lon, lat = f["geometry"]["coordinates"]
        x, _ = scene.from_lat_lon(lat, lon)
        p = f["properties"]
        waypoints[p["waypoint"]] = {"x": x, "image": p["image"], "detections": p["detections"]}
    lights = []
    for i, f in enumerate(det["features"]):
        lon, lat = f["geometry"]["coordinates"]
        x, y = scene.from_lat_lon(lat, lon)
        p = f["properties"]
        lights.append({"n": i, "pos": (x, y, p["height_m"]), "props": p, "views": sorted(v["waypoint"] for v in p["views"])})
    return waypoints, lights


def flight_path(waypoints):
    """Per-frame drone x positions, with the waypoint number on frames where the drone hovers."""
    xs = [waypoints[w]["x"] for w in sorted(waypoints)]
    path = []
    for i, w in enumerate(sorted(waypoints)):
        path += [(xs[i], w)] * PAUSE_FRAMES
        if i + 1 < len(xs):
            n = max(1, round(abs(xs[i + 1] - xs[i]) / STEP_M))
            path += [(xs[i] + (xs[i + 1] - xs[i]) * k / n, None) for k in range(1, n)]
    return path


def ray_sdf(name, a, b, rgb):
    mid = tuple((p + q) / 2 for p, q in zip(a, b))
    length = math.dist(a, b)
    dx, dy, dz = (q - p for p, q in zip(a, b))
    # A cylinder's axis is z; tilt it by the polar angle, then turn it to the ray's heading.
    rpy = (0.0, math.acos(dz / length), math.atan2(dy, dx))
    body = f"<visual name='v'><geometry><cylinder><radius>0.05</radius><length>{length}</length></cylinder></geometry>{mat(rgb)}</visual>"
    return model_sdf(name, mid, rpy, body)


def marker_sdf(name, pos, rgb):
    body = f"<visual name='v'><geometry><sphere><radius>1.0</radius></sphere></geometry>{mat(rgb)}</visual>"
    return model_sdf(name, pos, (0, 0, 0), body)


class Overlay:
    """Draws the 1920x1080 video frame around the chase-camera view."""

    def __init__(self, waypoints, lights):
        self.waypoints, self.lights = waypoints, lights
        self.photos = {}
        self.f_title, self.f_sub = font(40, True), font(22)
        self.f_label, self.f_small, self.f_big = font(20, True), font(18), font(64, True)
        self.f_tiny = font(13)
        pts = [scene.to_lat_lon(w["x"], scene.DRONE_Y) for w in waypoints.values()]
        pts += [scene.to_lat_lon(lt["pos"][0], lt["pos"][1]) for lt in lights]
        center = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        self.map_img, self.to_panel = basemap(*center)

    def photo(self, w):
        if w not in self.photos:
            self.photos[w] = Image.open(HERE / self.waypoints[w]["image"]).convert("RGB")
        return self.photos[w]

    def map_xy(self, x, y, box):
        x0, y0, x1, y1 = box
        return x0 + (x + 105) / 210 * (x1 - x0), y1 - (y + 35) / 90 * (y1 - y0)

    def draw(self, chase, drone_x, last_wp, found, events, end_alpha=0.0):
        out = Image.new("RGB", (OUT_W, OUT_H), BG)
        d = ImageDraw.Draw(out)
        d.text((30, 22), "TURTLE LIGHT CHECK", font=self.f_title, fill=TEXT)
        sub_x = 30 + d.textlength("TURTLE LIGHT CHECK", font=self.f_title) + 30
        d.text((sub_x, 36), "AI drone patrol of a sea-turtle nesting beach  ·  Fort Myers Beach, FL", font=self.f_sub, fill=MUTED)

        out.paste(chase.resize((1280, 720)), (30, 90))
        d.text((44, 100), "Gazebo simulation  ·  chase camera", font=self.f_small, fill=MUTED)

        # Drone camera panel: the latest waypoint photo with Gemini's boxes.
        px, py, pw, ph = 1340, 90, 550, 310
        d.rectangle((px - 2, py - 2, px + pw + 2, py + ph + 2), fill=PANEL)
        if last_wp is not None:
            out.paste(self.photo(last_wp).resize((pw, ph)), (px, py))
            for det in self.waypoints[last_wp]["detections"]:
                ymin, xmin, ymax, xmax = det["box_2d"]
                box = (px + xmin / 1000 * pw - 3, py + ymin / 1000 * ph - 3, px + xmax / 1000 * pw + 3, py + ymax / 1000 * ph + 3)
                d.rectangle(box, outline=(255, 230, 0), width=3)
            n = len(self.waypoints[last_wp]["detections"])
            caption = f"Drone camera  ·  waypoint {last_wp}  ·  Gemini found {n} light{'s' * (n != 1)}"
        else:
            caption = "Drone camera  ·  waiting for first photo"
        d.text((px, py + ph + 8), caption, font=self.f_small, fill=TEXT)

        # Real map of Fort Myers Beach: drone track so far, the drone, located lights.
        mx0, my0 = 1340, 450
        out.paste(self.map_img, (mx0, my0))

        def at(x, y):
            px, py = self.to_panel(*scene.to_lat_lon(x, y))
            return mx0 + px, my0 + py

        start = at(self.waypoints[min(self.waypoints)]["x"], scene.DRONE_Y)
        here = at(drone_x, scene.DRONE_Y)
        d.line((*start, *here), fill=(255, 255, 255), width=3)
        for light in found:
            lx, ly = at(light["pos"][0], light["pos"][1])
            rgb = CITY_RGB if light["props"]["notify"] == "city" else RESIDENT_RGB
            d.ellipse((lx - 7, ly - 7, lx + 7, ly + 7), fill=rgb, outline=(255, 255, 255), width=2)
        d.ellipse((here[0] - 9, here[1] - 9, here[0] + 9, here[1] + 9), fill=(90, 220, 255), outline=(255, 255, 255), width=2)
        d.rectangle((mx0, my0, mx0 + MAP_W, my0 + 30), fill=(10, 14, 28))
        d.text((mx0 + 10, my0 + 5), "Fort Myers Beach, FL  ·  26.451 N, 81.952 W", font=self.f_small, fill=TEXT)
        d.text((mx0 + MAP_W - 6, my0 + MAP_H - 4), ATTRIBUTION, font=self.f_tiny, fill=(200, 200, 210), anchor="rd")

        # Counters and the event log.
        residents = sum(lt["props"]["notify"] == "resident" for lt in found)
        city = len(found) - residents
        d.text((1340, 830), f"{len(found)} lights located", font=self.f_label, fill=TEXT)
        d.text((1340, 860), f"{residents} residents to notify", font=self.f_small, fill=RESIDENT_RGB)
        d.text((1340, 886), f"{city} city streetlights to report", font=self.f_small, fill=CITY_RGB)

        d.rectangle((30, 830, 1310, 1050), fill=PANEL)
        d.text((48, 842), "Located lights", font=self.f_label, fill=TEXT)
        for i, line in enumerate(events[-5:]):
            d.text((48, 878 + i * 34), fit(d, line, self.f_small, 1240), font=self.f_small, fill=TEXT)

        if end_alpha > 0:
            card = Image.new("RGB", (OUT_W, OUT_H), BG)
            cd = ImageDraw.Draw(card)
            cd.text((160, 260), f"{len(found)} beach-visible lights located", font=self.f_big, fill=TEXT)
            cd.text((160, 360), f"{residents} residents get a fix-it notice  ·  {city} streetlights reported to the city", font=font(34), fill=MUTED)
            cd.text((160, 430), "Each light is triangulated from the drone's GPS track and Gemini's boxes in several photos.", font=font(28), fill=MUTED)
            cd.text((160, 560), "Turtle Light Check", font=font(48, True), fill=RAY_RGB)
            cd.text((160, 630), "Gazebo  ·  Gemini  ·  Leaflet", font=font(28), fill=MUTED)
            out = Image.blend(out, card, end_alpha)
        return out


def fit(draw, text, fnt, width):
    """Trim text at a word boundary so it fits in width pixels."""
    if draw.textlength(text, font=fnt) <= width:
        return text
    words = text.split(" ")
    while words and draw.textlength(" ".join(words) + " …", font=fnt) > width:
        words.pop()
    return " ".join(words) + " …"


def event_line(light):
    p = light["props"]
    who = "city" if p["notify"] == "city" else "resident"
    where = p["building"] + (f" unit {p['unit']}" if p["unit"] else "")
    return f"{where}  ·  {p['height_m']} m up  ·  notify {who}: {p['fix']}"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--record", action="store_true", help="render demo.mp4 from a chase camera")
    args = ap.parse_args()

    waypoints, lights = load()
    path = flight_path(waypoints)
    gz = Gz()

    names = ["drone_body", "chase_cam"] + [f"mark_{lt['n']}" for lt in lights]
    names += [f"ray_{lt['n']}_{w}" for lt in lights for w in lt["views"]]
    for name in names:
        gz.remove(name)
    time.sleep(0.5)

    x0 = path[0][0]
    drone_rpy = (0, 0, math.pi / 2)
    gz.spawn(model_sdf("drone_body", (x0, scene.DRONE_Y, scene.DRONE_Z), drone_rpy, drone_body_sdf()))
    writer = overlay = None
    if args.record:
        import imageio_ffmpeg

        CHASE_DIR.mkdir(exist_ok=True)
        gz.spawn(model_sdf("chase_cam", (x0 - 16, scene.DRONE_Y - 22, 17), (0, 0, 0), chase_cam_sdf()))
        # The first render after spawning a camera can stall the server for seconds; wait it out.
        gz.chase_frame(timeout=60)
        overlay = Overlay(waypoints, lights)
        writer = imageio_ffmpeg.write_frames(
            str(HERE / "demo.mp4"), (OUT_W, OUT_H), fps=FPS, codec="libx264", quality=8, macro_block_size=8
        )
        writer.send(None)
    else:
        gz.follow("drone_body")

    rays = {lt["n"]: 0 for lt in lights}
    found, events, last_wp, seen_wp = [], [], None, set()
    frame_time = time.monotonic()
    for x, wp in path:
        drone = (x, scene.DRONE_Y, scene.DRONE_Z)
        gz.set_pose(scene.DRONE_NAME, drone, drone_rpy)
        gz.set_pose("drone_body", drone, drone_rpy)
        if wp is not None and wp not in seen_wp:
            seen_wp.add(wp)
            last_wp = wp
            for lt in lights:
                if wp in lt["views"]:
                    rgb = CITY_RGB if lt["props"]["notify"] == "city" else RAY_RGB
                    gz.spawn(ray_sdf(f"ray_{lt['n']}_{wp}", drone, lt["pos"], rgb))
                    rays[lt["n"]] += 1
                    # Two sight lines from different spots fix the light's position.
                    if rays[lt["n"]] == 2:
                        rgb = CITY_RGB if lt["props"]["notify"] == "city" else RESIDENT_RGB
                        gz.spawn(marker_sdf(f"mark_{lt['n']}", lt["pos"], rgb))
                        found.append(lt)
                        events.append(event_line(lt))
                        print(events[-1])
        if args.record:
            cam = (x - 16, scene.DRONE_Y - 22, 17)
            gz.set_pose("chase_cam", cam, look_at(cam, (x + 6, 32, 7)))
            frame = gz.chase_frame()
            writer.send(overlay.draw(frame, x, last_wp, found, events).tobytes())
        else:
            frame_time += 1 / FPS
            time.sleep(max(0.0, frame_time - time.monotonic()))

    if args.record:
        chase = gz.chase_frame()
        for i in range(END_FRAMES):
            alpha = min(1.0, i / FPS)
            writer.send(overlay.draw(chase, path[-1][0], last_wp, found, events, alpha).tobytes())
        writer.close()
        gz.remove("chase_cam")
        for f in CHASE_DIR.iterdir():
            f.unlink(missing_ok=True)
        print(f"wrote {HERE / 'demo.mp4'}")
    print(f"{len(found)} lights located")


if __name__ == "__main__":
    main()
    sys.stdout.flush()
    # ponytail: gz-transport's pybind threads can abort during interpreter teardown; skip teardown once output is written.
    os._exit(0)
