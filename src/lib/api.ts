import type { Role } from "./session";
import type { AccountInfo, Bootstrap, Entry, Member, Rate, Status } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
    // Session expired or was revoked (e.g. password changed) — send the user to sign in again.
    const here = window.location.pathname + window.location.search;
    window.location.assign(`/login?expired=1&next=${encodeURIComponent(here)}`);
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export type EntryDraft = {
  date: string;
  memberId: string;
  typeId: string;
  desc: string;
  client: string;
  qty: number;
  hours: number | null;
  status: Status;
};

export const api = {
  bootstrap: () => req<Bootstrap>("GET", "/api/bootstrap"),
  entries: (month: string) => req<{ entries: Entry[] }>("GET", `/api/entries?month=${month}`),
  createEntry: (d: EntryDraft & { id?: string }) => req<Entry>("POST", "/api/entries", d),
  updateEntry: (id: string, d: EntryDraft & { prevMonth: string }) => req<Entry>("PUT", `/api/entries/${id}`, d),
  deleteEntry: (id: string, month: string) => req<Entry>("DELETE", `/api/entries/${id}?month=${month}`),
  createMember: (m: Partial<Member> & Pick<Member, "name" | "dept" | "target">) => req<Member>("POST", "/api/team", m),
  updateMember: (id: string, patch: Partial<Omit<Member, "id" | "order">>) => req<Member>("PATCH", `/api/team/${id}`, patch),
  deleteMember: (id: string) => req<unknown>("DELETE", `/api/team/${id}`),
  createRate: (r: Partial<Rate> & Pick<Rate, "dept" | "type" | "rate">) => req<Rate>("POST", "/api/rates", r),
  updateRate: (id: string, patch: Partial<Omit<Rate, "id" | "order">>) => req<Rate>("PATCH", `/api/rates/${id}`, patch),
  deleteRate: (id: string) => req<unknown>("DELETE", `/api/rates/${id}`),
  backup: () => req<Record<string, unknown>>("GET", "/api/backup"),
  restore: (data: unknown) => req<{ team: number; rates: number; entries: number }>("POST", "/api/restore", data),
  reset: () => req<unknown>("POST", "/api/reset", { confirm: "RESET" }),
  accounts: () => req<{ accounts: AccountInfo[] }>("GET", "/api/auth/accounts"),
  updateAccount: (b: { role: Role; email?: string; newPassword?: string; currentPassword: string }) =>
    req<{ accounts: AccountInfo[] }>("PUT", "/api/auth/accounts", b),
  revokeSessions: (role: Role) => req<unknown>("POST", "/api/auth/accounts/revoke", { role }),
};
