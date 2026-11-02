import { useEffect } from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
import { ORIGIN } from "./geo.js";

const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const RED = "#ff3b30";
const GREEN = "#34c759";

// Lets the user click the map to place a photo that had no GPS.
function ClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick?.(e.latlng) });
  return null;
}

// Pan to the newest light.
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 17));
  }, [target, map]);
  return null;
}

export default function TurtleMap({ findings = [], dronePath = [], onMapClick, onSelect, focus }) {
  const placed = findings.filter((f) => f.lat != null && f.lng != null);
  const issues = placed.filter((f) => f.status === "possible_issue").length;

  return (
    <div className="map-wrap">
      <div className="map-stats">
        <span className="dot" style={{ background: RED }} /> {issues} possible issue{issues !== 1 && "s"}
        <span className="dot" style={{ background: GREEN, marginLeft: 12 }} /> {placed.length - issues} OK
      </div>
      <MapContainer center={[ORIGIN.lat, ORIGIN.lng]} zoom={15} className="map">
        <TileLayer url={SAT} attribution="Tiles © Esri" maxZoom={19} />
        <ClickHandler onMapClick={onMapClick} />
        <FlyTo target={focus} />

        {dronePath.length > 1 && (
          <Polyline positions={dronePath.map((p) => [p.lat, p.lng])} pathOptions={{ color: "cyan", dashArray: "6", weight: 3 }} />
        )}

        {placed.map((f) => {
          const color = f.status === "possible_issue" ? RED : GREEN;
          return (
            <span key={f.id}>
              {/* soft glow = "the light is here" */}
              <Circle center={[f.lat, f.lng]} radius={12} pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.25 }} />
              <CircleMarker
                center={[f.lat, f.lng]}
                radius={8}
                pathOptions={{ color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 }}
                eventHandlers={{ click: () => onSelect?.(f) }}
              >
                <Popup>
                  {f.image && <img src={f.image} width={180} style={{ display: "block", borderRadius: 6 }} />}
                  <div style={{ marginTop: 6 }}>
                    <b>{f.status === "possible_issue" ? "⚠️ Possible issue" : "✅ OK"}</b> · {f.type} · {f.color}
                  </div>
                  <div>{f.fix}</div>
                  {f.source === "drone" && <small>Drone frame @ {f.frameTime}s</small>}
                </Popup>
              </CircleMarker>
            </span>
          );
        })}
      </MapContainer>
    </div>
  );
}
