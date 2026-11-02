# Gazebo drone simulation

A simulated drone flies along the beach at night and photographs the buildings behind the dunes. Each frame goes to Gemini, which boxes every light source visible from the beach. The sim knows where each building sits, so each box is matched to a building and turned into latitude and longitude.

## Output contract (for the Leaflet map)

The sim writes `detections.geojson`, a GeoJSON FeatureCollection that Leaflet loads directly with `L.geoJSON(data)`. `detections.sample.geojson` shows the shape; build the map against it until the real file exists.

Coordinates are `[longitude, latitude]` (GeoJSON order, the reverse of Leaflet's `[lat, lng]`).

| property | meaning |
|---|---|
| `id` | stable id for the light |
| `building`, `unit` | where the light is; `unit` is null for public lights |
| `light_type` | Gemini's description of the source |
| `severity` | `high`, `medium`, or `low` |
| `fix` | suggested fix, written for whoever gets notified |
| `notify` | `resident` for private property, `city` for public lighting |
| `image` | capture the light was found in, relative to `sim/` |
| `box_2d` | Gemini box `[ymin, xmin, ymax, xmax]`, scaled 0 to 1000 |
| `waypoint` | drone waypoint number |

The sample coordinates are placeholders near Fort Myers Beach.
