// JWT session helpers shared by the proxy and server code. Uses `jose` (runtime-agnostic, no Node-only APIs).
import { jwtVerify, SignJWT } from "jose";

/** "member" is a personal login tied to one team member; "team" is the shared login. */
export type Role = "admin" | "team" | "member";
/** Shared and administrator logins that a password can be set for outside of a member record. */
export type SharedRole = "admin" | "team";
export type Session = { role: Role; email: string; ver: number; exp: number; mid?: string };

export const SESSION_COOKIE = "incrix_session";
export const SESSION_SHORT_SECONDS = 12 * 60 * 60; // 12 hours
export const SESSION_LONG_SECONDS = 30 * 24 * 60 * 60; // 30 days ("Keep me signed in")
const ISSUER = "incrix-effort-tracker";
const AUDIENCE = "incrix-effort-tracker:web";

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET is missing or shorter than 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(s: { role: Role; email: string; ver: number; mid?: string }, maxAgeSeconds: number) {
  return new SignJWT({ role: s.role, email: s.email, ver: s.ver, ...(s.mid ? { mid: s.mid } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(s.mid ? `member:${s.mid}` : s.role)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(secretKey());
}

const ROLES: Role[] = ["admin", "team", "member"];

/** Returns the session for a valid, unexpired token, otherwise null. */
export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    const role = payload.role as Role;
    if (!ROLES.includes(role) || typeof payload.email !== "string" || typeof payload.ver !== "number") return null;
    const mid = typeof payload.mid === "string" ? payload.mid : undefined;
    // A personal login is meaningless without the member it belongs to.
    if ((role === "member") !== !!mid) return null;
    return { role, email: payload.email, ver: payload.ver, exp: payload.exp ?? 0, mid };
  } catch {
    return null;
  }
}

/** Pages only admins may open. */
export const ADMIN_PAGES = ["/setup", "/insights"];
/**
 * Pages showing the team person by person. A personal login sees its own dashboard instead,
 * and the shared login — which anyone may be using — sees neither these nor anyone's entries.
 */
export const MEMBER_BLOCKED_PAGES = ["/grid"];
export const SHARED_BLOCKED_PAGES = ["/grid", "/entries", "/my-insights"];

/** Where a role lands when it opens a page it isn't allowed to see. */
export const homePageFor = (role: Role) => (role === "member" ? "/log" : "/dashboard");
