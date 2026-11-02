# Turtle Light Check: setup

## How it fits together
```
Phone photo ──► src/Analyzer.tsx ──► /api/analyze (api/analyze.ts → Gemini) ──► boxes on the photo
                     │                                                              │
                     └── GPS from photo EXIF (or click the map) ──────────────────► src/LightMap.tsx
Gazebo drone sim ──► sim/detections.geojson ──────────────────────────────────────► src/LightMap.tsx
```
- **Frontend:** Vite + React 19 + TypeScript at the repo root. A 3D hero, the photo analyzer, and the satellite map.
- **Gemini:** `api/analyze.ts`. It runs as a Vercel serverless function in production and through a small Vite plugin in `pnpm dev`. It defaults to `gemini-3.8-flash`, retries 429/503 errors (waiting 1s, 2s, then 4s), then falls back to `gemini-3.6-flash`.
- **Map:** `src/LightMap.tsx` shows every light as a highlighted pin (red/orange/yellow = possible issue by severity, green = OK). The drone's path is a dashed line. `src/lights.ts` converts both photo results and sim GeoJSON into one `MapLight` shape.
- **Sim:** writes `sim/detections.geojson` in the format described in `sim/README.md`. The map loads it automatically, falling back to `detections.sample.geojson`. Capture images in `sim/captures/` show up in the map popups.

## Run it
```bash
cp .env.example .env     # paste GEMINI_API_KEY (never commit .env)
pnpm install
pnpm dev                 # http://localhost:5173. /api/analyze works locally too
```

## Deploy
Push to Vercel and set `GEMINI_API_KEY` in Project → Settings → Environment Variables.

## Optional: prompt test bench
`backend/` is a standalone FastAPI version of the analyzer (`/api/analyze`, multipart upload) used for quick prompt testing with curl:
```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python -m uvicorn main:app --reload --port 8000
curl -F "file=@test_images/porch_bare.jpg" http://localhost:8000/api/analyze
```
The app doesn't use it. If you change the prompt there, copy it into `api/analyze.ts`.
