import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { SpotLight, Stars, useAnimations, useFBX, useGLTF, useTexture } from '@react-three/drei'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Box3, CanvasTexture, Mesh, MeshStandardMaterial, type Material, PlaneGeometry, RepeatWrapping, Vector2, Vector3, type Group, type MeshBasicMaterial, type Texture } from 'three'
import { Water } from 'three/examples/jsm/objects/Water.js'

// Moonlit night beach (when hatchlings emerge): dunes and a lit-up coastline at the top, surf at the bottom.
// Turtles are animated GLB models (public/models) that crawl toward the water (+z = down the screen).
// Sand: Poly Haven "Aerial Beach 01" (CC0). Water normals: three.js examples (MIT).
// Construction site: Majadroid "3D House Construction Site" (CC0), palette by Imphenzia.
const START_Z = -12
const SHORE_Z = 1.2 // where the beach slope meets mean sea level
const MOON = new Vector3(-0.5, 0.17, -1).normalize() // low moon over the land, glinting off the water
const MODELS = ['/models/sea-turtle.glb', '/models/seaturtle.glb', '/models/baby.glb']
MODELS.forEach((m) => useGLTF.preload(m))
// Rotate models if they face the wrong way: the GLBs are assumed to face +z (toward the surf).
const FACING = 0
const TURTLES = [
  { url: MODELS[0], x: -6, z: -2, speed: 0.35, scale: 1 * 1.8 },
  { url: MODELS[2], x: -3.2, z: -9, speed: 0.28, scale: 1.4 * 1.8 },
  { url: MODELS[1], x: -0.8, z: -5, speed: 0.4, scale: 1.2 * 1.8 },
  { url: MODELS[2], x: 1.8, z: -13, speed: 0.3, scale: 1.6 * 1.8 },
  { url: MODELS[0], x: 3.6, z: -1, speed: 0.33, scale: 1.1 * 1.8 },
  { url: MODELS[1], x: 6.2, z: -7, speed: 0.38, scale: 0.9 * 1.8 },
]

// Beach height: gentle rise toward the dunes, steeper slope into the sea, plus overlapping
// ripples so the waterline is wavy instead of a straight edge.
function heightAt(x: number, z: number) {
  const slope = z > SHORE_Z - 6 ? -(z - SHORE_Z) * 0.18 : 1.08 + (SHORE_Z - 6 - z) * 0.05
  const bumps =
    0.12 * Math.sin(x * 0.23 + 1.3) +
    0.06 * Math.sin(x * 0.61 + z * 0.27) +
    0.04 * Math.sin(x * 1.37 - z * 0.71) +
    0.03 * Math.sin(z * 0.9 + x * 0.11)
  return slope + bumps
}

const END_Z = 7.5 // just past the bottom edge of the screen
const FADE_FROM = SHORE_Z + 2 // start fading once the turtle is swimming

function Turtle({ url, x, z, speed, scale }: (typeof TURTLES)[number]) {
  const root = useRef<Group>(null)
  const gltf = useGLTF(url)
  // SkeletonUtils.clone so each turtle gets its own skeleton; materials are cloned too so each can fade on its own.
  const { model, mats } = useMemo(() => {
    const m = SkeletonUtils.clone(gltf.scene)
    const list: Material[] = []
    const fadeable = (mat: Material) => {
      const c = mat.clone()
      c.transparent = true
      list.push(c)
      return c
    }
    m.traverse((o) => {
      if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map(fadeable) : fadeable(o.material)
    })
    return { model: m, mats: list }
  }, [gltf.scene])
  const { actions, names } = useAnimations(gltf.animations, root)
  const span = END_Z - START_Z
  const swimming = useRef(false)

  useEffect(() => {
    const walk = actions[names.find((n) => /walk$/i.test(n)) ?? '']
    walk?.reset().play()
    if (walk) walk.time = Math.abs(x * 7) % walk.getClip().duration // desync the gait
    return () => void walk?.stop()
  }, [actions, names, x])

  useFrame(({ clock }) => {
    // Loop: crawl down the beach, swim out through the surf, fade away, then reappear at the dunes.
    const g = root.current!
    const pz = START_Z + ((z - START_Z + clock.elapsedTime * speed * 3) % span)
    g.position.z = pz
    // On sand follow the ground; in the water float just under the surface.
    g.position.y = Math.max(heightAt(x, pz), -0.12)

    // Walk on land, swim once in the water.
    const inWater = pz > SHORE_Z + 0.6
    if (inWater !== swimming.current) {
      swimming.current = inWater
      const walk = actions[names.find((n) => /walk$/i.test(n)) ?? '']
      const swim = actions[names.find((n) => /swim$/i.test(n)) ?? '']
      if (walk && swim) {
        const [from, to] = inWater ? [walk, swim] : [swim, walk]
        to.reset().play()
        from.crossFadeTo(to, 0.6, false)
      }
    }

    // Fade in at the dunes, fade out as it swims off the bottom of the page.
    const opacity = Math.min(1, (pz - START_Z) / 1.5, (END_Z - pz) / (END_Z - FADE_FROM))
    for (const m of mats) m.opacity = Math.max(0, opacity)
  })
  return (
    <group ref={root} position={[x, heightAt(x, z), z]} scale={scale}>
      <primitive object={model} rotation-y={FACING} />
    </group>
  )
}

// GLSL value noise shared by the sand shader.
const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
`

function Beach() {
  const sandTex = useTexture(
    ['albedo', 'normal', 'roughness'].map((m) => `/textures/sand_${m}.jpg`),
    (tex) => {
      for (const t of tex as Texture[]) {
        t.wrapS = t.wrapT = RepeatWrapping
        t.repeat.set(17, 14)
        t.anisotropy = 8 // keeps sand sharp at the grazing camera angle
      }
    },
  ) as Texture[]
  const normals = useTexture('/textures/waternormals.jpg', (t) => {
    t.wrapS = t.wrapT = RepeatWrapping
  })
  const uniforms = useMemo(() => ({ uWaterY: { value: 0 }, uTime: { value: 0 } }), [])

  const sand = useMemo(() => {
    const geo = new PlaneGeometry(140, 110, 280, 220).rotateX(-Math.PI / 2).translate(0, 0, -23)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
    geo.computeVertexNormals()

    const [map, normalMap, roughnessMap] = sandTex
    const mat = new MeshStandardMaterial({ map, normalMap, roughnessMap, normalScale: new Vector2(0.55, 0.55) })
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nuniform float uWaterY;\nuniform float uTime;\n${NOISE}`)
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          // Anti-tiling: blend in a rotated, rescaled second sample through a low-frequency mask.
          vec2 uvB = mat2(0.8, 0.6, -0.6, 0.8) * vMapUv * 0.41 + vec2(0.37, 0.11);
          float mask = smoothstep(0.25, 0.75, vnoise(vMapUv * 0.9));
          diffuseColor *= mix(texture2D(map, vMapUv), texture2D(map, uvB), mask);
          // Large-scale tone variation so the beach isn't uniform.
          diffuseColor.rgb *= 0.9 + 0.2 * vnoise(vWPos.xz * 0.08);

          float d = vWPos.y - uWaterY;
          float edge = vnoise(vWPos.xz * 1.3 + vec2(uTime * 0.15, 0.0));
          // Sand below the high-water mark stays dark and glossy after a wave recedes.
          float wet = 1.0 - smoothstep(0.0, 0.18 + 0.12 * edge, vWPos.y - 0.1);
          diffuseColor.rgb *= mix(1.0, 0.6, wet);
          // Shallow water tint over submerged sand.
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.36, 0.36), smoothstep(0.0, -0.35, d));
          // Broken foam lace riding the waterline.
          float lace = smoothstep(0.35, 0.75, vnoise(vWPos.xz * vec2(2.5, 6.0) + vec2(uTime * 0.4, uTime * 0.2)));
          float foam = (1.0 - smoothstep(0.0, 0.1 + 0.08 * edge, abs(d - 0.02))) * (0.35 + 0.65 * lace);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 0.97), foam * 0.9);
          `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, 1.0 - smoothstep(0.0, 0.25, vWPos.y - 0.1));',
        )
    }
    return { geo, mat }
  }, [sandTex, uniforms])

  // three's premade Water: reflective, and it blends the normal map at several scales so it doesn't read as tiles.
  const water = useMemo(() => {
    const w = new Water(new PlaneGeometry(120, 60), {
      waterNormals: normals,
      sunDirection: MOON,
      sunColor: 0xbfd4ff,
      waterColor: 0x03161f,
      distortionScale: 3,
      alpha: 0.82, // let the shallow sand show through near shore
      fog: true,
    })
    w.material.transparent = true
    w.material.uniforms.size.value = 0.6
    w.rotation.x = -Math.PI / 2
    w.position.set(0, 0, SHORE_Z + 26)
    return w
  }, [normals])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    // Swash: two overlapping swells move the waterline up and down the slope.
    const y = 0.05 * Math.sin(t * 0.45) + 0.035 * Math.sin(t * 1.1 + 1)
    water.position.y = y
    water.material.uniforms.time.value += dt * 0.5
    uniforms.uWaterY.value = y
    uniforms.uTime.value = t
  })

  return (
    <>
      <mesh geometry={sand.geo} material={sand.mat} />
      <primitive object={water} />
    </>
  )
}

// Hurricane-damaged condos being rebuilt behind the dunes, lit by work floodlights aimed at the beach —
// exactly the kind of light that pulls hatchlings away from the water.
const BUILDING = '/models/construction/Building.fbx'
const CRANE = '/models/construction/Crane-On-Ground.fbx'
const SITE = [
  ...[-52, -38, -24, -9, 8, 22, 36, 50].map((x, i) => ({ url: BUILDING, x, z: -60 - (i % 3) * 4, rot: (i % 4) * 0.4 - 0.6, s: 0.11 + (i % 3) * 0.015 })),
  ...[-45, -16, 2, 29, 44].map((x, i) => ({ url: CRANE, x, z: -57 - (i % 2) * 6, rot: i * 1.3, s: 0.12 + (i % 2) * 0.02 })),
]
const FLOODS = [-44, -28, -12, 0, 13, 29, 45].map((x, i) => ({ x, z: -45 - (i % 2) * 4 }))
const POLE = 5

function SiteModel({ url, x, z, rot, s }: (typeof SITE)[number]) {
  const fbx = useFBX(url)
  const model = useMemo(() => fbx.clone(), [fbx])
  // Red aviation beacon on the highest point of each structure, blinking like real crane/tower lights.
  const top = useMemo(() => new Box3().setFromObject(fbx).max.y, [fbx])
  const beacon = useRef<MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    const on = Math.sin(clock.elapsedTime * 3 + x) > 0.3
    beacon.current!.color.setRGB(on ? 30 : 0.4, 0, 0)
  })
  return (
    <group position={[x, heightAt(x, z) - 0.5, z]} rotation-y={rot} scale={s}>
      <primitive object={model} />
      <mesh position={[0, top + 0.6, 0]} scale={0.6 / s}>
        <sphereGeometry args={[0.25, 10, 8]} />
        <meshBasicMaterial ref={beacon} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Floodlight({ x, z }: { x: number; z: number }) {
  const y = heightAt(x, z)
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, POLE / 2, 0]}>
        <cylinderGeometry args={[0.12, 0.18, POLE, 8]} />
        <meshStandardMaterial color="#5b5f66" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* 2x2 lamp bank; emissive > 1 so Bloom makes it glare */}
      {[-0.55, 0.55].flatMap((dx) =>
        [-0.45, 0.45].map((dy) => (
          <mesh key={`${dx}${dy}`} position={[dx, POLE + 0.6 + dy, 0.2]} rotation-x={0.35}>
            <boxGeometry args={[0.8, 0.6, 0.2]} />
            <meshBasicMaterial color={[24, 22, 18]} toneMapped={false} />
          </mesh>
        )),
      )}
      <SpotLight
        position={[0, POLE + 0.6, 0.4]}
        color="#fff3d6"
        intensity={70}
        decay={1}
        distance={70}
        angle={0.32}
        penumbra={0.5}
        attenuation={22}
        anglePower={4}
        opacity={0.35}
        onUpdate={(l) => {
          // Aim at the beach in front of the light.
          l.target.position.set(x * 0.6, 0, -2)
          l.target.updateMatrixWorld()
        }}
      />
    </group>
  )
}

// Deterministic pseudo-random so the skyline is the same on every load.
const rand = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return v - Math.floor(v)
}

// Window grid texture: dark facade with a random mix of warm, cool and dark windows.
function windowTexture(seed: number) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 128, 256)
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 16; x++) {
      const r = rand(seed * 1000 + y * 16 + x)
      if (r > 0.3) continue // unlit
      ctx.fillStyle = r < 0.05 ? '#bcd6ff' : r < 0.3 ? '#ffd28a' : '#ff9f4a'
      ctx.fillRect(x * 8 + 2, y * 8 + 2, 4, 5)
    }
  return new CanvasTexture(c)
}

const CONDOS = Array.from({ length: 34 }, (_, i) => ({
  x: -66 + i * 4 + (rand(i) - 0.5) * 2,
  z: -82 - rand(i + 50) * 14,
  w: 3 + rand(i + 100) * 3,
  d: 3 + rand(i + 150) * 2,
  h: 4 + rand(i + 200) * 6 + (i % 7 === 3 ? 4 : 0), // mostly mid-rise, a few towers
  tex: i % 3,
}))

function Skyline() {
  const textures = useMemo(() => [1, 2, 3].map(windowTexture), [])
  return (
    <>
      {CONDOS.map((b, i) => (
        <mesh key={i} position={[b.x, heightAt(b.x, b.z) + b.h / 2 - 0.5, b.z]}>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial color="#1c2230" emissive="#ffffff" emissiveMap={textures[b.tex]} emissiveIntensity={1.5} roughness={0.8} />
        </mesh>
      ))}
    </>
  )
}

function ConstructionSite() {
  return (
    <>
      {SITE.map((m, i) => (
        <SiteModel key={i} {...m} />
      ))}
      {FLOODS.map((f) => (
        <Floodlight key={f.x} {...f} />
      ))}
    </>
  )
}

export default function Hero3D() {
  return (
    <Canvas camera={{ position: [0, 5.5, 11], fov: 50 }} onCreated={({ camera }) => camera.lookAt(0, 1, -4)} aria-hidden>
      <color attach="background" args={['#060b18']} />
      <fog attach="fog" args={['#0a1226', 45, 160]} />
      <Stars radius={150} depth={40} count={4000} factor={4} fade />
      {/* moon: emissive > 1 so it blooms */}
      <mesh position={MOON.clone().multiplyScalar(140)}>
        <sphereGeometry args={[4, 32, 16]} />
        <meshBasicMaterial color={[6, 6, 5.4]} toneMapped={false} fog={false} />
      </mesh>
      <hemisphereLight args={['#5d76b0', '#1c1812', 0.6]} />
      <directionalLight position={MOON.clone().multiplyScalar(20)} intensity={1.1} color="#b4c8ff" />
      <Beach />
      <Skyline />
      <ConstructionSite />
      {TURTLES.map((t) => (
        <Turtle key={t.x} {...t} />
      ))}
      <EffectComposer>
        <Bloom intensity={1.2} luminanceThreshold={1.2} luminanceSmoothing={0.3} mipmapBlur />
        {/* 6 = ToneMappingMode.ACES_FILMIC (postprocessing isn't a direct dependency) */}
        <ToneMapping mode={6} />
      </EffectComposer>
    </Canvas>
  )
}
