import { NextResponse, type NextRequest } from "next/server";
import { corsHeaders } from "@/lib/http";

// Site lock: with SITE_PASSWORD set, every page and API route needs that password.
// Browsers get the sign-in box (any username); the dashboard sends "Authorization: Bearer <password>".
// The SMS webhook stays open (it's HMAC-signed), and so do CORS preflights.
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const path = req.nextUrl.pathname;
  if (!password || req.method === "OPTIONS" || path.startsWith("/api/smsgate")) return NextResponse.next();
  if (givenPassword(req.headers.get("authorization")) === password) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return Response.json({ error: "Password required" }, { status: 401, headers: corsHeaders(req) });
  }
  return new Response("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Community4You", charset="UTF-8"' },
  });
}

function givenPassword(header: string | null): string | null {
  if (header?.startsWith("Bearer ")) return header.slice(7);
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      return decoded.slice(decoded.indexOf(":") + 1);
    } catch {
      return null;
    }
  }
  return null;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
