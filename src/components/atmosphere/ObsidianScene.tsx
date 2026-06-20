import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Float } from "@react-three/drei";
// Selective import so the bundler can drop the rest of Three.js.
import { OctahedronGeometry } from "three";

/**
 * ObsidianScene — subtle 3D obsidian shards drifting behind the home page.
 *
 * Obsidian Gold redesign:
 *   • 4 shards (down from 5) — quieter, less busy
 *   • Very slow rotation / float (gentler than before)
 *   • 0.3 opacity overall (down from 0.4)
 *   • Gold emissive instead of crimson — matches the new design language
 *   • Only renders on the home page (controlled by AtmosphericLayer's show3d)
 */
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
    // Very slow, gentle float — the scene sits quietly behind the home page.
    <Float speed={0.35} rotationIntensity={0.14} floatIntensity={0.22}>
      <mesh position={position} rotation={rotation} geometry={geometry}>
        <meshStandardMaterial
          color="#0a0a12"
          emissive="#f5b942"
          emissiveIntensity={0.06}
          metalness={0.85}
          roughness={0.45}
          transparent
          opacity={0.5}
        />
      </mesh>
    </Float>
  );
}

function ObsidianShards() {
  // 4 shards — subtler, less busy on the home page.
  const shards = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
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
      <pointLight position={[4, 4, 6]} intensity={0.4} color="#f5b942" />
      <pointLight position={[-6, -2, 4]} intensity={0.2} color="#8b5cf6" />
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
    <div className={className} aria-hidden="true" style={{ opacity: 0.3 }}>
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
