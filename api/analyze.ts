// Vercel serverless function. Keeps GEMINI_API_KEY server-side (never in the browser bundle).
// Also served by `pnpm dev` through the dev-api plugin in vite.config.ts.
const PROMPT = `You review a night photo of a beach-facing property in Lee County, Florida (Sanibel, Fort Myers Beach)
for sea-turtle lighting problems, using the Lee County Land Development Code, Ch. 14, Art. II, Div. 2:
- LDC 14-76(d): exterior fixtures must be long wavelength, downward directed, full cutoff, fully shielded.
- LDC 14-72: long wavelength = 560 nm or greater (amber, orange, red). White, blue or green light is not.
  "Fully shielded" = the bulb, lamp or glowing lens is not directly visible.
- LDC 14-79: minimize interior light from doors and windows visible from the beach (blinds/curtains closed).
- Decorative uplighting on buildings or landscaping should be off.
- LDC 14-73(a)(2)(a): a SHADOW cast by artificial lighting on an opaque object (person, chair, dune, sand,
  wall, vegetation) is a rebuttable presumption of a violation. Look carefully for shadows caused by artificial
  light, not moonlight.

Find every visible light source (bulbs, lamps, fixtures, bright windows, uplights). Ignore phone screens, lens
glare and reflections. For each light give a short "rule" naming the LDC section it most likely concerns, or ""
if it looks compliant. Also list any shadows cast by artificial light.

Return JSON: {"lights":[{"label":string,"box_2d":[ymin,xmin,ymax,xmax] (0-1000),"possibleIssue":boolean,
"advice":string,"rule":string}],"shadows":[{"box_2d":[ymin,xmin,ymax,xmax],"description":string}],"summary":string}.
Use cautious wording ("possible issue"), never say "violation".`

// Benchmarked Nov 2: Flash-Lite ~1s with a good box; 3.8 Flash was overloaded (minutes); 3.6 hit quota.
const MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash',
].filter((m, i, a) => a.indexOf(m) === i)
const RETRYABLE = new Set([429, 500, 503])
const TIMEOUT_MS = 20_000 // never let a busy model hang the demo
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: Request): Promise<Response> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return Response.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 })

  const { image, mimeType } = (await req.json()) as { image?: string; mimeType?: string }
  if (!image || !mimeType?.startsWith('image/')) return Response.json({ error: 'image required' }, { status: 400 })
  if (image.length > 10_000_000) return Response.json({ error: 'image too large' }, { status: 413 })

  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: image } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  })

  // Retry busy / rate-limited responses (1s, 2s), then move down the model list.
  let lastStatus = 0
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r: Response
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch {
        lastStatus = 504 // timed out: skip to the next model
        break
      }
      if (r.ok) {
        const data = await r.json()
        try {
          return Response.json({ ...JSON.parse(data.candidates[0].content.parts[0].text), model })
        } catch {
          return Response.json({ error: 'Unreadable model response' }, { status: 502 })
        }
      }
      lastStatus = r.status
      if (!RETRYABLE.has(r.status)) break // e.g. 404 model not found: go straight to the fallback
      await sleep(1000 * 2 ** attempt)
    }
  }
  return Response.json({ error: 'Gemini request failed', status: lastStatus }, { status: 502 })
}

