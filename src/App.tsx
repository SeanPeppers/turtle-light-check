import { lazy, Suspense, useEffect, useState } from 'react'
import Lenis from 'lenis'
import { ChevronDown } from 'lucide-react'
import Analyzer from './Analyzer'
import LightMap from './LightMap'
import { gpsFromPhoto } from './geo'
import { photoToMapLights, type MapLight, type Result } from './lights'
import { DRONE_PATH, SIM_LIGHTS, SIM_IS_SAMPLE } from './simData'

const Hero3D = lazy(() => import('./Hero3D'))

export default function App() {
  const [photoLights, setPhotoLights] = useState<MapLight[]>([])
  const [pending, setPending] = useState<{ result: Result; image: string } | null>(null)
  const [focus, setFocus] = useState<MapLight>()

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis()
    let id = requestAnimationFrame(function raf(t) {
      lenis.raf(t)
      id = requestAnimationFrame(raf)
    })
    return () => {
      cancelAnimationFrame(id)
      lenis.destroy()
    }
  }, [])

  function addPhoto(result: Result, image: string, at: { lat: number; lng: number }) {
    const added = photoToMapLights(result, at, image)
    setPhotoLights((prev) => [...prev, ...added])
    if (added[0]) setFocus(added[0])
  }

  // Photo analyzed -> use its GPS, or ask the user to click the map.
  async function onResult(result: Result, file: File) {
    if (!result.lights?.length) return
    const image = URL.createObjectURL(file)
    const at = await gpsFromPhoto(file)
    if (at) addPhoto(result, image, at)
    else setPending({ result, image })
  }

  return (
    <main>
      <header className="hero">
        <div className="hero-3d">
          <Suspense fallback={null}>
            <Hero3D />
          </Suspense>
        </div>
        <div className="hero-text">
          <h1>Turtle Light Check</h1>
          <p>Spot lights that confuse sea-turtle hatchlings on Sanibel and Fort Myers Beach.</p>
          <a className="btn" href="#check">
            Check a photo <ChevronDown aria-hidden />
          </a>
        </div>
      </header>
      <Analyzer onResult={onResult} />
      <div className="analyzer">
        <h2>Beach light map</h2>
        <p className="muted">
          Drone patrol results{SIM_IS_SAMPLE && ' (sample data until the sim writes sim/detections.geojson)'} plus every photo you check.
        </p>
        <LightMap
          lights={[...SIM_LIGHTS, ...photoLights]}
          dronePath={DRONE_PATH}
          placing={!!pending}
          focus={focus}
          onPlace={(at) => {
            if (!pending) return
            addPhoto(pending.result, pending.image, at)
            setPending(null)
          }}
        />
      </div>
    </main>
  )
}
