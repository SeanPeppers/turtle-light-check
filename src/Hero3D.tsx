import { Canvas } from '@react-three/fiber'
import { Float, Stars } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'

// Placeholder hero: a glowing moon over a floating "shell". Swap for a real turtle model later.
export default function Hero3D() {
  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 50 }} aria-hidden>
      <color attach="background" args={['#030b14']} />
      <ambientLight intensity={0.3} />
      <pointLight position={[3, 3, 3]} intensity={30} color="#9fd8ff" />
      <Stars radius={60} depth={40} count={2500} factor={3} fade />
      <mesh position={[2.6, 1.8, -3]}>
        <sphereGeometry args={[0.7, 32, 32]} />
        <meshBasicMaterial color={[4, 4, 3.2]} toneMapped={false} />
      </mesh>
      <Float speed={1.5} floatIntensity={1.2}>
        <mesh scale={[1.5, 0.8, 1.2]} rotation={[0.4, 0.5, 0]}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#2f8f6b" flatShading roughness={0.6} />
        </mesh>
      </Float>
      <EffectComposer>
        <Bloom intensity={1.2} luminanceThreshold={1} mipmapBlur />
      </EffectComposer>
    </Canvas>
  )
}
