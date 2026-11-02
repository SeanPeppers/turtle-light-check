import { useEffect, useState } from "react";
import TurtleMap from "./TurtleMap.jsx";
import ImageBoxes from "./ImageBoxes.jsx";
import { analyzeImage, health } from "./api.js";
import { gpsFromPhoto, gpsFromBrowser, parsePosesCsv, frameTimeFromName, poseAt } from "./geo.js";
import { SAMPLE_FINDINGS } from "./sampleFindings.js";

export default function App() {
  const [findings, setFindings] = useState([]);
  const [dronePath, setDronePath] = useState([]);
  const [selected, setSelected] = useState(null); // { src, findings, summary }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null); // photo waiting for a map click (no GPS)
  const [focus, setFocus] = useState(null);
  const [backend, setBackend] = useState(null);

  useEffect(() => { health().then(setBackend).catch(() => setBackend({ ok: false })); }, []);

  async function runAnalysis(file, loc, extra = {}) {
    const src = URL.createObjectURL(file);
    const res = await analyzeImage(file, { ...loc, ...extra });
    const withImg = res.findings.map((f) => ({ ...f, image: src }));
    setFindings((prev) => [...prev, ...withImg]);
    setSelected({ src, findings: withImg, summary: res.summary, mock: res.mock });
    if (withImg[0]?.lat != null) setFocus(withImg[0]);
    return withImg;
  }

  // Photo mode: EXIF GPS -> browser GPS -> ask user to click the map
  async function onPhotos(e) {
    const files = [...e.target.files];
    e.target.value = "";
    setError("");
    for (const file of files) {
      setBusy(`Analyzing ${file.name}…`);
      try {
        const loc = (await gpsFromPhoto(file)) || (files.length === 1 ? await gpsFromBrowser() : null);
        if (!loc) {
          setPending(file);
          setBusy("");
          return; // wait for map click
        }
        await runAnalysis(file, loc, { source: "photo" });
      } catch (err) {
        setError(err.message);
      }
    }
    setBusy("");
  }

  async function onMapClick(latlng) {
    if (!pending) return;
    const file = pending;
    setPending(null);
    setBusy(`Analyzing ${file.name}…`);
    try {
      await runAnalysis(file, { lat: latlng.lat, lng: latlng.lng }, { source: "photo" });
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  }

  // Drone mode: frames (frame_0003.jpg …) + poses.csv (t,x,y) from Gazebo
  async function onDrone(e) {
    const files = [...e.target.files];
    e.target.value = "";
    setError("");
    const csv = files.find((f) => f.name.endsWith(".csv"));
    const frames = files.filter((f) => /\.(jpe?g|png)$/i.test(f.name))
      .sort((a, b) => (frameTimeFromName(a.name) ?? 0) - (frameTimeFromName(b.name) ?? 0));
    if (!csv || !frames.length) return setError("Select the frame images AND poses.csv together.");
    try {
      const poses = parsePosesCsv(await csv.text());
      setDronePath(poses);
      for (const [i, frame] of frames.entries()) {
        const t = frameTimeFromName(frame.name) ?? i;
        const p = poseAt(poses, t);
        setBusy(`Drone frame ${i + 1}/${frames.length} (t=${t}s)…`);
        await runAnalysis(frame, { lat: p.lat, lng: p.lng }, { source: "drone", frameTime: t });
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  }

  const issues = findings.filter((f) => f.status === "possible_issue");

  return (
    <div className="app">
      <header>
        <h1>🐢 Turtle Light Check</h1>
        <p>Spot beach-facing lights that can lead hatchlings away from the Gulf.</p>
        <span className={`pill ${backend?.ok ? "on" : "off"}`}>
          {backend == null ? "checking backend…" : !backend.ok ? "backend offline" : backend.mock ? "backend: MOCK mode" : `backend: ${backend.model}`}
        </span>
      </header>

      <div className="layout">
        <aside>
          <label className="btn primary">
            📷 Check a photo
            <input type="file" accept="image/*" multiple hidden onChange={onPhotos} />
          </label>
          <label className="btn">
            🚁 Drone mode (frames + poses.csv)
            <input type="file" accept="image/*,.csv" multiple hidden onChange={onDrone} />
          </label>
          <button className="btn" onClick={() => { setFindings(SAMPLE_FINDINGS); setFocus(SAMPLE_FINDINGS[0]); }}>
            Load sample pins
          </button>
          <button className="btn" onClick={() => { setFindings([]); setDronePath([]); setSelected(null); }}>
            Clear
          </button>

          {busy && <div className="note">{busy}</div>}
          {pending && <div className="note warn">No GPS in {pending.name}. Click the map where you took it.</div>}
          {error && <div className="note err">{error}</div>}

          {selected && (
            <div className="result">
              <ImageBoxes src={selected.src} findings={selected.findings} />
              <p><b>{selected.summary}</b>{selected.mock && " (mock)"}</p>
              <ol>
                {selected.findings.map((f) => (
                  <li key={f.id} className={f.status}>
                    {f.status === "possible_issue" ? "⚠️ Possible issue" : "✅ OK"} — {f.type}, {f.color}. {f.fix}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="fine">
            {issues.length} possible issue{issues.length !== 1 && "s"} found. Results are “possible issues,” not
            violations. Check your local sea turtle lighting ordinance.
          </p>
        </aside>

        <main>
          <TurtleMap
            findings={findings}
            dronePath={dronePath}
            onMapClick={onMapClick}
            focus={focus}
            onSelect={(f) => f.image && setSelected({ src: f.image, findings: findings.filter((x) => x.image === f.image), summary: "" })}
          />
        </main>
      </div>
    </div>
  );
}

