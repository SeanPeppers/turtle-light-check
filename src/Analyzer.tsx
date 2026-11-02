import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react'
import type { Result } from './lights'
import { FWC_HOTLINE, LEE_RULES, nestingStatus } from './leeRules'

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
      // Shadows cast by artificial light (LDC 14-73(a)(2)(a)): dashed yellow
      ctx.setLineDash([12, 8])
      for (const sh of result?.shadows ?? []) {
        const [y1, x1, y2, x2] = sh.box_2d
        ctx.strokeStyle = ctx.fillStyle = '#ffd60a'
        ctx.strokeRect((x1 / 1000) * img.width, (y1 / 1000) * img.height, ((x2 - x1) / 1000) * img.width, ((y2 - y1) / 1000) * img.height)
        ctx.fillText('shadow', (x1 / 1000) * img.width, Math.max((y1 / 1000) * img.height - 6, 18))
      }
      ctx.setLineDash([])
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
      if (!r.ok) throw new Error(data.error ?? 'Something went wrong. Try that photo again.')
      setResult(data)
      onResult?.(data, f)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try that photo again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="check" className="analyzer card">
      <h2>Check your lights</h2>
      <p className="muted">
        {nestingStatus().label} See a turtle heading the wrong way? Call FWC at <a href={`tel:${FWC_HOTLINE}`}>{FWC_HOTLINE}</a>.
      </p>
      <label className="upload">
        <Upload aria-hidden /> Snap or upload a night photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])}
        />
      </label>
      {busy && (
        <p role="status">
          <Loader2 className="spin" aria-hidden /> Looking for lights…
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
                {l.possibleIssue && l.rule && <small className="rule"> · {l.rule}</small>}
              </li>
            ))}
          </ul>
          {!!result.shadows?.length && (
            <p className="shadow-note">
              <AlertTriangle aria-hidden /> <strong>Your light is casting a shadow</strong>
              {' '}({result.shadows.map((s) => s.description).join('; ')}). Lee County treats that as a likely violation
              unless you can show otherwise (LDC 14-73(a)(2)(a)). Shielding or dimming the light usually fixes it.
            </p>
          )}
          <small>
            This is a heads-up, not a ticket. Double-check against Lee County's lighting rules before you
            buy new fixtures.
          </small>
          <details className="rules">
            <summary>The Lee County rules we check against</summary>
            <ul>
              {LEE_RULES.map((r, i) => (
                <li key={i}>
                  <strong>{r.code}</strong>: {r.text}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  )
}
