import { useLocation } from "react-router-dom";

export function Placeholder() {
  const { pathname } = useLocation();

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Coming soon</h1>
      <p>This page is being redesigned.</p>
      <p>
        <code>{pathname}</code>
      </p>
    </main>
  );
}
