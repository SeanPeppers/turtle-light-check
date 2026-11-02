// One shape for every light on the map, whether it came from a phone photo (Analyzer)
// or from the Gazebo drone sim (sim/detections.geojson).
export type Severity = 'high' | 'medium' | 'low' | 'ok'

export type MapLight = {
  id: string
  lat: number
  lng: number
  label: string
  advice: string
  severity: Severity
  source: 'photo' | 'drone'
  image?: string
  notify?: 'resident' | 'city'
  building?: string
  waypoint?: number
}

// Shape returned by api/analyze.ts
export type Light = { label: string; box_2d: [number, number, number, number]; possibleIssue: boolean; advice: string }
export type Result = { lights: Light[]; summary: string; model?: string }

export const SEVERITY_COLOR: Record<Severity, string> = {
  high: '#ff3b30',
  medium: '#ff9500',
  low: '#ffcc00',
  ok: '#34c759',
}

/** Photo result -> map lights. All lights in one photo share the photo's GPS, so spread
 *  them ±15 m east/west by where they sit in the frame to keep pins from stacking. */
export function photoToMapLights(result: Result, at: { lat: number; lng: number }, image: string): MapLight[] {
  const stamp = Date.now().toString(36)
  return result.lights.map((l, i) => {
    const cx = (l.box_2d[1] + l.box_2d[3]) / 2000 // 0..1 across the image
    const dLng = ((cx - 0.5) * 30) / (111320 * Math.cos((at.lat * Math.PI) / 180))
    return {
      id: `photo-${stamp}-${i}`,
      lat: at.lat,
      lng: at.lng + dLng,
      label: l.label,
      advice: l.advice,
      severity: l.possibleIssue ? 'high' : 'ok',
      source: 'photo',
      image,
    }
  })
}

type SimFeature = {
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    id: string
    building?: string
    unit?: string | null
    light_type?: string
    severity?: Severity
    fix?: string
    notify?: 'resident' | 'city'
    image?: string
    waypoint?: number
  }
}

/** Sim GeoJSON -> map lights. GeoJSON is [lng, lat]; Leaflet wants [lat, lng]. */
export function simToMapLights(geo: { features: SimFeature[] }, images: Record<string, string> = {}): MapLight[] {
  return geo.features
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => {
      const p = f.properties
      const [lng, lat] = f.geometry.coordinates
      return {
        id: `drone-${p.id}`,
        lat,
        lng,
        label: p.light_type ?? 'light',
        advice: p.fix ?? '',
        severity: p.severity ?? 'medium',
        source: 'drone',
        notify: p.notify,
        building: [p.building, p.unit].filter(Boolean).join(' · ') || undefined,
        waypoint: p.waypoint,
        image: p.image ? images[`../sim/${p.image}`] : undefined,
      }
    })
}
