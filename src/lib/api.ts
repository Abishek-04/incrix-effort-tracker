import type { Insight, InsightStats, PeriodKind, TeamInsight, TeamStats } from "./insights";
import type { Role } from "./session";
import type { AccountInfo, Bootstrap, Entry, Job, Member, Rate, Status } from "./types";

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

export type TeamSummary = {
  month: string; points: number; target: number; entries: number; hours: number; activeMembers: number; contributors: number;
};

export type EntryDraft = {
  date: string;
  memberId: string;
  typeId: string;
  desc: string;
  client: string;
  qty: number;
  hours: number;
  startTime: string;
  jobId?: string;
  status: Status;
};

export const api = {
  bootstrap: () => req<Bootstrap>("GET", "/api/bootstrap"),
  summary: (month: string) => req<TeamSummary>("GET", `/api/summary?month=${month}`),
  joinable: (from: string, to: string) => req<{ entries: Entry[] }>("GET", `/api/joinable?from=${from}&to=${to}`),
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
  jobs: (status?: "Open" | "Done") => req<{ jobs: Job[] }>("GET", `/api/jobs${status ? `?status=${status}` : ""}`),
  createJob: (j: { title: string; client?: string; typeId: string; qty?: number }) => req<Job>("POST", "/api/jobs", j),
  cardFromEntry: (entryId: string, month: string) => req<Job>("POST", "/api/jobs/from-entry", { entryId, month }),
  updateJob: (id: string, patch: Partial<Pick<Job, "title" | "client" | "typeId" | "qty" | "status" | "confirmed">>) => req<Job>("PATCH", `/api/jobs/${id}`, patch),
  deleteJob: (id: string) => req<unknown>("DELETE", `/api/jobs/${id}`),
  backup: () => req<Record<string, unknown>>("GET", "/api/backup"),
  restore: (data: unknown) => req<{ team: number; rates: number; entries: number }>("POST", "/api/restore", data),
  reset: () => req<unknown>("POST", "/api/reset", { confirm: "RESET" }),
  accounts: () => req<{ accounts: AccountInfo[] }>("GET", "/api/auth/accounts"),
  updateAccount: (b: { role: Role; memberId?: string; email?: string; newPassword?: string; currentPassword: string }) =>
    req<{ accounts: AccountInfo[] }>("PUT", "/api/auth/accounts", b),
  revokeSessions: (role: Role, memberId?: string) => req<unknown>("POST", "/api/auth/accounts/revoke", { role, memberId }),
  createMemberAccount: (b: { memberId: string; email: string; password: string; currentPassword: string }) =>
    req<{ accounts: AccountInfo[] }>("POST", "/api/auth/accounts/member", b),
  deleteMemberAccount: (b: { memberId: string; currentPassword: string }) =>
    req<{ accounts: AccountInfo[] }>("DELETE", "/api/auth/accounts/member", b),

  insight: (memberId: string, kind: PeriodKind, period: string) =>
    req<{ insight: Insight | null }>("GET", `/api/insights?memberId=${memberId}&kind=${kind}&period=${period}`),
  insightHistory: (memberId: string) => req<{ insights: Insight[] }>("GET", `/api/insights?memberId=${memberId}`),
  insightStats: (memberId: string, kind: PeriodKind, period: string) =>
    req<{ memberName: string; stats: InsightStats }>("GET", `/api/insights/stats?memberId=${memberId}&kind=${kind}&period=${period}`),
  teamInsight: (kind: PeriodKind, period: string) =>
    req<{ stats: TeamStats; insight: TeamInsight | null }>("GET", `/api/insights/team?kind=${kind}&period=${period}`),
  generateTeamInsight: (b: { kind: PeriodKind; period: string; adminNote: string }) =>
    req<{ insight: TeamInsight }>("POST", "/api/insights/team/generate", b),
  generateInsight: (b: { memberId: string; kind: PeriodKind; period: string; adminNote: string }) =>
    req<{ insight: Insight }>("POST", "/api/insights/generate", b),
  publishInsight: (b: { memberId: string; kind: PeriodKind; period: string; published: boolean; employeeMessage?: string }) =>
    req<{ insight: Insight }>("POST", "/api/insights/publish", b),
};
