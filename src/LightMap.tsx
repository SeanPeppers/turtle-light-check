import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Trash2 } from 'lucide-react'

const KINDS = ['Streetlight', 'Porch or building light', 'Parking lot light', 'Other'] as const
type Pin = { id: number; kind: string; lat: number; lng: number }

// ponytail: pins live in memory only; add a backend/localStorage when they need to persist.
export default function LightMap() {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef(new Map<number, L.CircleMarker>())
  const kind = useRef<string>(KINDS[0])
  const nextId = useRef(1)
  const [pins, setPins] = useState<Pin[]>([])

  useEffect(() => {
    const m = L.map(el.current!).setView([26.45, -82.03], 11) // Sanibel → Fort Myers Beach
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      const pin = { id: nextId.current++, kind: kind.current, lat: e.latlng.lat, lng: e.latlng.lng }
      markers.current.set(
        pin.id,
        L.circleMarker(e.latlng, { radius: 9, color: '#ff5a5a', fillColor: '#ffd166', fillOpacity: 0.9 })
          .bindTooltip(pin.kind)
          .addTo(m),
      )
      setPins((p) => [...p, pin])
    })
    map.current = m
    const markerMap = markers.current
    return () => {
      m.remove()
      markerMap.clear()
    }
  }, [])

  function remove(id: number) {
    markers.current.get(id)?.remove()
    markers.current.delete(id)
    setPins((p) => p.filter((x) => x.id !== id))
  }

  return (
    <section id="map" className="card">
      <h2>Map the lights</h2>
      <p>Pick a light type, then click the map where a light shines toward the beach.</p>
      <label>
        Light type{' '}
        <select onChange={(e) => (kind.current = e.target.value)}>
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <div ref={el} className="map" role="application" aria-label="Interactive map: click to mark a light" />
      <ul aria-live="polite">
        {pins.map((p) => (
          <li key={p.id}>
            <strong>{p.kind}</strong> — {p.lat.toFixed(5)}, {p.lng.toFixed(5)}{' '}
            <button type="button" onClick={() => remove(p.id)} aria-label={`Remove ${p.kind} at ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}>
              <Trash2 aria-hidden size={16} />
            </button>
          </li>
        ))}
      </ul>
      <small>Hatchlings crawl toward the brightest horizon; lights visible from the beach can lead them inland.</small>
    </section>
  )
}
