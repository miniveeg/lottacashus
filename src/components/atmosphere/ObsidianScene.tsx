import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Float } from "@react-three/drei";
// Selective import so the bundler can drop the rest of Three.js.
import { OctahedronGeometry, type WebGLRenderer } from "three";

// ────────────────────────────────────────────────────────────────────────────
// Console noise filter (installed once per page load).
// ────────────────────────────────────────────────────────────────────────────
// Three.js r183 deprecated `THREE.Clock` in favour of `THREE.Timer`, but
// @react-three/fiber v9.6.1 still instantiates `new THREE.Clock()` for its
// internal store (the `state.clock` consumed by `useFrame` and by drei's
// `<Float>` via `state.clock.elapsedTime`). We cannot migrate R3F's internals
// from app code, so the deprecation warning is unavoidable noise that we
// silence here.
//
// We also silence the `WebGLRenderer: Context Lost.` / `Context Restored.`
// log lines that Three emits when `gl.forceContextLoss()` is called. R3F
// invokes `forceContextLoss()` 500ms after a `<Canvas>` unmounts as part of
// its standard disposal flow (see `unmountComponentAtNode` in
// `@react-three/fiber`), and our own `<ObsidianScene>` cleanup calls it
// immediately for prompt GPU-memory release. The resulting `webglcontextlost`
// event is the *expected* signal that the context has been released — it is
// not a bug — but the log line buries real warnings during route changes.
//
// The filter is idempotent and conservatively matches exact strings only.
// We deliberately do NOT suppress `THREE.WebGLRenderer: A WebGL context
// could not be created.` — that's a real error logged via `console.error`
// (not warn/log) and would indicate a genuine GPU/driver problem.
// ────────────────────────────────────────────────────────────────────────────
const THREE_NOISE_MESSAGES = new Set([
  "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.",
  "THREE.WebGLRenderer: Context Lost.",
  "THREE.WebGLRenderer: Context Restored.",
]);

function installThreeNoiseFilter(): void {
  const c = console as unknown as {
    __lcThreeNoiseFilter?: boolean;
    warn: typeof console.warn;
    log: typeof console.log;
  };
  if (c.__lcThreeNoiseFilter) return;
  const wrap =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (typeof args[0] === "string" && THREE_NOISE_MESSAGES.has(args[0])) return;
      fn(...args);
    };
  c.warn = wrap(c.warn.bind(c) as (...args: unknown[]) => void) as typeof console.warn;
  c.log = wrap(c.log.bind(c) as (...args: unknown[]) => void) as typeof console.log;
  c.__lcThreeNoiseFilter = true;
}

installThreeNoiseFilter();

// ────────────────────────────────────────────────────────────────────────────
// Mobile / reduced-motion gating.
// ────────────────────────────────────────────────────────────────────────────
// The 3D scene is purely decorative. We disable it entirely:
//   - on small viewports (the obsidian shards are designed for a wide canvas
//     and the GPU cost is disproportionate on phones), and
//   - when the user prefers reduced motion (the shards float/rotate, which
//     qualifies as motion that should be suppressed).
//
// The initial state is computed lazily so we don't briefly mount the Canvas
// and then unmount it on the first paint (which would itself trigger a
// `Context Lost` log). The component is only ever rendered client-side
// (the App is dynamic-imported with `ssr:false` in `src/app/page.tsx`), so
// reading `window.matchMedia` in a `useState` initializer is safe.
const MOBILE_MEDIA = "(max-width: 768px)";
const REDUCED_MOTION_MEDIA = "(prefers-reduced-motion: reduce)";

function shouldEnableScene(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  if (window.matchMedia(MOBILE_MEDIA).matches) return false;
  if (window.matchMedia(REDUCED_MOTION_MEDIA).matches) return false;
  return true;
}

function useSceneEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(shouldEnableScene);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mobileMql = window.matchMedia(MOBILE_MEDIA);
    const reducedMql = window.matchMedia(REDUCED_MOTION_MEDIA);
    const update = () => setEnabled(shouldEnableScene());
    update();
    mobileMql.addEventListener("change", update);
    reducedMql.addEventListener("change", update);
    return () => {
      mobileMql.removeEventListener("change", update);
      reducedMql.removeEventListener("change", update);
    };
  }, []);
  return enabled;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene contents.
// ────────────────────────────────────────────────────────────────────────────
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

  // Dispose the GPU geometry when the shard unmounts. R3F auto-disposes
  // materials attached to declarative meshes, but geometry passed via the
  // `geometry={...}` prop is *not* auto-disposed (it might be shared), so we
  // own its lifecycle.
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <Float speed={1.2} rotationIntensity={0.4} floatIntensity={0.6}>
      <mesh position={position} rotation={rotation} geometry={geometry}>
        <meshStandardMaterial
          color="#1a0a14"
          emissive="#dc143c"
          emissiveIntensity={0.6}
          metalness={0.9}
          roughness={0.25}
          transparent
          opacity={0.92}
        />
      </mesh>
    </Float>
  );
}

function ObsidianShards() {
  const shards = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        position: [
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 6 - 2,
        ] as [number, number, number],
        rotation: [Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI] as [
          number,
          number,
          number,
        ],
        scale: 0.25 + Math.random() * 0.45,
        key: i,
      })),
    []
  );

  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[4, 4, 6]} intensity={1.4} color="#dc143c" />
      <pointLight position={[-6, -2, 4]} intensity={0.7} color="#8b5cf6" />
      <directionalLight position={[0, 5, 5]} intensity={0.6} color="#ffd166" />
      {shards.map((s) => (
        <Shard key={s.key} position={s.position} rotation={s.rotation} scale={s.scale} />
      ))}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Scene wrapper.
// ────────────────────────────────────────────────────────────────────────────
type ObsidianSceneProps = {
  className?: string;
};

export function ObsidianScene({ className }: ObsidianSceneProps) {
  const enabled = useSceneEnabled();
  // Hold the WebGLRenderer so we can dispose it *immediately* on unmount
  // rather than waiting for R3F's internal 500ms timeout (see
  // `unmountComponentAtNode` in @react-three/fiber). Prompt disposal is
  // important because a fast / → /#/mines → / navigation cycle mounts and
  // unmounts ObsidianScene twice in quick succession (one in AppShell's
  // AtmosphericLayer), and the brief double-existence window could
  // otherwise exceed the browser's ~16-context WebGL limit on low-end
  // devices. The component itself is only ever mounted once at a time
  // (Home.tsx intentionally does NOT mount a second instance — see
  // Home.tsx:11-16). Audit issue M4 (stale "two instances" comment).
  const glRef = useRef<WebGLRenderer | null>(null);

  // Pause the 3D scene's render loop when the tab is hidden (audit H5).
  // R3F's `useFrame` callbacks (and drei's <Float>) only run when
  // `frameloop="always"`. Switching to "never" stops the rAF loop, freeing
  // the GPU and avoiding wasted composites on background tabs. Browsers
  // already throttle rAF to ~1 fps on hidden tabs, but 1 fps × WebGL
  // composite still adds up on mobile.
  const [frameloop, setFrameloop] = useState<"always" | "never">(
    typeof document !== "undefined" && document.hidden ? "never" : "always"
  );
  useEffect(() => {
    const onVisibility = () => setFrameloop(document.hidden ? "never" : "always");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Dispose the WebGLRenderer *immediately* on unmount or when the scene is
  // gated off (mobile / reduced-motion toggle), rather than waiting for
  // R3F's internal 500ms timeout (see `unmountComponentAtNode` in
  // @react-three/fiber). Prompt disposal matters because a fast
  // / → /#/mines → / navigation cycle can otherwise approach the
  // browser's ~16-context WebGL limit. The cleanup reads `glRef.current`
  // at *cleanup* time (not at effect-run time) because `onCreated` fires
  // asynchronously after the Canvas mounts — capturing `gl` in the effect
  // body would always see `null` on the first run.
  useEffect(() => {
    return () => {
      const gl = glRef.current;
      if (!gl) return;
      // Mark as already-collected so any later handler (e.g. R3F's delayed
      // `forceContextLoss()` call) is a no-op on a renderer we've torn down.
      glRef.current = null;
      try {
        // Free GPU resources (textures, framebuffers, programs).
        gl.dispose();
        // Release the WebGL context. R3F would do this 500ms later; doing
        // it now keeps the context count tight. The `webglcontextlost`
        // event it fires is suppressed by our noise filter above.
        gl.forceContextLoss();
      } catch {
        /* renderer may already be disposed — safe to ignore */
      }
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 45 }}
        dpr={[1, 1.5]}
        frameloop={frameloop}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
        onCreated={({ gl }) => {
          glRef.current = gl;
        }}
      >
        <Suspense fallback={null}>
          <ObsidianShards />
        </Suspense>
      </Canvas>
    </div>
  );
}
