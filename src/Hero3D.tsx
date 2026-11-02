import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, useAnimations, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Group, Mesh } from 'three'

// Night beach seen from above: dunes far away (top of screen), surf at the bottom.
// Turtles are animated GLB models (public/models) that crawl toward the water (+z = down the screen).
const START_Z = -16
const WATER_Z = 2.6
const MODELS = ['/models/sea-turtle.glb', '/models/seaturtle.glb', '/models/baby.glb']
MODELS.forEach((m) => useGLTF.preload(m))
// Rotate models if they face the wrong way: the GLBs are assumed to face +z (toward the surf).
const FACING = 0
const TURTLES = [
  { url: MODELS[0], x: -6, z: -2, speed: 0.35, scale: 1 * 1.4 },
  { url: MODELS[2], x: -3.2, z: -9, speed: 0.28, scale: 1.4 * 1.4 },
  { url: MODELS[1], x: -0.8, z: -5, speed: 0.4, scale: 1.2 * 1.4 },
  { url: MODELS[2], x: 1.8, z: -13, speed: 0.3, scale: 1.6 * 1.4 },
  { url: MODELS[0], x: 3.6, z: -1, speed: 0.33, scale: 1.1 * 1.4 },
  { url: MODELS[1], x: 6.2, z: -7, speed: 0.38, scale: 0.9 * 1.4 },
]

function Turtle({ url, x, z, speed, scale }: (typeof TURTLES)[number]) {
  const root = useRef<Group>(null)
  const gltf = useGLTF(url)
  // SkeletonUtils.clone so each turtle gets its own skeleton from the shared GLB.
  const model = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene])
  const { actions, names } = useAnimations(gltf.animations, root)
  const span = WATER_Z - START_Z

  useEffect(() => {
    const walk = actions[names.find((n) => /walk$/i.test(n)) ?? '']
    walk?.reset().play()
    if (walk) walk.time = Math.abs(x * 7) % walk.getClip().duration // desync the gait
    return () => void walk?.stop()
  }, [actions, names, x])

  useFrame(({ clock }) => {
    // Loop: once a turtle reaches the surf it reappears at the dunes.
    root.current!.position.z = START_Z + ((z - START_Z + clock.elapsedTime * speed * 3) % span)
  })
  return (
    <group ref={root} position={[x, 0, z]} scale={scale}>
      <primitive object={model} rotation-y={FACING} />
    </group>
  )
}

function Surf() {
  const foam = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    foam.current!.position.z = WATER_Z + Math.sin(clock.elapsedTime * 0.8) * 0.25
  })
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, WATER_Z + 15]}>
        <planeGeometry args={[80, 30]} />
        <meshStandardMaterial color="#0b3d5c" roughness={0.3} metalness={0.2} />
      </mesh>
      <mesh ref={foam} rotation-x={-Math.PI / 2} position={[0, 0.02, WATER_Z]}>
        <planeGeometry args={[80, 0.35]} />
        <meshBasicMaterial color="#cfe9f5" transparent opacity={0.6} />
      </mesh>
    </>
  )
}

export default function Hero3D() {
  return (
    <Canvas camera={{ position: [0, 7, 9], fov: 50 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0)} aria-hidden>
      <color attach="background" args={['#050d1a']} />
      <fog attach="fog" args={['#050d1a', 14, 32]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[-4, 8, -6]} intensity={1.6} color="#b8d4ff" />
      <Stars radius={60} depth={30} count={1500} factor={3} fade />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -10]}>
        <planeGeometry args={[80, 60]} />
        <meshStandardMaterial color="#8a7c5c" roughness={1} />
      </mesh>
      {/* wet sand band by the water */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, WATER_Z - 0.6]}>
        <planeGeometry args={[80, 1.4]} />
        <meshStandardMaterial color="#5e5640" roughness={0.6} />
      </mesh>
      <Surf />
      {TURTLES.map((t) => (
        <Turtle key={t.x} {...t} />
      ))}
    </Canvas>
  )
}
