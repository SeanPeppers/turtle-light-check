# Gazebo drone simulation

A simulated drone flies along a beach at night, facing inland, and photographs the buildings behind the dunes at 25 waypoints 8 m apart. Gemini boxes every artificial light in each photo. Because the drone's GPS position is known at every waypoint, the same light seen from several waypoints is triangulated into a real position (latitude, longitude, height). The position comes from the drone track and pixels only; the scene's building list is used afterwards to name the unit (standing in for a parcel lookup) and to score the run.

Last full run: 9 of 9 lit lights found, 0 false alarms, 0.29 m mean location error, 3 Gemini requests.

## Output for the Leaflet map

All files are committed, so the map can be built without running Gazebo. Coordinates are `[longitude, latitude]` (GeoJSON order, the reverse of Leaflet's `[lat, lng]`). Both files load directly with `L.geoJSON(data)`. Image paths are relative to `sim/`.

### `detections.geojson`: one point per located light

| property | meaning |
|---|---|
| `id` | stable id, e.g. `condo-2-unit-403` or `streetlight-1` |
| `building`, `unit` | where the light is; `unit` is null for public lights |
| `notify` | `resident` for private property, `city` for public lighting |
| `light_type`, `severity`, `fix` | Gemini's description, `high`/`medium`/`low`, and a one-sentence fix |
| `height_m` | height of the light above the sand |
| `distance_from_drone_m` | distance inland from the flight line |
| `image`, `box_2d` | best photo of the light and its box in that photo |
| `views` | every photo the light was triangulated from (see below) |

Each entry in `views`: `waypoint`, `image`, `drone` (`[lon, lat, altitude_m]`), `heading_deg` (0 = north), `bearing_deg` (compass bearing from the drone to the light), `box_2d`. A map can draw a line from each `drone` point along `bearing_deg` to show the sight lines meeting at the light.

`box_2d` is Gemini's format: `[ymin, xmin, ymax, xmax]` scaled 0 to 1000. To draw it on an image of width W and height H: `left = xmin/1000*W`, `top = ymin/1000*H`.

### `flight.geojson`: the drone track

One point per waypoint with `waypoint`, `altitude_m`, `heading_deg`, `hfov_deg`, `image`, `image_size`, and the raw Gemini `detections` for that photo.

`detections.sample.geojson` is the original hand-written example of the format.

## Running it

```bash
docker build -t turtle-sim sim/          # once, about 2 GB
sim/run.sh                               # shell in the container; sim/ is mounted at /sim
```

Inside the container:

```bash
python3 scene.py                         # writes world.sdf from the fixture list
python3 test_locate.py                   # geometry self-check, no Gazebo or Gemini needed
gz sim -r world.sdf &                    # Gazebo with GUI; use `gz sim -s -r --headless-rendering world.sdf &` for no window
python3 fly.py                           # flies, calls Gemini, writes the two GeoJSON files
```

`run.sh` passes the X display and `/dev/dri` through and loads `GEMINI_API_KEY` from the repo's `.env`. `GEMINI_MODEL` overrides the model (default `gemini-3.5-flash-lite`, which answered fastest on 2026-11-02).

## Gemini quota

The free tier allows 20 requests per model per day. `fly.py` sends 9 photos per request (3 per flight) and caches answers in `captures/gemini_cache.json`, keyed on the world, model, prompt and waypoint, so rerunning an unchanged scene costs nothing. On a 429 it stops with a message instead of retrying; switch `GEMINI_MODEL`, use another key, or enable billing.

## Files

| file | purpose |
|---|---|
| `scene.py` | the beach: buildings, lit windows, streetlights, drone, flight path; writes `world.sdf` |
| `locate.py` | pure geometry: pixel to ray, two-view triangulation, multi-view verification, least squares |
| `fly.py` | drives the drone, calls Gemini, writes the GeoJSON |
| `test_locate.py` | checks the geometry against the scene with exact, noisy, missing and invented boxes |
