"""Single source of truth for the beach scene.

Running this file writes world.sdf. fly.py imports the same fixture list to turn
Gemini's boxes back into map coordinates, so the two never drift apart.

World frame: x runs along the shore (east), y points inland (north), z is up.
The Gulf is at y < 0, the dunes at y ~ 12, the buildings at y ~ 40.
"""

import math
from pathlib import Path

# Real location: the sand in front of the Lani Kai, just south-east of the Fort Myers Beach pier
# (OpenStreetMap: Lani Kai 26.4513, -81.9517; pier 26.4526, -81.9566), moved 40 m toward the Gulf.
# The shore there runs south-east, 125 degrees, measured from Pink Shell Beach Resort to Outrigger
# Beach Resort, so the world's +x (along the shore) points 125 degrees and +y (inland) points 35 degrees.
# The buildings themselves are synthetic.
ORIGIN_LAT = 26.45101
ORIGIN_LON = -81.95197
SHORE_BEARING_DEG = 125.0
INLAND_BEARING_DEG = SHORE_BEARING_DEG - 90.0

WORLD_NAME = "beach"
DRONE_NAME = "drone"
DRONE_Y = -6.0
DRONE_Z = 9.0
CAMERA_TOPIC = "/drone/camera"
IMAGE_W = 1280
IMAGE_H = 720
HFOV = 1.4  # radians

BUILDING_Y = 40.0
BUILDING_SIZE = (22.0, 14.0, 18.0)  # width along shore, depth, height
FLOORS = 4
UNITS_PER_FLOOR = 4

# Which units leave beach-facing lights on, keyed by (building index, floor, unit).
LIT_UNITS = {(0, 2, 1), (1, 3, 2), (1, 1, 0), (3, 0, 3), (3, 2, 2), (4, 3, 1)}
BUILDING_XS = [-64.0, -32.0, 0.0, 32.0, 64.0]
STREETLIGHT_XS = [-48.0, 16.0, 48.0]
STREETLIGHT_Y = 26.0
STREETLIGHT_H = 7.0

# Flight path runs a full camera footprint past the end buildings so every light is seen in several frames.
WAYPOINT_SPACING_M = 8
WAYPOINT_XS = list(range(-96, 97, WAYPOINT_SPACING_M))


def to_lat_lon(x: float, y: float) -> tuple[float, float]:
    shore, inland = math.radians(SHORE_BEARING_DEG), math.radians(INLAND_BEARING_DEG)
    east = x * math.sin(shore) + y * math.sin(inland)
    north = x * math.cos(shore) + y * math.cos(inland)
    lat = ORIGIN_LAT + north / 111_320.0
    lon = ORIGIN_LON + east / (111_320.0 * math.cos(math.radians(ORIGIN_LAT)))
    return lat, lon


def fixtures() -> list[dict]:
    """Every light that could be seen from the beach, lit or not."""
    out = []
    w, d, h = BUILDING_SIZE
    face_y = BUILDING_Y - d / 2 - 0.05
    for b, bx in enumerate(BUILDING_XS):
        for floor in range(FLOORS):
            for unit in range(UNITS_PER_FLOOR):
                x = bx - w / 2 + (unit + 0.5) * w / UNITS_PER_FLOOR
                z = 2.5 + floor * (h - 2.0) / FLOORS
                out.append(
                    {
                        "id": f"condo-{b + 1}-unit-{floor + 1}0{unit + 1}",
                        "building": f"Condo {b + 1}",
                        "unit": f"{floor + 1}0{unit + 1}",
                        "kind": "window",
                        "lit": (b, floor, unit) in LIT_UNITS,
                        "pos": (x, face_y, z),
                        "notify": "resident",
                    }
                )
    for i, sx in enumerate(STREETLIGHT_XS):
        out.append(
            {
                "id": f"streetlight-{i + 1}",
                "building": "Estero Blvd streetlight",
                "unit": None,
                "kind": "streetlight",
                "lit": True,
                "pos": (sx, STREETLIGHT_Y, STREETLIGHT_H),
                "notify": "city",
            }
        )
    return out


def _box(name, pose, size, color, emissive=None, static=True):
    ems = f"<emissive>{emissive}</emissive>" if emissive else ""
    x, y, z = pose
    sx, sy, sz = size
    return f"""
    <model name="{name}">
      <static>{"true" if static else "false"}</static>
      <pose>{x} {y} {z} 0 0 0</pose>
      <link name="link">
        <visual name="v">
          <geometry><box><size>{sx} {sy} {sz}</size></box></geometry>
          <material><ambient>{color}</ambient><diffuse>{color}</diffuse>{ems}</material>
        </visual>
      </link>
    </model>"""


def _point_light(name, pos, color="1 0.85 0.55 1", rng=25):
    x, y, z = pos
    return f"""
    <light type="point" name="{name}">
      <pose>{x} {y} {z} 0 0 0</pose>
      <diffuse>{color}</diffuse>
      <specular>0.2 0.2 0.2 1</specular>
      <attenuation><range>{rng}</range><constant>0.3</constant><linear>0.05</linear><quadratic>0.002</quadratic></attenuation>
      <cast_shadows>false</cast_shadows>
    </light>"""


def world_sdf() -> str:
    parts = []
    parts.append(_box("ocean", (0, -60, -0.4), (400, 100, 0.2), "0.02 0.06 0.12 1"))
    parts.append(_box("sand", (0, 25, -0.5), (400, 70, 0.2), "0.35 0.32 0.25 1"))
    for i, x in enumerate(range(-90, 91, 30)):
        parts.append(_box(f"dune_{i}", (x, 12, 0.6), (26, 5, 1.6), "0.25 0.27 0.18 1"))

    w, d, h = BUILDING_SIZE
    for b, bx in enumerate(BUILDING_XS):
        parts.append(_box(f"condo_{b + 1}", (bx, BUILDING_Y, h / 2), (w, d, h), "0.18 0.18 0.2 1"))

    win_w = w / UNITS_PER_FLOOR * 0.6
    for f in fixtures():
        x, y, z = f["pos"]
        if f["kind"] == "window":
            if f["lit"]:
                parts.append(_box(f["id"], (x, y, z), (win_w, 0.1, 1.8), "1 0.85 0.5 1", "1 0.85 0.5 1"))
                parts.append(_point_light(f"{f['id']}_light", (x, y - 1.0, z)))
            else:
                parts.append(_box(f["id"], (x, y, z), (win_w, 0.1, 1.8), "0.05 0.06 0.08 1"))
        else:
            parts.append(_box(f"{f['id']}_pole", (x, y, z / 2), (0.3, 0.3, z), "0.3 0.3 0.3 1"))
            parts.append(_box(f["id"], (x, y, z + 0.2), (1.2, 0.6, 0.3), "1 0.95 0.8 1", "1 0.95 0.8 1"))
            parts.append(_point_light(f"{f['id']}_light", (x, y, z - 0.5), "1 0.95 0.85 1", 40))

    drone = f"""
    <model name="{DRONE_NAME}">
      <static>true</static>
      <pose>{BUILDING_XS[0]} {DRONE_Y} {DRONE_Z} 0 0 1.5708</pose>
      <link name="body">
        <visual name="v">
          <geometry><box><size>0.6 0.6 0.15</size></box></geometry>
          <material><ambient>0.8 0.1 0.1 1</ambient><diffuse>0.8 0.1 0.1 1</diffuse><emissive>0.6 0 0 1</emissive></material>
        </visual>
        <sensor name="camera" type="camera">
          <topic>{CAMERA_TOPIC}</topic>
          <update_rate>5</update_rate>
          <always_on>true</always_on>
          <camera>
            <horizontal_fov>{HFOV}</horizontal_fov>
            <image><width>{IMAGE_W}</width><height>{IMAGE_H}</height><format>R8G8B8</format></image>
            <clip><near>0.1</near><far>300</far></clip>
          </camera>
        </sensor>
      </link>
    </model>"""
    parts.append(drone)

    return f"""<?xml version="1.0"?>
<sdf version="1.9">
  <world name="{WORLD_NAME}">
    <spherical_coordinates>
      <surface_model>EARTH_WGS84</surface_model>
      <world_frame_orientation>ENU</world_frame_orientation>
      <latitude_deg>{ORIGIN_LAT}</latitude_deg>
      <longitude_deg>{ORIGIN_LON}</longitude_deg>
      <elevation>0</elevation>
    </spherical_coordinates>
    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>
    <plugin filename="gz-sim-user-commands-system" name="gz::sim::systems::UserCommands"/>
    <plugin filename="gz-sim-scene-broadcaster-system" name="gz::sim::systems::SceneBroadcaster"/>
    <plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors">
      <render_engine>ogre2</render_engine>
    </plugin>
    <scene>
      <ambient>0.05 0.05 0.08 1</ambient>
      <background>0.01 0.01 0.03 1</background>
      <grid>false</grid>
      <shadows>false</shadows>
    </scene>
    <light type="directional" name="moon">
      <pose>0 -50 80 0 0 0</pose>
      <diffuse>0.12 0.12 0.18 1</diffuse>
      <specular>0 0 0 1</specular>
      <direction>0.2 0.6 -1</direction>
      <cast_shadows>false</cast_shadows>
    </light>
    {"".join(parts)}
  </world>
</sdf>
"""


if __name__ == "__main__":
    out = Path(__file__).with_name("world.sdf")
    out.write_text(world_sdf())
    lit = sum(f["lit"] for f in fixtures())
    print(f"wrote {out} ({len(fixtures())} fixtures, {lit} lit)")
