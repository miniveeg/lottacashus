import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="game-page">
      <h1>404</h1>
      <p className="lede">That table does not exist. The pit boss shrugged.</p>
      <Link to="/" className="btn btn-gold">
        Back to lobby
      </Link>
    </div>
  );
}
