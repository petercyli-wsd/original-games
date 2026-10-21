import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="not-found">
      <h1>404</h1>
      <p>That game doesn't exist (yet).</p>
      <Link to="/" className="btn-ghost">
        Back to the lobby
      </Link>
    </main>
  );
}
