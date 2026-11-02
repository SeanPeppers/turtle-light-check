import { flightToPath, simToMapLights, type MapLight } from './lights'

// Uses the real sim output (sim/detections.geojson) when it exists, else the sample.
// Vite resolves these at build time, so nothing has to be copied into public/.
const files = import.meta.glob('../sim/{detections,flight}*.geojson', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const images = import.meta.glob('../sim/captures/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>

const raw = files['../sim/detections.geojson'] ?? files['../sim/detections.sample.geojson']
const flight = files['../sim/flight.geojson']

export const SIM_IS_SAMPLE = !files['../sim/detections.geojson']
export const SIM_LIGHTS: MapLight[] = raw ? simToMapLights(JSON.parse(raw), images) : []
/** Drone track from flight.geojson; falls back to connecting detections by waypoint. */
export const DRONE_PATH: [number, number][] = flight
  ? flightToPath(JSON.parse(flight))
  : SIM_LIGHTS.filter((l) => l.waypoint != null)
      .sort((a, b) => a.waypoint! - b.waypoint!)
      .map((l) => [l.lat, l.lng])
