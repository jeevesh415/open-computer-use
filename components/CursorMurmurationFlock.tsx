"use client"

/**
 * Cursor murmuration — WebGL flock.
 *
 * Hundreds of tiny OS-pointer arrows flock via boids (separation, alignment,
 * cohesion) around a slowly-orbiting invisible attractor, with optional
 * pointer repulsion that decays after the user stops moving. Every cursor is
 * a single InstancedMesh slot — one draw call regardless of count.
 *
 * Loaded only on devices that pass the desktop/tablet gate; mobile and
 * reduced-motion users see the static SVG composition instead so three.js
 * never enters their bundle.
 */

import { useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"

// ── Boids tuning (world units; scene spans ~ x:[-15,15] y:[-10,10] z:[-3,3]) ──
// Tuned for fast, tight grouping and smooth flow. Cohesion has the longest
// reach (5.5u) so cursors find each other across the canvas quickly;
// alignment is stronger than separation so the flock locks into a single
// heading within ~1s; the attractor + swirl supply a global direction so
// the coherent flock has somewhere to go.
const SEP_RADIUS_SQ = 0.85 * 0.85
const NEIGHBOR_RADIUS_SQ = 4.0 * 4.0
const COHESION_RADIUS_SQ = 5.5 * 5.5

const SEP_WEIGHT = 1.4
const ALIGN_WEIGHT = 2.2
const COHESION_WEIGHT = 1.3
const ATTRACT_WEIGHT = 0.65
const SWIRL_WEIGHT = 0.7

const MAX_SPEED = 3.6
const MIN_SPEED = 1.8
const MAX_FORCE = 7.0
const DAMPING = 0.992

const BOUND_X = 15
const BOUND_Y = 10
const BOUND_Z = 3.5

const FIXED_DT = 1 / 60

// Mouse repulsion
const MOUSE_RADIUS = 4
const MOUSE_FORCE = 1.4
const MOUSE_TANGENT = 0.55
const MOUSE_DECAY_PER_S = 1.25 // 1.0 → 0 in ~800ms

// ─── Cursor geometry ───
// Classic NW-pointing OS pointer, tip at origin, body extending down-right.
// Path traced from a normalized macOS pointer SVG, scaled to ~1 unit tall,
// y-flipped for THREE's y-up convention.
function makeCursorGeometry() {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.lineTo(0, -0.902)
  s.lineTo(0.213, -0.724)
  s.lineTo(0.336, -1.0)
  s.lineTo(0.454, -0.946)
  s.lineTo(0.330, -0.673)
  s.lineTo(0.624, -0.659)
  s.closePath()
  const geom = new THREE.ShapeGeometry(s)
  // Anchor the centroid at origin so per-instance rotation pivots around the
  // visual center of the cursor instead of the tip.
  geom.translate(-0.27, 0.55, 0)
  return geom
}

// Build a slightly-inflated copy for the soft halo behind each cursor. Uses
// the same vertex order so we can share matrices.
function makeCursorHaloGeometry() {
  const s = new THREE.Shape()
  const inflate = 1.32
  const verts: [number, number][] = [
    [0, 0],
    [0, -0.902],
    [0.213, -0.724],
    [0.336, -1.0],
    [0.454, -0.946],
    [0.330, -0.673],
    [0.624, -0.659],
  ]
  for (let i = 0; i < verts.length; i++) {
    const [x, y] = verts[i]
    const nx = 0.27 + (x - 0.27) * inflate
    const ny = -0.55 + (y - -0.55) * inflate
    if (i === 0) s.moveTo(nx, ny)
    else s.lineTo(nx, ny)
  }
  s.closePath()
  const geom = new THREE.ShapeGeometry(s)
  geom.translate(-0.27, 0.55, 0)
  return geom
}

// ─── Spatial hash grid (O(n) neighbor lookup) ───
// Cell size = max boid neighbor radius so we only need to scan the
// 27 cells around each boid. Backed by typed arrays + Int32Array head/next
// linked lists so we never allocate per frame.
class SpatialHash {
  cellSize: number
  capacity: number
  // Open addressing isn't worth the complexity here; a Map is fine because we
  // call .clear() once per tick and only insert n entries.
  private buckets: Map<number, number> = new Map()
  private next: Int32Array

  constructor(cellSize: number, capacity: number) {
    this.cellSize = cellSize
    this.capacity = capacity
    this.next = new Int32Array(capacity)
  }

  private hash(cx: number, cy: number, cz: number) {
    // Three large primes — collisions are fine, we re-test by distance.
    return (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)
  }

  clear() {
    this.buckets.clear()
  }

  insert(idx: number, x: number, y: number, z: number) {
    const cs = this.cellSize
    const cx = Math.floor(x / cs)
    const cy = Math.floor(y / cs)
    const cz = Math.floor(z / cs)
    const h = this.hash(cx, cy, cz)
    const head = this.buckets.get(h)
    this.next[idx] = head === undefined ? -1 : head
    this.buckets.set(h, idx)
  }

  /**
   * Visit each candidate neighbor; the caller must still re-test by squared
   * distance because false positives across cell boundaries are expected.
   */
  forEachNeighbor(x: number, y: number, z: number, cb: (j: number) => void) {
    const cs = this.cellSize
    const cx = Math.floor(x / cs)
    const cy = Math.floor(y / cs)
    const cz = Math.floor(z / cs)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const h = this.hash(cx + dx, cy + dy, cz + dz)
          let j = this.buckets.get(h)
          while (j !== undefined && j !== -1) {
            cb(j)
            const nj = this.next[j]
            if (nj === -1) break
            j = nj
          }
        }
      }
    }
  }
}

// ─── Boids state container ───
interface BoidState {
  positions: Float32Array
  velocities: Float32Array
  accelerations: Float32Array
  opacities: Float32Array
  scaleJitter: Float32Array
  grid: SpatialHash
  count: number
}

function initBoidState(count: number): BoidState {
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)
  const accelerations = new Float32Array(count * 3)
  const opacities = new Float32Array(count)
  const scaleJitter = new Float32Array(count)

  // Mulberry32 — deterministic so every page load opens with the same
  // composition. Same seed used by the static SVG fallback, which means
  // the loading-state SVG and the WebGL first frame land on near-identical
  // arrangements and the handoff is invisible.
  let s = 0xc045
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Off-screen entry — cluster spawns to the left of the visible canvas
  // (inside the radial-mask's transparent ring on desktop, past the camera
  // frustum on narrower aspects), with every cursor's velocity pointing
  // right. The flock streams in as one cohesive group; cohesion (5.5 u
  // radius) and alignment (weight 2.2) keep them together while the
  // attractor + swirl take over once they reach the visible region.
  const CLUSTER_CX = -BOUND_X + 2 // -13 — well inside the toroidal bound, hidden by mask/frustum
  const CLUSTER_CY = 0
  const CLUSTER_CZ = 0
  const CLUSTER_HALF_W = 2.0
  const CLUSTER_HALF_H = 2.5
  const CLUSTER_HALF_Z = 1.2
  const aspect = CLUSTER_HALF_W / CLUSTER_HALF_H
  const cols = Math.max(1, Math.round(Math.sqrt(count * aspect)))
  const rows = Math.max(1, Math.ceil(count / cols))
  const cellW = (CLUSTER_HALF_W * 2) / cols
  const cellH = (CLUSTER_HALF_H * 2) / rows

  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    // Confine jitter to the middle 60% of each cell so the spacing stays
    // visually even while never landing on a perfect lattice.
    const jx = 0.2 + rng() * 0.6
    const jy = 0.2 + rng() * 0.6
    const x = CLUSTER_CX - CLUSTER_HALF_W + (col + jx) * cellW
    const y = CLUSTER_CY - CLUSTER_HALF_H + (row + jy) * cellH
    const z = CLUSTER_CZ + (rng() - 0.5) * CLUSTER_HALF_Z * 2

    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    // All cursors enter heading +X with a small ±10° spread, so the flock
    // reads as a single inbound mass rather than a wedge. A tiny upward
    // bias (+0.05 rad) sets the flock arcing toward the attractor's t=0
    // position at (0, 4, 0).
    const angleMath = 0.05 + (rng() - 0.5) * 0.34
    const speed = 2.6 + rng() * 0.4
    velocities[i * 3] = Math.cos(angleMath) * speed
    velocities[i * 3 + 1] = Math.sin(angleMath) * speed
    velocities[i * 3 + 2] = (rng() - 0.5) * 0.3

    const zNorm = (z + BOUND_Z) / (2 * BOUND_Z)
    opacities[i] = Math.max(
      0.32,
      Math.min(0.92, 0.45 + zNorm * 0.4 + (rng() - 0.5) * 0.16)
    )
    scaleJitter[i] = 0.92 + rng() * 0.24
  }

  return {
    positions,
    velocities,
    accelerations,
    opacities,
    scaleJitter,
    grid: new SpatialHash(Math.sqrt(COHESION_RADIUS_SQ), count),
    count,
  }
}

function stepBoids(
  s: BoidState,
  dt: number,
  time: number,
  mx: number,
  my: number,
  mz: number,
  mouseStrength: number
) {
  const { positions: P, velocities: V, accelerations: A, count: n, grid } = s

  // Slowly-orbiting invisible attractor — gives the flock its overall arc.
  const ax = Math.sin(time * 0.13) * 8 + Math.sin(time * 0.31) * 5
  const ay = Math.cos(time * 0.17) * 4 + Math.sin(time * 0.27) * 3
  const az = Math.sin(time * 0.19) * 1.5

  // Repopulate the spatial hash from the current frame's positions.
  grid.clear()
  for (let i = 0; i < n; i++) {
    grid.insert(i, P[i * 3], P[i * 3 + 1], P[i * 3 + 2])
  }

  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    const ix = P[i3]
    const iy = P[i3 + 1]
    const iz = P[i3 + 2]
    const ivx = V[i3]
    const ivy = V[i3 + 1]
    const ivz = V[i3 + 2]

    let sepX = 0
    let sepY = 0
    let sepZ = 0
    let alX = 0
    let alY = 0
    let alZ = 0
    let coX = 0
    let coY = 0
    let coZ = 0
    let alCount = 0
    let coCount = 0

    grid.forEachNeighbor(ix, iy, iz, (j) => {
      if (j === i) return
      const j3 = j * 3
      const dx = P[j3] - ix
      const dy = P[j3 + 1] - iy
      const dz = P[j3 + 2] - iz
      const d2 = dx * dx + dy * dy + dz * dz

      if (d2 < SEP_RADIUS_SQ && d2 > 1e-6) {
        const inv = 1 / Math.sqrt(d2)
        sepX -= dx * inv
        sepY -= dy * inv
        sepZ -= dz * inv
      }
      if (d2 < NEIGHBOR_RADIUS_SQ) {
        alX += V[j3]
        alY += V[j3 + 1]
        alZ += V[j3 + 2]
        alCount++
      }
      if (d2 < COHESION_RADIUS_SQ) {
        coX += P[j3]
        coY += P[j3 + 1]
        coZ += P[j3 + 2]
        coCount++
      }
    })

    let fx = sepX * SEP_WEIGHT
    let fy = sepY * SEP_WEIGHT
    let fz = sepZ * SEP_WEIGHT

    if (alCount > 0) {
      const inv = 1 / alCount
      fx += (alX * inv - ivx) * ALIGN_WEIGHT
      fy += (alY * inv - ivy) * ALIGN_WEIGHT
      fz += (alZ * inv - ivz) * ALIGN_WEIGHT
    }
    if (coCount > 0) {
      const inv = 1 / coCount
      fx += (coX * inv - ix) * COHESION_WEIGHT
      fy += (coY * inv - iy) * COHESION_WEIGHT
      fz += (coZ * inv - iz) * COHESION_WEIGHT
    }

    // Soft attractor with falloff inside 2u → flock orbits, never collapses.
    const tdx = ax - ix
    const tdy = ay - iy
    const tdz = az - iz
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz) || 1e-4
    const reach = Math.min(1, Math.max(0, (tdist - 2) / 4))
    const inv = 1 / tdist
    fx += tdx * inv * reach * ATTRACT_WEIGHT
    fy += tdy * inv * reach * ATTRACT_WEIGHT
    fz += tdz * inv * reach * ATTRACT_WEIGHT

    // Tangential swirl — induces rotation around the attractor.
    fx += -tdy * inv * reach * SWIRL_WEIGHT
    fy += tdx * inv * reach * SWIRL_WEIGHT

    // Pointer repulsion + curl — flock parts and folds around the cursor.
    if (mouseStrength > 0) {
      const mdx = ix - mx
      const mdy = iy - my
      const mdz = iz - mz
      const md2 = mdx * mdx + mdy * mdy + mdz * mdz
      const mr2 = MOUSE_RADIUS * MOUSE_RADIUS
      if (md2 < mr2) {
        const md = Math.sqrt(md2) || 1e-4
        const t = 1 - md / MOUSE_RADIUS
        const force = t * t * MOUSE_FORCE * mouseStrength
        const minv = 1 / md
        fx += mdx * minv * force
        fy += mdy * minv * force
        fz += mdz * minv * force
        // Tangential — curl around rather than just push away.
        fx += -mdy * minv * force * MOUSE_TANGENT
        fy += mdx * minv * force * MOUSE_TANGENT
      }
    }

    // Clamp force magnitude.
    const fmag2 = fx * fx + fy * fy + fz * fz
    if (fmag2 > MAX_FORCE * MAX_FORCE) {
      const k = MAX_FORCE / Math.sqrt(fmag2)
      fx *= k
      fy *= k
      fz *= k
    }

    A[i3] = fx
    A[i3 + 1] = fy
    A[i3 + 2] = fz
  }

  // Integrate.
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    let vx = V[i3] * DAMPING + A[i3] * dt
    let vy = V[i3 + 1] * DAMPING + A[i3 + 1] * dt
    let vz = V[i3 + 2] * DAMPING + A[i3 + 2] * dt

    const sp2 = vx * vx + vy * vy + vz * vz
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(sp2)
      vx *= k
      vy *= k
      vz *= k
    } else if (sp2 < MIN_SPEED * MIN_SPEED && sp2 > 1e-4) {
      const k = MIN_SPEED / Math.sqrt(sp2)
      vx *= k
      vy *= k
      vz *= k
    }

    V[i3] = vx
    V[i3 + 1] = vy
    V[i3 + 2] = vz

    P[i3] += vx * dt
    P[i3 + 1] += vy * dt
    P[i3 + 2] += vz * dt

    // Toroidal wrap — cursors leaving one edge re-enter the other.
    if (P[i3] > BOUND_X) P[i3] -= BOUND_X * 2
    else if (P[i3] < -BOUND_X) P[i3] += BOUND_X * 2
    if (P[i3 + 1] > BOUND_Y) P[i3 + 1] -= BOUND_Y * 2
    else if (P[i3 + 1] < -BOUND_Y) P[i3 + 1] += BOUND_Y * 2
    if (P[i3 + 2] > BOUND_Z) P[i3 + 2] -= BOUND_Z * 2
    else if (P[i3 + 2] < -BOUND_Z) P[i3 + 2] += BOUND_Z * 2
  }
}

// ─── Mouse → world coordinate projection (z=0 plane) ───
function useMouseWorld() {
  const { camera, gl, size } = useThree()
  const mouseWorld = useRef(new THREE.Vector3(1e6, 1e6, 0))
  const decay = useRef(0)

  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return

    const tmp = new THREE.Vector3()
    const onMove = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1

      tmp.set(ndcX, ndcY, 0.5).unproject(camera)
      tmp.sub(camera.position).normalize()
      const t = -camera.position.z / tmp.z
      mouseWorld.current
        .copy(camera.position)
        .addScaledVector(tmp, t)
      decay.current = 1.0
    }

    window.addEventListener("pointermove", onMove, { passive: true })
    return () => window.removeEventListener("pointermove", onMove)
  }, [camera, gl, size])

  return { mouseWorld, decay }
}

// ─── Flock instance ───
function Flock({ count }: { count: number }) {
  const fillRef = useRef<THREE.InstancedMesh>(null!)
  const haloRef = useRef<THREE.InstancedMesh>(null!)
  const { mouseWorld, decay } = useMouseWorld()
  const visibleRef = useRef(true)
  const parentOpacityRef = useRef<HTMLElement | null>(null)

  const state = useMemo(() => initBoidState(count), [count])

  const fillGeo = useMemo(() => makeCursorGeometry(), [])
  const haloGeo = useMemo(() => makeCursorHaloGeometry(), [])

  // White cursor body. Per-instance opacity via a shader patch — keeps the
  // promise of one material / one draw call regardless of count.
  const fillMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute float aOpacity;\nvarying float vOpacity;\n" +
        shader.vertexShader.replace(
          "void main() {",
          "void main() {\n  vOpacity = aOpacity;"
        )
      shader.fragmentShader =
        "varying float vOpacity;\n" +
        shader.fragmentShader.replace(
          "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
          "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vOpacity );"
        )
    }
    return m
  }, [])

  // Halo behind each cursor — a darker silhouette that reads as a soft rim,
  // so overlapping cursors don't merge into a single white blob.
  const haloMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      depthTest: false,
    })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute float aOpacity;\nvarying float vOpacity;\n" +
        shader.vertexShader.replace(
          "void main() {",
          "void main() {\n  vOpacity = aOpacity;"
        )
      shader.fragmentShader =
        "varying float vOpacity;\n" +
        shader.fragmentShader.replace(
          "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
          "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vOpacity );"
        )
    }
    return m
  }, [])

  // Wire up the per-instance opacity attribute once. Sharing the same
  // Float32Array between fill + halo means a single source of truth.
  useEffect(() => {
    if (!fillRef.current || !haloRef.current) return
    const attr = new THREE.InstancedBufferAttribute(state.opacities, 1)
    fillRef.current.geometry.setAttribute("aOpacity", attr)
    haloRef.current.geometry.setAttribute("aOpacity", attr)
  }, [state])

  // Cache the parent #beams-bg element so we can short-circuit the rAF loop
  // when the hero scroll choreography fades the layer to ~0 opacity. Saves
  // 100% of CPU once the user scrolls past the hero.
  useEffect(() => {
    parentOpacityRef.current = document.getElementById("beams-bg")
    if (!parentOpacityRef.current) return
    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true
      },
      { threshold: 0 }
    )
    io.observe(parentOpacityRef.current)
    return () => io.disconnect()
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const accumulator = useRef(0)

  useFrame((rstate, delta) => {
    if (!visibleRef.current) return

    // Skip while the parent is faded out by the hero scroll choreography —
    // boids state stays paused, so when the user scrolls back the flock
    // resumes from where it left off rather than snapping to a new layout.
    const parent = parentOpacityRef.current
    if (parent) {
      const op = parent.style.opacity
      if (op !== "" && parseFloat(op) < 0.05) return
    }

    // Fixed timestep — prevents acceleration on 144Hz displays from blowing
    // through the spring forces, while letting the actual render run free.
    accumulator.current += Math.min(delta, 0.1)
    while (accumulator.current >= FIXED_DT) {
      stepBoids(
        state,
        FIXED_DT,
        rstate.clock.elapsedTime,
        mouseWorld.current.x,
        mouseWorld.current.y,
        mouseWorld.current.z,
        decay.current
      )
      decay.current = Math.max(0, decay.current - FIXED_DT * MOUSE_DECAY_PER_S)
      accumulator.current -= FIXED_DT
    }

    const P = state.positions
    const V = state.velocities
    const J = state.scaleJitter
    const fillMesh = fillRef.current
    const haloMesh = haloRef.current
    if (!fillMesh || !haloMesh) return

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const x = P[i3]
      const y = P[i3 + 1]
      const z = P[i3 + 2]
      const vx = V[i3]
      const vy = V[i3 + 1]

      // Default cursor shape points NW (135°). Subtract 3π/4 so the tip
      // leads in the direction of motion.
      const angle = Math.atan2(vy, vx) - Math.PI * 0.75

      // Depth → scale ramp (0.20 → 0.32 base × per-cursor jitter).
      const zNorm = (z + BOUND_Z) / (2 * BOUND_Z)
      const scale = (0.20 + zNorm * 0.12) * J[i]

      dummy.position.set(x, y, z)
      dummy.rotation.set(0, 0, angle)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      fillMesh.setMatrixAt(i, dummy.matrix)
      haloMesh.setMatrixAt(i, dummy.matrix)
    }

    fillMesh.instanceMatrix.needsUpdate = true
    haloMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={haloRef} args={[haloGeo, haloMat, count]} renderOrder={0} />
      <instancedMesh ref={fillRef} args={[fillGeo, fillMat, count]} renderOrder={1} />
    </>
  )
}

// ─── Public component ───
export default function CursorMurmurationFlock({ count }: { count: number }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop="always"
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      }}
      camera={{ position: [0, 0, 18], fov: 40, near: 0.1, far: 60 }}
      style={{ background: "transparent" }}
    >
      <Flock count={count} />
    </Canvas>
  )
}
