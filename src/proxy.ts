import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_PAGES, MEMBER_BLOCKED_PAGES, SESSION_COOKIE, SHARED_BLOCKED_PAGES, homePageFor, verifySession } from "@/lib/session";

// First line of defence: every page and API needs a valid signed session.
// API routes and server layouts check again (including revocation), so this is never the only check.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    const res = NextResponse.redirect(login);
    if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const blocked = [
    ...(session.role === "admin" ? [] : ADMIN_PAGES),
    ...(session.role === "member" ? MEMBER_BLOCKED_PAGES : []),
    ...(session.role === "team" ? SHARED_BLOCKED_PAGES : []),
  ];
  if (blocked.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL(homePageFor(session.role), req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
