// Shared types and period maths for AI performance insights. Safe to import from client components.
import type { Status } from "./types";
import { dateLabel, isWeekend, monthLabel, parseISO, toISO, todayISO } from "./utils";

export type PeriodKind = "week" | "month";

/** A period is identified by "YYYY-MM" for a month, or the Monday's date "YYYY-MM-DD" for a week. */
export type Period = { kind: PeriodKind; key: string };

export const RATINGS = ["Outstanding", "Strong", "Steady", "Needs attention", "At risk"] as const;
export type Rating = (typeof RATINGS)[number];
export const PRIORITIES = ["High", "Medium", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Figures worked out from the entries themselves — the AI never calculates these. */
export type InsightStats = {
  from: string;
  to: string;
  points: number;
  target: number;
  attainment: number;
  entries: number;
  hours: number;
  daysLogged: number;
  workingDays: number;
  workingDaysElapsed: number;
  avgPointsPerEntry: number;
  pointsPerHour: number | null;
  statusCounts: Record<Status, number>;
  topTypes: { type: string; dept: string; count: number; points: number }[];
  clients: { name: string; entries: number }[];
  history: { key: string; label: string; points: number; target: number; entries: number }[];
  lastLogged: string | null;
  longestGap: number;
  /** Optional: absent on insights generated before logging times were recorded. */
  loggedSameDay?: number;
  avgLogDelayDays?: number;
};

export type InsightAnalysis = {
  headline: string;
  rating: Rating;
  score: number;
  summary: string;
  strengths: { title: string; evidence: string }[];
  weaknesses: { title: string; evidence: string; impact: string }[];
  recommendations: { action: string; why: string; priority: Priority }[];
  focusNext: string[];
  employeeMessage: string;
  caveats: string[];
};

/** The whole team for one period — the same figures, added up and broken down. */
export type TeamStats = {
  from: string;
  to: string;
  points: number;
  target: number;
  attainment: number;
  entries: number;
  hours: number;
  activeMembers: number;
  contributors: number;
  workingDays: number;
  workingDaysElapsed: number;
  perMember: { id: string; name: string; dept: string; role: string; points: number; target: number; attainment: number; entries: number; hours: number; daysLogged: number }[];
  perDept: { dept: string; points: number; entries: number; share: number }[];
  topTypes: { type: string; dept: string; count: number; points: number }[];
  clients: { name: string; entries: number }[];
  history: { key: string; label: string; points: number; target: number; entries: number }[];
  /** How much of the output came from work more than one person touched. */
  collaboration: { cards: number; sharedPoints: number; peopleOnCards: number };
  /** Habits worth naming: late logging, blocked work, claims that look thin. */
  discipline: { loggedSameDay: number; avgLogDelayDays: number; blocked: number; quickClaims: number; possibleDuplicates: number };
};

export type TeamAnalysis = {
  headline: string;
  rating: Rating;
  score: number;
  summary: string;
  strengths: { title: string; evidence: string }[];
  risks: { title: string; evidence: string; impact: string }[];
  recommendations: { action: string; why: string; priority: Priority }[];
  focusNext: string[];
  /** A short, fair note per person worth mentioning — good or bad. */
  people: { name: string; note: string }[];
  caveats: string[];
};

export type TeamInsight = {
  kind: PeriodKind;
  period: string;
  stats: TeamStats;
  adminNote: string;
  analysis: TeamAnalysis;
  model: string;
  generatedAt: string;
  generatedBy: string;
  updatedAt: string;
};

export type Insight = {
  memberId: string;
  memberName: string;
  kind: PeriodKind;
  period: string;
  stats: InsightStats;
  /** The administrator's own recommendations, fed to the AI as manager input. */
  adminNote: string;
  analysis: InsightAnalysis;
  /** The message the employee sees — starts as the AI's, editable before publishing. */
  employeeMessage: string;
  model: string;
  generatedAt: string;
  generatedBy: string;
  published: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  updatedAt: string;
};

/* ---------- period maths ---------- */

/** The Monday on or before a date. */
export function weekStart(iso: string) {
  const d = parseISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}

export function periodKeyOf(kind: PeriodKind, iso: string) {
  return kind === "month" ? iso.slice(0, 7) : weekStart(iso);
}

export const currentPeriod = (kind: PeriodKind) => periodKeyOf(kind, todayISO());

export function periodRange(kind: PeriodKind, key: string): { from: string; to: string } {
  if (kind === "month") {
    const [y, m] = key.split("-").map(Number);
    return { from: `${key}-01`, to: toISO(new Date(y, m, 0)) };
  }
  const d = parseISO(key);
  d.setDate(d.getDate() + 6);
  return { from: key, to: toISO(d) };
}

export function shiftPeriod(kind: PeriodKind, key: string, n: number) {
  if (kind === "month") {
    const [y, m] = key.split("-").map(Number);
    return toISO(new Date(y, m - 1 + n, 1)).slice(0, 7);
  }
  const d = parseISO(key);
  d.setDate(d.getDate() + n * 7);
  return toISO(d);
}

export function periodLabel(kind: PeriodKind, key: string) {
  if (kind === "month") return monthLabel(key);
  const { from, to } = periodRange(kind, key);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = dateLabel(from, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  return `${start} – ${dateLabel(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Short label for charts and history rows. */
export function periodShort(kind: PeriodKind, key: string) {
  return kind === "month" ? monthLabel(key, true) : dateLabel(periodRange(kind, key).from, { day: "numeric", month: "short" });
}

/** The months a period touches, so entries can be read month by month. */
export function monthsOf(kind: PeriodKind, key: string) {
  const { from, to } = periodRange(kind, key);
  const months = new Set([from.slice(0, 7), to.slice(0, 7)]);
  return [...months];
}

/** Working days in a date range, and how many of those have already happened. */
export function workingDaysInRange(from: string, to: string) {
  const today = todayISO();
  let total = 0, elapsed = 0;
  const d = parseISO(from), end = parseISO(to);
  while (d <= end) {
    const iso = toISO(d);
    if (!isWeekend(iso.slice(0, 7), Number(iso.slice(8)))) {
      total++;
      if (iso <= today) elapsed++;
    }
    d.setDate(d.getDate() + 1);
  }
  return { total, elapsed };
}

/**
 * A member's target for any range, derived from their monthly target:
 * each working day is worth target ÷ (working days of its own month), so weeks that
 * straddle two months are weighted correctly.
 */
export function targetForRange(monthlyTarget: number, from: string, to: string) {
  const perMonth = new Map<string, number>();
  let target = 0;
  const d = parseISO(from), end = parseISO(to);
  while (d <= end) {
    const iso = toISO(d), ym = iso.slice(0, 7);
    if (!isWeekend(ym, Number(iso.slice(8)))) {
      if (!perMonth.has(ym)) perMonth.set(ym, workingDaysInRange(`${ym}-01`, periodRange("month", ym).to).total);
      target += monthlyTarget / (perMonth.get(ym) || 1);
    }
    d.setDate(d.getDate() + 1);
  }
  return target;
}

export const RATING_CLASS: Record<Rating, string> = {
  Outstanding: "ok",
  Strong: "ok",
  Steady: "",
  "Needs attention": "warn",
  "At risk": "bad",
};
