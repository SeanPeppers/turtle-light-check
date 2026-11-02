// Calls the FastAPI backend (proxied by Vite). Set VITE_API_URL when deployed.
const BASE = import.meta.env.VITE_API_URL || "";

export async function analyzeImage(file, { lat, lng, source = "photo", frameTime = null } = {}) {
  const fd = new FormData();
  fd.append("file", file);
  if (lat != null && lng != null) {
    fd.append("lat", lat);
    fd.append("lng", lng);
  }
  fd.append("source", source);
  if (frameTime != null) fd.append("frame_time", frameTime);

  const res = await fetch(`${BASE}/api/analyze`, { method: "POST", body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
  return res.json(); // { summary, width, height, mock, findings: [...] }
}

export async function health() {
  const res = await fetch(`${BASE}/api/health`);
  return res.json();
}
