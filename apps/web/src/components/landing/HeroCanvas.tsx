"use client";

import { cn } from "@/lib/cn";
import { Line } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";

const GOLD = "#c6a85a";
const GOLD_BRIGHT = "#e8d9a0";
const GOLD_DIM = "#8a7340";

const TERRAIN_BASE_Y = -1.42;
const COLS = 96;
const ROWS = 44;

function terrainHeight(x: number, z: number, t = 0): number {
  return (
    TERRAIN_BASE_Y +
    Math.sin(x * 0.72 + t * 0.35) * 0.11 +
    Math.sin(z * 1.05 + x * 0.35 + t * 0.28) * 0.08 +
    Math.sin(x * 1.85 + z * 0.55) * 0.045 +
    Math.cos(x * 0.4 - z * 0.9 + t * 0.2) * 0.05
  );
}

function buildTerrainGrid(t = 0): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const x = (i / (COLS - 1) - 0.5) * 7.2;
      const z = (j / (ROWS - 1) - 0.5) * 3.6 - 0.85;
      const y = terrainHeight(x, z, t);
      pts.push(x, y, z);
    }
  }
  return new Float32Array(pts);
}

function buildArcCurve(
  radius: number,
  yScale: number,
  yOffset: number,
  z: number,
  segments = 140,
): THREE.Vector3[] {
  const start = Math.PI * 0.58;
  const end = Math.PI * 1.42;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + ((end - start) * i) / segments;
    pts.push(
      new THREE.Vector3(
        Math.cos(a) * radius,
        Math.sin(a) * radius * yScale + yOffset,
        z,
      ),
    );
  }
  return pts;
}

function GoldenArcs() {
  const arcs = useMemo(
    () =>
      [
        { r: 2.55, yScale: 0.52, y: 0.72, z: -1.35, opacity: 0.22 },
        { r: 2.78, yScale: 0.52, y: 0.72, z: -1.35, opacity: 0.32 },
        { r: 3.02, yScale: 0.52, y: 0.72, z: -1.35, opacity: 0.42 },
        { r: 3.26, yScale: 0.52, y: 0.72, z: -1.35, opacity: 0.52 },
        { r: 3.5, yScale: 0.52, y: 0.72, z: -1.35, opacity: 0.62 },
        { r: 3.74, yScale: 0.52, y: 0.72, z: -1.35, opacity: 0.48 },
        { r: 3.98, yScale: 0.52, y: 0.72, z: -1.35, opacity: 0.32 },
      ].map((a) => ({
        ...a,
        points: buildArcCurve(a.r, a.yScale, a.y, a.z),
      })),
    [],
  );

  return (
    <group>
      {arcs.map((a) => (
        <Line
          key={a.r}
          points={a.points}
          color={GOLD_BRIGHT}
          transparent
          opacity={a.opacity}
          lineWidth={1}
        />
      ))}
    </group>
  );
}

const STEMS: { x: number; z: number; h: number }[] = [
  { x: -2.85, z: 0.35, h: 0.95 },
  { x: -2.05, z: -0.15, h: 0.72 },
  { x: -1.25, z: 0.55, h: 1.15 },
  { x: -0.45, z: -0.35, h: 0.88 },
  { x: 0.35, z: 0.25, h: 1.05 },
  { x: 1.15, z: -0.2, h: 0.78 },
  { x: 1.95, z: 0.45, h: 1.22 },
  { x: 2.75, z: -0.1, h: 0.92 },
  { x: -1.65, z: 0.05, h: 0.65 },
  { x: 0.85, z: 0.6, h: 0.7 },
];

function DataStems() {
  const stemLines = useMemo(
    () =>
      STEMS.map((s, i) => {
        const y0 = terrainHeight(s.x, s.z);
        return {
          key: i,
          points: [
            new THREE.Vector3(s.x, y0, s.z),
            new THREE.Vector3(s.x, y0 + s.h, s.z),
          ] as [THREE.Vector3, THREE.Vector3],
        };
      }),
    [],
  );

  const tops = useMemo(() => {
    return STEMS.map((s) => {
      const y0 = terrainHeight(s.x, s.z);
      return new THREE.Vector3(s.x, y0 + s.h, s.z);
    });
  }, []);

  return (
    <group>
      {stemLines.map((s) => (
        <Line
          key={s.key}
          points={s.points}
          color={GOLD}
          transparent
          opacity={0.35}
          lineWidth={1}
        />
      ))}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array(
                tops.flatMap((p) => [p.x, p.y, p.z]),
              ),
              3,
            ]}
            count={tops.length}
          />
        </bufferGeometry>
        <pointsMaterial
          color={GOLD_BRIGHT}
          size={0.065}
          transparent
          opacity={0.95}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

function ParticleTerrain({
  mouseRef,
  paused,
}: {
  mouseRef: MutableRefObject<{ x: number; y: number }>;
  paused: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  const basePositions = useMemo(() => buildTerrainGrid(0), []);
  const positions = useMemo(
    () => new Float32Array(basePositions),
    [basePositions],
  );
  const time = useRef(0);

  useFrame((_, delta) => {
    if (!ref.current || paused) return;
    time.current += delta;
    const attr = ref.current.geometry.attributes.position;
    const arr = attr.array as Float32Array;
    const { x: mx, y: my } = mouseRef.current;
    const cursorX = mx * 3.2;
    const cursorZ = my * 1.4;

    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const idx = (i * ROWS + j) * 3;
        const bx = basePositions[idx]!;
        const bz = basePositions[idx + 2]!;
        const wave = terrainHeight(bx, bz, time.current);
        const dx = bx - cursorX;
        const dz = bz - cursorZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const ripple =
          dist < 2.2
            ? Math.cos(dist * 3.2 - time.current * 4) * 0.06 * (1 - dist / 2.2)
            : 0;
        arr[idx + 1] = wave + ripple;
      }
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={positions.length / 3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={GOLD_BRIGHT}
        size={0.022}
        transparent
        opacity={0.78}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function StarfieldDust({ paused }: { paused: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const [positions] = useState(() => {
    const pts: number[] = [];
    for (let i = 0; i < 120; i++) {
      pts.push(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 4 + 0.3,
        (Math.random() - 0.5) * 4 - 1.5,
      );
    }
    return new Float32Array(pts);
  });

  useFrame((_, delta) => {
    if (!ref.current || paused) return;
    ref.current.rotation.y += delta * 0.012;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={positions.length / 3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={GOLD}
        size={0.018}
        transparent
        opacity={0.28}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

function HeroScene({
  mouseRef,
  paused,
}: {
  mouseRef: MutableRefObject<{ x: number; y: number }>;
  paused: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const smooth = useRef({ x: 0, y: 0 });

  useFrame((_, delta) => {
    if (!root.current || paused) return;
    const { x, y } = mouseRef.current;
    smooth.current.x = THREE.MathUtils.lerp(smooth.current.x, x, 0.06);
    smooth.current.y = THREE.MathUtils.lerp(smooth.current.y, y, 0.06);
    const t = performance.now() * 0.001;
    const breathe = 1 + Math.sin(t * 0.7) * 0.012;

    root.current.rotation.y = smooth.current.x * 0.14;
    root.current.rotation.x = smooth.current.y * 0.07;
    root.current.position.x = smooth.current.x * 0.18;
    root.current.position.y = smooth.current.y * 0.06;
    root.current.scale.setScalar(breathe);
  });

  return (
    <group ref={root}>
      <StarfieldDust paused={paused} />
      <GoldenArcs />
      <ParticleTerrain mouseRef={mouseRef} paused={paused} />
      <DataStems />
    </group>
  );
}

export function HeroCanvas({
  className,
  mouseRef,
  reducedMotion,
}: {
  className?: string;
  mouseRef: MutableRefObject<{ x: number; y: number }>;
  reducedMotion: boolean;
}) {
  return (
    <div className={cn(className, "pointer-events-none")}>
      <div
        className="pointer-events-none absolute left-1/2 top-[32%] z-[1] h-[min(52vh,400px)] w-[min(95vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(198,168,90,0.12),transparent_68%)] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[42%] bg-[radial-gradient(ellipse_90%_80%_at_50%_100%,rgba(198,168,90,0.09),transparent_72%)]"
        aria-hidden
      />
      <Canvas
        className="!h-full !w-full"
        camera={{ position: [0, 0.35, 5.65], fov: 48 }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        }}
        style={{ width: "100%", height: "100%", display: "block" }}
        dpr={[1, 1.75]}
      >
        <ambientLight intensity={0.45} />
        <pointLight position={[0, 2, 3]} intensity={1.1} color={GOLD_BRIGHT} />
        <pointLight position={[-3, -1, 2]} intensity={0.45} color={GOLD_DIM} />
        <HeroScene mouseRef={mouseRef} paused={reducedMotion} />
      </Canvas>
    </div>
  );
}
