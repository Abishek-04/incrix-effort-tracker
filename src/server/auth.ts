// Server-only authentication: login accounts, throttling, JWT session cookies and authorization checks.
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { cookies } from "next/headers";
import type { AccountInfo } from "@/lib/types";
import { SESSION_COOKIE, SESSION_LONG_SECONDS, SESSION_SHORT_SECONDS, signSession, verifySession, type Role, type Session } from "@/lib/session";
import { ddb, TABLE } from "./db";
import { HttpError } from "./http";
import { dummyHash, hashPassword, verifyPassword } from "./password";

export type Account = { role: Role; email: string; passwordHash: string; ver: number; updatedAt: string };

const accountKey = (role: Role) => ({ PK: "AUTH", SK: `ACCOUNT#${role}` });
const throttleKey = (email: string) => ({ PK: "AUTH", SK: `THROTTLE#${email}` });

function toAccount(item: Record<string, unknown>): Account {
  return { role: item.role as Role, email: String(item.email), passwordHash: String(item.passwordHash), ver: Number(item.ver) || 0, updatedAt: String(item.updatedAt) };
}
export const publicAccount = (a: Account): AccountInfo => ({ role: a.role, email: a.email, updatedAt: a.updatedAt });

/* ---------- accounts ---------- */
export async function getAccount(role: Role): Promise<Account | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: accountKey(role), ConsistentRead: true }));
  return r.Item ? toAccount(r.Item) : null;
}

export async function listAccounts(): Promise<Account[]> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": "AUTH", ":sk": "ACCOUNT#" },
      ConsistentRead: true,
    }),
  );
  return (r.Items ?? []).map(toAccount).sort((a) => (a.role === "admin" ? -1 : 1));
}

export async function updateAccount(role: Role, patch: { email?: string; password?: string }): Promise<Account> {
  const current = await getAccount(role);
  if (!current) throw new HttpError(404, "That login hasn't been set up yet");
  const email = patch.email ? patch.email.trim().toLowerCase() : current.email;
  const others = (await listAccounts()).filter((a) => a.role !== role);
  if (others.some((a) => a.email === email)) throw new HttpError(409, "That email is already used by the other login");
  const next: Account = {
    role, email,
    passwordHash: patch.password ? await hashPassword(patch.password) : current.passwordHash,
    ver: current.ver + 1, // invalidates every existing session for this login
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...accountKey(role), ...next } }));
  return next;
}

/** Signs out every device using this login. */
export async function revokeSessions(role: Role): Promise<Account> {
  const current = await getAccount(role);
  if (!current) throw new HttpError(404, "That login hasn't been set up yet");
  const next = { ...current, ver: current.ver + 1 };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...accountKey(role), ...next } }));
  return next;
}

/* ---------- login throttling ---------- */
const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;

async function assertNotThrottled(email: string) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: throttleKey(email) }));
  if (!r.Item) return;
  const elapsed = Date.now() - Number(r.Item.windowStart);
  if (elapsed < WINDOW_MS && Number(r.Item.count) >= MAX_FAILURES) {
    const mins = Math.ceil((WINDOW_MS - elapsed) / 60000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}

async function recordFailure(email: string) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: throttleKey(email) }));
  const now = Date.now();
  const fresh = !r.Item || now - Number(r.Item.windowStart) >= WINDOW_MS;
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { ...throttleKey(email), count: fresh ? 1 : Number(r.Item!.count) + 1, windowStart: fresh ? now : Number(r.Item!.windowStart) },
    }),
  );
}

export async function authenticate(emailInput: string, password: string): Promise<Account> {
  const email = emailInput.trim().toLowerCase();
  await assertNotThrottled(email);
  const account = (await listAccounts()).find((a) => a.email === email) ?? null;
  // Always run a hash comparison so unknown emails take as long as wrong passwords.
  const ok = await verifyPassword(password, account?.passwordHash ?? (await dummyHash()));
  if (!account || !ok) {
    await recordFailure(email);
    throw new HttpError(401, "Email or password is incorrect");
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: throttleKey(email) }));
  return account;
}

/* ---------- sessions ---------- */
// Read the login's session version on every check (one consistent DynamoDB read) so revocation is immediate.
// An in-memory cache would not be shared between Next.js page and API bundles or between Vercel instances,
// letting a revoked session keep working until each copy expired.
async function currentVersion(role: Role) {
  return (await getAccount(role))?.ver ?? -1;
}

/** The signed-in session, or null if missing, expired, tampered with or revoked. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  return session.ver === (await currentVersion(session.role)) ? session : null;
}

export async function requireSession(role?: "admin"): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Your session has ended — please sign in again");
  if (role === "admin" && session.role !== "admin") throw new HttpError(403, "Only administrators can do that");
  return session;
}

function isHttps(req: Request) {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

async function writeCookie(req: Request, account: Account, maxAge: number) {
  const token = await signSession({ role: account.role, email: account.email, ver: account.ver }, maxAge);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: isHttps(req), sameSite: "lax", path: "/", maxAge });
}

export function setSessionCookie(req: Request, account: Account, remember: boolean) {
  return writeCookie(req, account, remember ? SESSION_LONG_SECONDS : SESSION_SHORT_SECONDS);
}

/** Keeps the current admin signed in (same expiry) after their own login's version changes. */
export function reissueSession(req: Request, account: Account, session: Session) {
  return writeCookie(req, account, Math.max(60, session.exp - Math.floor(Date.now() / 1000)));
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
