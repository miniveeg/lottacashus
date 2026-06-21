import { lazy, Suspense } from "react";
import "../../styles/atmosphere.css";

const ObsidianSceneLazy = lazy(() =>
  import("./ObsidianScene").then((m) => ({ default: m.ObsidianScene }))
);

type AtmosphericLayerProps = {
  show3d?: boolean;
};

export function AtmosphericLayer({ show3d = true }: AtmosphericLayerProps) {
  return (
    <div className="lc-atmosphere" aria-hidden="true">
      {show3d ? (
        <Suspense fallback={null}>
          <ObsidianSceneLazy className="lc-atmosphere__canvas" />
        </Suspense>
      ) : null}
      <div className="lc-atmosphere__fog" />
      <div className="lc-atmosphere__noise" />
      <div className="lc-atmosphere__vignette" />
    </div>
  );
}
