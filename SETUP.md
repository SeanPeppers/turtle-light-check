# Turtle Light Check: setup

## How it works
```
Photo / Gazebo drone frame
  → frontend gets a location (EXIF GPS, browser GPS, click on map, or Gazebo pose CSV)
  → POST /api/analyze  (image + lat + lng)
  → backend sends image to Gemini → JSON list of lights with boxes + "possible_issue"/"ok" + fix tip
  → frontend draws boxes on the photo AND highlights each light on the satellite map
```

## Backend (FastAPI + Gemini)
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # paste GEMINI_API_KEY into .env, never commit it
uvicorn main:app --reload --port 8000
```
No key yet? Leave it blank. The backend runs in **MOCK mode** (boxes the brightest spot, no API call).
Check: http://localhost:8000/api/health

## Frontend (React + Vite + Leaflet)
```bash
cd map-demo
npm install
npm run dev                 # http://localhost:5173, /api is proxied to :8000
```
Click **Load sample pins** to see the map without the backend.

## Drone mode (Gazebo)
1. Record the Gazebo camera flythrough → `flythrough.mp4`
2. Log the drone pose each second → `poses.csv` with columns `t,x,y` (seconds, meters; x = east, y = north). See `tools/sample_poses.csv`.
3. `pip install opencv-python-headless && python tools/extract_frames.py flythrough.mp4 frames/`
4. In the app: **Drone mode** → select all `frames/*.jpg` **and** `poses.csv` together.
   Frame `frame_0007.jpg` is matched to the pose at `t=7`, and Gazebo x/y meters are converted to lat/lng around Fort Myers Beach.

## Shared finding shape (one per detected light)
```js
{ id, lat, lng, status: "possible_issue" | "ok", type, color, bulb_visible,
  fix, box_2d: [ymin, xmin, ymax, xmax] /* 0-1000 */, source: "photo" | "drone", frameTime }
```
