import { Link } from "react-router-dom";
import { ORIGINALS_PATH } from "../../content/originals";
import "./NotFound.css";

export function NotFound() {
  return (
    <div className="not-found lc-page">
      <div className="not-found__card">
        <p className="not-found__code" aria-hidden="true">
          404
        </p>
        <h1 className="not-found__title">Page not found</h1>
        <p className="not-found__text">
          That link doesn&apos;t exist or may have moved. Head back home or jump straight into
          Originals.
        </p>
        <div className="not-found__actions">
          <Link to="/" className="not-found__btn not-found__btn--gold">
            Back to home
          </Link>
          <Link to={ORIGINALS_PATH} className="not-found__btn not-found__btn--outline">
            Browse originals
          </Link>
        </div>
      </div>
    </div>
  );
}
