export function CrateArt({ id, large = false }: { id: string; large?: boolean }) {
  return (
    <div className={`crate-art ${large ? "crate-art-lg" : ""}`} data-crate={id} aria-hidden="true">
      <span className="crate-lid" />
      <span className="crate-body" />
      <span className="crate-band" />
      <span className="crate-lock" />
      <span className="crate-glow" />
    </div>
  );
}
