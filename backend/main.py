"""Turtle Light Check backend.

POST /api/analyze  (multipart: file, lat?, lng?, source?, frame_time?)
  -> Gemini finds light sources, returns findings in the shared contract shape.

Runs in MOCK mode (bright-pixel detector, no API calls) if GEMINI_API_KEY is
missing or MOCK=1, so the frontend works before the key is wired up.
"""
import io
import json
import math
import os
import time
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from PIL import Image

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")  # check the exact name in AI Studio
MOCK = os.getenv("MOCK", "0") == "1" or not API_KEY
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.8-flash")
MAX_SIDE = 1600  # downscale big phone photos for speed

PROMPT = """You are checking a night photo for lights that could disorient sea turtle
hatchlings on a Southwest Florida beach (Sanibel / Fort Myers Beach).
Wildlife-lighting guidance: "Keep it low, keep it long, keep it shielded" —
fixtures should be mounted low, use long-wavelength (amber/red) light, and the
bulb itself should not be directly visible from the beach.

Find every artificial light source in the image. For each one:
- box_2d: [ymin, xmin, ymax, xmax] normalized 0-1000
- type: porch | window | pool | street | balcony | parking | lamp | other
- bulb_visible: true if the bare bulb / glowing element is directly visible
- color: white | amber | red | blue | other
- status: "possible_issue" if the bulb is visible AND/OR the light is white/blue,
  otherwise "ok" (shielded, aimed down, or amber/red)
- fix: one short practical tip (e.g. "Add a shield so the bulb isn't visible",
  "Swap to an amber LED", "Close blinds after dark"). For ok lights: "Looks compliant".

Ignore phone/TV screens, reflections, glare, moon and sky glow.
If there are no lights, return an empty list.

Return ONLY JSON:
{"lights":[{"box_2d":[0,0,0,0],"type":"porch","bulb_visible":true,"color":"white",
"status":"possible_issue","fix":"..."}],"summary":"one sentence"}"""

VALID_TYPES = {"porch", "window", "pool", "street", "balcony", "parking", "lamp", "other"}
VALID_COLORS = {"white", "amber", "red", "blue", "other"}

app = FastAPI(title="Turtle Light Check")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

client = None
types = None
if not MOCK:
    from google import genai
    from google.genai import types  # noqa: F811

    client = genai.Client(api_key=API_KEY, http_options=types.HttpOptions(timeout=20_000))  # 20s cap


def prep_image(raw: bytes) -> tuple[bytes, int, int]:
    """Open, fix orientation, downscale, re-encode as JPEG."""
    try:
        img = Image.open(io.BytesIO(raw))
    except Exception:
        raise HTTPException(400, "Could not read image (HEIC? export as JPEG).")
    try:
        from PIL import ImageOps

        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue(), img.width, img.height


RETRYABLE = ("timed out", "Timeout", "503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "overloaded", "high demand")


def _gemini_once(model: str, jpeg: bytes) -> dict:
    resp = client.models.generate_content(
        model=model,
        contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json", temperature=0.2
        ),
    )
    text = (resp.text or "").strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return json.loads(text)


def call_gemini(jpeg: bytes) -> dict:
    """Retry busy/rate-limit errors with backoff, then fall back to a second model."""
    last = None
    for model in dict.fromkeys([MODEL, FALLBACK_MODEL]):  # dedupe, keep order
        for attempt in range(2):
            try:
                result = _gemini_once(model, jpeg)
                result["_model"] = model
                return result
            except Exception as e:  # noqa: BLE001
                last = e
                if not any(k in str(e) for k in RETRYABLE):
                    raise
                print(f"[gemini] {model} busy (attempt {attempt + 1}), retrying...")
                time.sleep(1.0 * 2**attempt)  # 1s, 2s, 4s
    raise last


def mock_detect(jpeg: bytes) -> dict:
    """Offline fallback: box around the brightest pixels (works for the desk-lamp demo)."""
    img = Image.open(io.BytesIO(jpeg)).convert("L")
    w, h = img.size
    bbox = img.point(lambda p: 255 if p > 235 else 0).getbbox()
    if not bbox:
        return {"lights": [], "summary": "No bright light sources found (mock mode)."}
    x0, y0, x1, y1 = bbox
    box = [int(y0 / h * 1000), int(x0 / w * 1000), int(y1 / h * 1000), int(x1 / w * 1000)]
    return {
        "lights": [
            {
                "box_2d": box,
                "type": "lamp",
                "bulb_visible": True,
                "color": "white",
                "status": "possible_issue",
                "fix": "Add a shield so the bulb isn't visible from the beach (mock).",
            }
        ],
        "summary": "1 bright light found (mock mode, no Gemini call).",
    }


def clean_light(raw: dict) -> dict | None:
    box = raw.get("box_2d")
    if not (isinstance(box, list) and len(box) == 4):
        return None
    try:
        box = [max(0, min(1000, int(v))) for v in box]
    except (TypeError, ValueError):
        return None
    status = raw.get("status")
    if status not in ("possible_issue", "ok"):
        status = "possible_issue" if raw.get("bulb_visible") else "ok"
    t = raw.get("type", "other")
    c = raw.get("color", "other")
    return {
        "box_2d": box,
        "type": t if t in VALID_TYPES else "other",
        "color": c if c in VALID_COLORS else "other",
        "bulb_visible": bool(raw.get("bulb_visible", False)),
        "status": status,
        "fix": str(raw.get("fix") or "")[:200],
    }


def spread(lat: float, lng: float, box: list[int]) -> tuple[float, float]:
    """All lights in one photo share the photographer's GPS. Nudge each marker
    east/west by where it sits in the frame (±15 m) so pins don't stack."""
    cx = (box[1] + box[3]) / 2 / 1000  # 0..1 across the image
    dx_m = (cx - 0.5) * 30
    dlng = dx_m / (111320 * math.cos(math.radians(lat)))
    return lat, lng + dlng


@app.get("/api/health")
def health():
    return {"ok": True, "mock": MOCK, "model": None if MOCK else MODEL}


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    source: str = Form("photo"),
    frame_time: float | None = Form(None),
):
    jpeg, width, height = prep_image(await file.read())
    try:
        result = mock_detect(jpeg) if MOCK else await run_in_threadpool(call_gemini, jpeg)
    except json.JSONDecodeError:
        raise HTTPException(502, "Model returned non-JSON. Try again.")
    except Exception as e:  # network / quota / safety
        raise HTTPException(502, f"Vision call failed: {e}")

    findings = []
    for raw in result.get("lights", []) or []:
        light = clean_light(raw) if isinstance(raw, dict) else None
        if not light:
            continue
        f_lat, f_lng = (spread(lat, lng, light["box_2d"]) if lat is not None and lng is not None else (None, None))
        findings.append(
            {
                "id": f"f_{uuid.uuid4().hex[:8]}",
                "lat": f_lat,
                "lng": f_lng,
                "source": source,
                "frameTime": frame_time,
                **light,
            }
        )

    return {
        "summary": result.get("summary", ""),
        "width": width,
        "height": height,
        "mock": MOCK,
        "model": result.get("_model"),
        "findings": findings,
    }
