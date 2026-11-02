"""Turn Gemini boxes plus the drone's pose into real-world light positions.

The drone flies a straight line along the shore at fixed height, facing inland,
so two frames taken a few metres apart form a stereo pair with a horizontal
baseline: the same light sits on the same image row in both, shifted sideways
by a disparity that is inversely proportional to its distance. That gives each
light's position from the drone's GPS track and pixels alone, with no prior
knowledge of where the buildings are.

Pure geometry, no Gazebo or Gemini imports, so it is testable anywhere.
"""

import math

import scene

FOCAL_PX = (scene.IMAGE_W / 2) / math.tan(scene.HFOV / 2)
MIN_DEPTH_M = 15.0
MAX_DEPTH_M = 80.0
ROW_TOLERANCE_PX = 35.0
REPROJ_TOLERANCE_PX = 30.0
MIN_VIEWS = 4


def project(pos, cam_x):
    """Pixel (u, v) of a world point seen from the drone at x=cam_x."""
    x, y, z = pos
    depth = y - scene.DRONE_Y
    u = scene.IMAGE_W / 2 + FOCAL_PX * (x - cam_x) / depth
    v = scene.IMAGE_H / 2 - FOCAL_PX * (z - scene.DRONE_Z) / depth
    return u, v


def box_center_px(box_2d):
    ymin, xmin, ymax, xmax = box_2d
    return (xmin + xmax) / 2 / 1000 * scene.IMAGE_W, (ymin + ymax) / 2 / 1000 * scene.IMAGE_H


def ray(u, v):
    """Direction of a pixel as (right, up) slopes per metre forward."""
    return (u - scene.IMAGE_W / 2) / FOCAL_PX, (scene.IMAGE_H / 2 - v) / FOCAL_PX


def bearing_deg(u):
    """Bearing to a pixel column relative to where the drone faces; add the drone heading for a compass bearing."""
    a, _ = ray(u, 0)
    return math.degrees(math.atan(a)) % 360


def triangulate(u1, v1, x1, u2, v2, x2):
    """World point seen at pixel (u1, v1) from x1 and (u2, v2) from x2, or None if inconsistent."""
    a1, b1 = ray(u1, v1)
    a2, b2 = ray(u2, v2)
    if abs(a1 - a2) < 1e-9:
        return None
    depth = (x2 - x1) / (a1 - a2)
    if not MIN_DEPTH_M <= depth <= MAX_DEPTH_M:
        return None
    x = x1 + a1 * depth
    z = scene.DRONE_Z + (b1 + b2) / 2 * depth
    return (x, scene.DRONE_Y + depth, z)


def pair_hypotheses(frames):
    """Candidate 3D points from same-row detection pairs in frames one or two waypoints apart.

    Two apart covers a light Gemini missed in the frame between.
    """
    hyps = []
    for fa, fb in [*zip(frames, frames[1:]), *zip(frames, frames[2:])]:
        for da in fa["detections"]:
            ua, va = box_center_px(da["box_2d"])
            for db in fb["detections"]:
                ub, vb = box_center_px(db["box_2d"])
                if abs(va - vb) > ROW_TOLERANCE_PX:
                    continue
                p = triangulate(ua, va, fa["x"], ub, vb, fb["x"])
                if p is not None:
                    hyps.append(p)
    return hyps


def support(point, frames):
    """(frame index, detection index, reprojection error px) for every frame where a box sits on the point."""
    out = []
    for fi, f in enumerate(frames):
        u, v = project(point, f["x"])
        if not (0 <= u < scene.IMAGE_W and 0 <= v < scene.IMAGE_H):
            continue
        best = None
        for di, d in enumerate(f["detections"]):
            du, dv = box_center_px(d["box_2d"])
            err = math.hypot(du - u, dv - v)
            if err <= REPROJ_TOLERANCE_PX and (best is None or err < best[2]):
                best = (fi, di, err)
        if best:
            out.append(best)
    return out


def refine(views, frames):
    """Least-squares point from all views: X - a_i*D = x_i and Z - b_i*D = z_drone, D = depth."""
    rows = []
    for fi, di in views:
        u, v = box_center_px(frames[fi]["detections"][di]["box_2d"])
        a, b = ray(u, v)
        rows.append((a, b, frames[fi]["x"]))
    n = len(rows)
    sa = sum(a for a, _, _ in rows)
    saa = sum(a * a for a, _, _ in rows)
    sx = sum(x for _, _, x in rows)
    sax = sum(a * x for a, _, x in rows)
    det = n * saa - sa * sa
    if abs(det) < 1e-12:
        return None
    depth = (sa * sx - n * sax) / det
    x = (sx + sa * depth) / n
    z = scene.DRONE_Z + sum(b for _, b, _ in rows) / n * depth
    if not MIN_DEPTH_M <= depth <= MAX_DEPTH_M:
        return None
    return (x, scene.DRONE_Y + depth, z)


def locate_lights(frames):
    """Find every light seen in at least MIN_VIEWS frames.

    frames: [{"x": drone x, "detections": [{"box_2d": [...]}, ...]}, ...] in flight order.
    Each neighbouring-frame pair proposes a point; a proposal is kept only if it
    reprojects onto boxes in other frames too, so a wrong pairing of two lights on
    one floor finds no support and is dropped. Strongest proposals claim their
    boxes first. Returns [{"point": (x, y, z), "views": [(frame index, detection index), ...]}].
    """
    scored = []
    for p in pair_hypotheses(frames):
        s = support(p, frames)
        if len(s) >= MIN_VIEWS:
            scored.append((-len(s), sum(e for _, _, e in s) / len(s), p, s))
    scored.sort(key=lambda t: (t[0], t[1]))

    used, lights = set(), []
    for _, _, p, s in scored:
        views = [(fi, di) for fi, di, _ in s if (fi, di) not in used]
        if len(views) < MIN_VIEWS:
            continue
        point = refine(views, frames)
        if point is None:
            continue
        final = [(fi, di) for fi, di, _ in support(point, frames) if (fi, di) not in used]
        if len(final) < MIN_VIEWS:
            continue
        point = refine(final, frames)
        if point is None:
            continue
        # Keep only views that still agree with the refined point.
        agree = {(fi, di) for fi, di, _ in support(point, frames)}
        final = [v for v in final if v in agree]
        if len(final) < MIN_VIEWS:
            continue
        used.update(final)
        lights.append({"point": point, "views": final})
    return lights


def nearest_fixture(point, fixtures, max_m=4.0):
    """Address lookup: the known window or streetlight closest to a located light.

    In the real world this is a parcel or building-footprint lookup; here the
    scene's fixture list plays that role.
    """
    best = min(fixtures, key=lambda f: math.dist(f["pos"], point))
    return best if math.dist(best["pos"], point) <= max_m else None
