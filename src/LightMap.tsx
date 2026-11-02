import { useEffect } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { SEVERITY_COLOR, type MapLight } from './lights'

const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const CENTER: [number, number] = [26.452, -81.951] // Fort Myers Beach

function ClickToPlace({ onPlace }: { onPlace?: (at: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e) => onPlace?.({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

function FlyTo({ target }: { target?: MapLight }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 17))
  }, [target, map])
  return null
}

type Props = {
  lights: MapLight[]
  placing?: boolean
  onPlace?: (at: { lat: number; lng: number }) => void
  focus?: MapLight
}

export default function LightMap({ lights, placing, onPlace, focus }: Props) {
  const issues = lights.filter((l) => l.severity !== 'ok').length
  const dronePath = lights
    .filter((l) => l.source === 'drone' && l.waypoint != null)
    .sort((a, b) => a.waypoint! - b.waypoint!)
    .map((l) => [l.lat, l.lng] as [number, number])

  return (
    <section id="map" className="lightmap" aria-label="Map of detected lights">
      <div className="lightmap-bar">
        <span>
          <i style={{ background: SEVERITY_COLOR.high }} /> {issues} possible issue{issues !== 1 && 's'}
        </span>
        <span>
          <i style={{ background: SEVERITY_COLOR.ok }} /> {lights.length - issues} OK
        </span>
        {placing && <strong className="lightmap-place">No GPS in that photo. Click the map where you took it.</strong>}
      </div>
      <MapContainer center={CENTER} zoom={16} className={`lightmap-map${placing ? ' placing' : ''}`}>
        <TileLayer url={SAT} attribution="Tiles © Esri" maxZoom={19} />
        <ClickToPlace onPlace={placing ? onPlace : undefined} />
        <FlyTo target={focus} />
        {dronePath.length > 1 && <Polyline positions={dronePath} pathOptions={{ color: 'cyan', dashArray: '6', weight: 3 }} />}
        {lights.map((l) => {
          const color = SEVERITY_COLOR[l.severity]
          return (
            <span key={l.id}>
              <Circle center={[l.lat, l.lng]} radius={12} pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.25 }} />
              <CircleMarker
                center={[l.lat, l.lng]}
                radius={8}
                pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 }}
              >
                <Popup>
                  {l.image && <img src={l.image} alt="" width={200} style={{ display: 'block', borderRadius: 6 }} />}
                  <div style={{ marginTop: 6 }}>
                    <b>{l.severity === 'ok' ? '✅ OK' : `⚠️ Possible issue (${l.severity})`}</b> · {l.label}
                  </div>
                  {l.building && <div>{l.building}</div>}
                  <div>{l.advice}</div>
                  <small>
                    {l.source === 'drone' ? `Drone · waypoint ${l.waypoint ?? '?'}` : 'Phone photo'}
                    {l.notify && ` · notify ${l.notify}`}
                  </small>
                </Popup>
              </CircleMarker>
            </span>
          )
        })}
      </MapContainer>
    </section>
  )
}
