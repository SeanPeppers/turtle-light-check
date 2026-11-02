import { simToMapLights, type MapLight } from './lights'

// Uses the real sim output (sim/detections.geojson) when it exists, else the sample.
// Vite resolves these at build time, so nothing has to be copied into public/.
const files = import.meta.glob('../sim/detections*.geojson', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const images = import.meta.glob('../sim/captures/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>

const raw = files['../sim/detections.geojson'] ?? files['../sim/detections.sample.geojson']

export const SIM_IS_SAMPLE = !files['../sim/detections.geojson']
export const SIM_LIGHTS: MapLight[] = raw ? simToMapLights(JSON.parse(raw), images) : []
