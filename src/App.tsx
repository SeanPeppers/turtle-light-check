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
      {/* fixed night-beach scene behind all content */}
      <div className="hero-3d">
        <Suspense fallback={null}>
          <Hero3D />
        </Suspense>
      </div>
      <header className="hero">
        <div className="hero-text">
          <h1>Turtle Light Check</h1>
          <p>Baby sea turtles crawl toward the brightest thing they can see. That should be the moon over the Gulf, not your porch light.</p>
          <div className="hero-actions">
            <a className="btn" href="#check">
              Check a photo <ChevronDown aria-hidden />
            </a>
            <a className="btn btn-ghost" href="#map">
              See the map
            </a>
          </div>
        </div>
        <ul className="facts" aria-label="Sea turtle facts">
          <li><strong>May 1 – Oct 31</strong> Sea turtle nesting season on Lee County beaches</li>
          <li><strong>Brightest horizon</strong> Hatchlings find the sea by heading toward the brightest light</li>
          <li><strong>~1 in 1,000</strong> Estimated hatchlings that survive to adulthood</li>
        </ul>
      </header>
      <Analyzer onResult={onResult} />
      <div className="analyzer card">
        <h2>Beach light map</h2>
        <p className="muted">
          Our drone flew the beach by the Fort Myers Beach pier and pinned every light it could see from the sand.{SIM_IS_SAMPLE && ' (Sample data for now.)'} Photos you check show up here too.
        </p>
        {/* Click-to-play only: no autoplay, and preload="none" so the video isn't downloaded until someone presses play. */}
        <figure className="demo-video">
          <video controls preload="none" playsInline poster="/demo-poster.jpg" width={1280} height={720}>
            <source src="/demo.mp4" type="video/mp4" />
          </video>
          <figcaption className="muted">Watch the drone patrol: it flies the beach in our simulation and pins each light it sees.</figcaption>
        </figure>
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
