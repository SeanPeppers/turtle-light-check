import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { SEVERITY_COLOR, type MapLight } from './lights'

const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const CENTER: [number, number] = [26.4514, -81.9521] // Fort Myers Beach, by the pier (where the sim flies)

function ClickToPlace({ onPlace }: { onPlace?: (at: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e) => onPlace?.({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

function FlyTo({ target }: { target?: MapLight }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 18))
  }, [target, map])
  return null
}

type Props = {
  lights: MapLight[]
  dronePath?: [number, number][]
  placing?: boolean
  onPlace?: (at: { lat: number; lng: number }) => void
  focus?: MapLight
}

export default function LightMap({ lights, dronePath = [], placing, onPlace, focus }: Props) {
  const [selected, setSelected] = useState<string>()
  const issues = lights.filter((l) => l.severity !== 'ok').length
  const sel = lights.find((l) => l.id === selected)

  return (
    <section id="map" className="lightmap" aria-label="Map of detected lights">
      <div className="lightmap-bar">
        <span>
          <i style={{ background: SEVERITY_COLOR.high }} /> {issues} possible issue{issues !== 1 && 's'}
        </span>
        <span>
          <i style={{ background: SEVERITY_COLOR.ok }} /> {lights.length - issues} OK
        </span>
        {dronePath.length > 1 && (
          <span>
            <i style={{ background: 'cyan' }} /> drone path
          </span>
        )}
        {placing && <strong className="lightmap-place">That photo didn't have a location. Tap the map where you took it.</strong>}
      </div>
      <MapContainer center={CENTER} zoom={18} maxZoom={20} className={`lightmap-map${placing ? ' placing' : ''}`}>
        <TileLayer url={SAT} attribution="Tiles © Esri" maxZoom={20} maxNativeZoom={19} />
        <ClickToPlace onPlace={placing ? onPlace : undefined} />
        <FlyTo target={focus} />

        {dronePath.length > 1 && <Polyline positions={dronePath} pathOptions={{ color: 'cyan', dashArray: '6', weight: 3 }} />}
        {dronePath.map((p, i) => (
          <CircleMarker key={`wp${i}`} center={p} radius={2} pathOptions={{ color: 'cyan', fillOpacity: 1, weight: 1 }} />
        ))}

        {/* sight lines: every drone position that saw the selected light (triangulation) */}
        {sel?.views?.map((v, i) => (
          <Polyline key={`ray${i}`} positions={[v, [sel.lat, sel.lng]]} pathOptions={{ color: '#ffe680', weight: 1, opacity: 0.8 }} />
        ))}

        {lights.map((l) => {
          const color = SEVERITY_COLOR[l.severity]
          return (
            <span key={l.id}>
              <Circle center={[l.lat, l.lng]} radius={3} pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.3 }} />
              <CircleMarker
                center={[l.lat, l.lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 }}
                eventHandlers={{ click: () => setSelected(l.id), popupclose: () => setSelected(undefined) }}
              >
                <Popup>
                  {l.image && <img src={l.image} alt="" width={220} style={{ display: 'block', borderRadius: 6 }} />}
                  <div style={{ marginTop: 6 }}>
                    <b>{l.severity === 'ok' ? '✅ OK' : `⚠️ Possible issue (${l.severity})`}</b> · {l.label}
                  </div>
                  {l.building && <div>{l.building}</div>}
                  {l.rule && <div><i>{l.severity === 'ok' ? 'Passes: ' : 'Rule: '}{l.rule}</i></div>}
                  <div>{l.advice}</div>
                  {l.heightM != null && (
                    <div>
                      {l.heightM.toFixed(1)} m high
                      {l.distanceM != null && ` · ${Math.round(l.distanceM)} m back from the beach`}
                    </div>
                  )}
                  <small>
                    {l.source === 'drone'
                      ? `Spotted by the drone${l.views?.length ? ` from ${l.views.length} spots along the beach` : ''}`
                      : 'From a photo you checked'}
                    {l.notify && ` · who to tell: ${l.notify === 'city' ? 'the city' : 'the resident'}`}
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
