import { lazy, Suspense, useEffect } from 'react'
import Lenis from 'lenis'
import { ChevronDown } from 'lucide-react'
import Analyzer from './Analyzer'

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
      <Analyzer />
    </main>
  )
}
