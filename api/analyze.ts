// Vercel serverless function. Keeps GEMINI_API_KEY server-side (never in the browser bundle).
const PROMPT = `You review a night photo of a beach-facing property for sea-turtle lighting problems.
Find every visible light source (bulbs, lamps, fixtures, bright windows). For each, judge whether it could be
visible from the beach and shades/shielding would help. Ignore phone screens and lens glare/reflections.
Return JSON: {"lights":[{"label":string,"box_2d":[ymin,xmin,ymax,xmax] (0-1000),"possibleIssue":boolean,"advice":string}],"summary":string}.
Use cautious wording ("possible issue"), never say "violation".`

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const key = process.env.GEMINI_API_KEY
  if (!key) return Response.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 })

  const { image, mimeType } = (await req.json()) as { image?: string; mimeType?: string }
  if (!image || !mimeType?.startsWith('image/')) return Response.json({ error: 'image required' }, { status: 400 })
  if (image.length > 10_000_000) return Response.json({ error: 'image too large' }, { status: 413 })

  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: image } }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })
  if (!r.ok) return Response.json({ error: 'Gemini request failed', status: r.status }, { status: 502 })
  const data = await r.json()
  try {
    return Response.json(JSON.parse(data.candidates[0].content.parts[0].text))
  } catch {
    return Response.json({ error: 'Unreadable model response' }, { status: 502 })
  }
}
