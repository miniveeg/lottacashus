export function GameThumb({ id }: { id: string }) {
  return <img src={`/art/${id}.webp`} alt="" className="game-print" aria-hidden="true" />;
}
