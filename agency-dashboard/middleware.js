/* global process */
// Vercel Routing Middleware (runs on Vercel only, not in `npm run dev`).
// Site lock: with VITE_SITE_PASSWORD set, the browser asks for it (any username)
// before serving any file. The same value is built into the app, which sends it
// to the backend API, so it must match the backend's SITE_PASSWORD.
export default function middleware(request) {
  const password = process.env.VITE_SITE_PASSWORD;
  if (!password) return;
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      if (decoded.slice(decoded.indexOf(":") + 1) === password) return;
    } catch {
      // malformed header: ask again
    }
  }
  return new Response("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Community4You Agency Portal", charset="UTF-8"' },
  });
}
