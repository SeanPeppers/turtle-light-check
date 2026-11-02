import { lazy, Suspense, useEffect } from 'react'
import Lenis from 'lenis'
import { ChevronDown } from 'lucide-react'
import LightMap from './LightMap'

const Hero3D = lazy(() => import('./Hero3D'))

export default function App() {
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

  return (
    <main>
      <div className="hero-3d">
        <Suspense fallback={null}>
          <Hero3D />
        </Suspense>
      </div>
      <header className="hero">
        <div className="hero-text">
          <h1>Turtle Light Check</h1>
          <p>Hatchlings crawl toward the brightest horizon. Map the lights that lead them astray on Sanibel and Fort Myers Beach.</p>
          <a className="btn" href="#map">
            Open the map <ChevronDown aria-hidden />
          </a>
        </div>
      </header>
      <LightMap />
    </main>
  )
}
