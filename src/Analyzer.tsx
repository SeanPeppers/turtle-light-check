import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react'
import type { Result } from './lights'

// Shrink to <=1600px JPEG before upload: keeps requests under Vercel's 4.5 MB body limit
// and makes Gemini faster. (GPS is read from the original file, not this copy.)
async function toUploadBase64(f: File, maxSide = 1600): Promise<string> {
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.85).split(',')[1]
}

export default function Analyzer({ onResult }: { onResult?: (result: Result, file: File) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Draw photo + boxes whenever the file or result changes.
  useEffect(() => {
    if (!file || !canvas.current) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const c = canvas.current!
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      ctx.lineWidth = Math.max(3, img.width / 200)
      ctx.font = `${Math.max(16, img.width / 45)}px sans-serif`
      for (const l of result?.lights ?? []) {
        const [y1, x1, y2, x2] = l.box_2d
        const x = (x1 / 1000) * img.width
        const y = (y1 / 1000) * img.height
        const w = ((x2 - x1) / 1000) * img.width
        const h = ((y2 - y1) / 1000) * img.height
        ctx.strokeStyle = ctx.fillStyle = l.possibleIssue ? '#ff5a5a' : '#4ade80'
        ctx.strokeRect(x, y, w, h)
        ctx.fillText(l.label, x, Math.max(y - 6, 18))
      }
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [file, result])

  async function analyze(f: File) {
    setFile(f)
    setResult(null)
    setError('')
    setBusy(true)
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: await toUploadBase64(f), mimeType: 'image/jpeg' }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Analysis failed')
      setResult(data)
      onResult?.(data, f)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="check" className="analyzer">
      <h2>Check your lights</h2>
      <label className="upload">
        <Upload aria-hidden /> Choose or take a night photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])}
        />
      </label>
      {busy && (
        <p role="status">
          <Loader2 className="spin" aria-hidden /> Analyzing…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {file && <canvas ref={canvas} role="img" aria-label="Photo with detected lights outlined" />}
      {result && (
        <div aria-live="polite">
          <p>{result.summary}</p>
          <ul>
            {result.lights.map((l, i) => (
              <li key={i}>
                {l.possibleIssue ? <AlertTriangle aria-label="Possible issue" /> : <CheckCircle2 aria-label="OK" />}{' '}
                <strong>{l.label}</strong>: {l.advice}
              </li>
            ))}
          </ul>
          <small>
            Results are AI estimates, not a code-enforcement finding. Confirm against current Lee County
            turtle-lighting rules.
          </small>
        </div>
      )}
    </section>
  )
}
