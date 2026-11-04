"""Time each Gemini model on the same photo.  Usage: python bench.py [image]"""
import json, os, sys, time
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
from google import genai
from google.genai import types
from main import PROMPT, prep_image

img = sys.argv[1] if len(sys.argv) > 1 else "test_images/porch_bare.jpg"
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
jpeg, *_ = prep_image(open(img, "rb").read())
print(f"image: {img}   (porch_bare bulb is at about [640, 637, 685, 662])\n")
for m in ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]:
    t = time.time()
    try:
        r = client.models.generate_content(
            model=m,
            contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), PROMPT],
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.2),
        )
        L = json.loads(r.text)["lights"]
        print(f"{m:24} {time.time()-t:5.1f}s  {len(L)} light(s)  box={L[0]['box_2d'] if L else None}  status={L[0]['status'] if L else None}")
    except Exception as e:
        print(f"{m:24} ERROR {str(e)[:90]}")
