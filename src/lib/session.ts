// JWT session helpers shared by the proxy and server code. Uses `jose` (runtime-agnostic, no Node-only APIs).
import { jwtVerify, SignJWT } from "jose";

export type Role = "admin" | "team";
export type Session = { role: Role; email: string; ver: number; exp: number };

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

export async function signSession(s: { role: Role; email: string; ver: number }, maxAgeSeconds: number) {
  return new SignJWT({ role: s.role, email: s.email, ver: s.ver })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(s.role)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(secretKey());
}

/** Returns the session for a valid, unexpired token, otherwise null. */
export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    const role = payload.role;
    if ((role !== "admin" && role !== "team") || typeof payload.email !== "string" || typeof payload.ver !== "number") return null;
    return { role, email: payload.email, ver: payload.ver, exp: payload.exp ?? 0 };
  } catch {
    return null;
  }
}

/** Pages only admins may open. */
export const ADMIN_PAGES = ["/setup"];
