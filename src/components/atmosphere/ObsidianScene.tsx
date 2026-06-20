import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Float } from "@react-three/drei";
// Selective import so the bundler can drop the rest of Three.js.
import { OctahedronGeometry } from "three";

function Shard({
  position,
  rotation,
  scale,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}) {
  const geometry = useMemo(() => {
    const geo = new OctahedronGeometry(1, 0);
    geo.scale(scale, scale * 1.4, scale * 0.6);
    return geo;
  }, [scale]);

  return (
    // Slower, gentler float than the previous config — the scene is meant to
    // sit quietly behind the home page, not draw the eye.
    <Float speed={0.55} rotationIntensity={0.22} floatIntensity={0.32}>
      <mesh position={position} rotation={rotation} geometry={geometry}>
        <meshStandardMaterial
          color="#0a0a12"
          emissive="#dc143c"
          emissiveIntensity={0.10}
          metalness={0.85}
          roughness={0.4}
          transparent
          opacity={0.55}
        />
      </mesh>
    </Float>
  );
}

function ObsidianShards() {
  // Fewer shards (5 vs 8) — subtler, less busy on home page.
  const shards = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        position: [
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 6 - 2,
        ] as [number, number, number],
        rotation: [
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        ] as [number, number, number],
        scale: 0.22 + Math.random() * 0.38,
        key: i,
      })),
    []
  );

  return (
    <>
      <ambientLight intensity={0.22} />
      <pointLight position={[4, 4, 6]} intensity={0.55} color="#dc143c" />
      <pointLight position={[-6, -2, 4]} intensity={0.28} color="#8b5cf6" />
      {shards.map((s) => (
        <Shard key={s.key} position={s.position} rotation={s.rotation} scale={s.scale} />
      ))}
    </>
  );
}

type ObsidianSceneProps = {
  className?: string;
};

export function ObsidianScene({ className }: ObsidianSceneProps) {
  return (
    <div className={className} aria-hidden="true" style={{ opacity: 0.4 }}>
      <Canvas
        camera={{ position: [0, 0, 8], fov: 45 }}
        dpr={[1, 1.25]}
        gl={{ antialias: true, alpha: true, powerPreference: "default" }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <ObsidianShards />
        </Suspense>
      </Canvas>
    </div>
  );
}
