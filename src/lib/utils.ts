import type { Entry, Rate } from "./types";

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function parseISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d || 1);
}
export function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function shiftISO(iso: string, days: number) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}
export function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  return toISO(new Date(y, m - 1 + n, 1)).slice(0, 7);
}
export const isoOf = (ym: string, day: number) => `${ym}-${String(day).padStart(2, "0")}`;
export function daysIn(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
export function isWeekend(ym: string, day: number) {
  const w = parseISO(isoOf(ym, day)).getDay();
  return w === 0 || w === 6;
}
export function workingDays(ym: string, upToToday: boolean) {
  const t = todayISO();
  let n = 0;
  for (let d = 1; d <= daysIn(ym); d++) {
    if (upToToday && isoOf(ym, d) > t) break;
    if (!isWeekend(ym, d)) n++;
  }
  return n;
}
/** Working days strictly between two dates. */
export function workingDaysBetween(from: string, to: string) {
  let n = 0;
  const d = parseISO(from), end = parseISO(to);
  d.setDate(d.getDate() + 1);
  while (d < end) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export function fmt(n: number) {
  const v = Number(n) || 0;
  return (Number.isInteger(v) ? v : Math.round(v * 10) / 10).toLocaleString("en-IN");
}
export function monthLabel(ym: string, short = false) {
  return parseISO(`${ym}-01`).toLocaleString("en-IN", { month: short ? "short" : "long", year: "numeric" });
}
export function dateLabel(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return parseISO(iso).toLocaleDateString("en-IN", opts);
}
export function initials(name: string) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
export function sum<T>(arr: T[], f: (x: T) => number) {
  return arr.reduce((a, x) => a + (f(x) || 0), 0);
}
export function uniqueName(base: string, names: string[]) {
  if (!names.includes(base)) return base;
  let i = 2;
  while (names.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function rateMap(rates: Rate[]) {
  return new Map(rates.map((r) => [r.id, r]));
}
export function pointsOf(e: Entry, rates: Map<string, Rate>) {
  // A colleague's entry, seen by a team member: the points were never sent.
  if (e.masked) return 0;
  // A contribution to a job card carries its share of that card's points.
  if (e.points !== undefined) return e.points;
  const r = rates.get(e.typeId);
  return r ? (e.qty || 1) * r.rate : 0;
}

export type Perf = { cls: "" | "ok" | "warn" | "bad"; label: string; icon: "clock" | "check" | "alert"; ratio: number };
export function perfStatus(points: number, target: number, ym: string): Perf {
  const wdT = workingDays(ym, false), wdE = workingDays(ym, true);
  if (!wdE) return { cls: "", label: "Not started", icon: "clock", ratio: 0 };
  const expected = (target * wdE) / wdT, ratio = expected ? points / expected : 1;
  if (ratio >= 0.9) return { cls: "ok", label: "On track", icon: "check", ratio };
  if (ratio >= 0.6) return { cls: "warn", label: "Behind", icon: "clock", ratio };
  return { cls: "bad", label: "At risk", icon: "alert", ratio };
}

export function csvDownload(filename: string, rows: (string | number)[][]) {
  const body = "﻿" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  fileDownload(filename, body, "text/csv");
}
export function fileDownload(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Reads a duration the way people write one: "20m", "1h30", "1:30", "45 min", "1.5", "2 hrs".
 * Returns hours rounded to the nearest minute, or null when it can't be read.
 */
export function parseHours(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let hours: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) hours = Number(m[1]);                                  // 1.5
  else if ((m = s.match(/^(\d+):([0-5]?\d)$/))) hours = Number(m[1]) + Number(m[2]) / 60;         // 1:30
  else if ((m = s.match(/^(\d+(?:\.\d+)?)h(?:ou)?r?s?(?:(\d+(?:\.\d+)?)m?(?:in(?:ute)?s?)?)?$/)))  // 1h, 1h30, 1h30m
    hours = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  else if ((m = s.match(/^(\d+(?:\.\d+)?)m(?:in(?:ute)?s?)?$/))) hours = Number(m[1]) / 60;       // 20m
  if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
  return Math.round(hours * 60) / 60;
}

/** Compact form for an input box: "2", "1h30", "20m". */
export function hoursInput(hours: number) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return !m ? `${h}h` : h ? `${h}h${m}` : `${m}m`;
}

/** "1 h 30 m" for 1.5, "20 m" for 0.333… */
export function hoursLabel(hours: number) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return [h && `${h} h`, m && `${m} m`].filter(Boolean).join(" ") || "0 m";
}

/** Now as "HH:MM", rounded down to five minutes — the default start time on a fresh form. */
export function nowHM() {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The local "HH:MM" of a stored timestamp. */
export function timeOf(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "17 Sept, 4:28 pm" for a stored timestamp. */
export function stampLabel(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Whole days between the day work happened and the day it was logged. */
export function logLagDays(workDate: string, loggedAtISO: string) {
  const logged = new Date(loggedAtISO);
  const loggedDate = toISO(logged);
  return Math.max(0, Math.round((parseISO(loggedDate).getTime() - parseISO(workDate).getTime()) / 86400000));
}

/** Work priced by the clock earns per hour, so time and quantity are the same thing. */
export const isHourlyRate = (rate: Rate) => /per hour/i.test(rate.unit);

/**
 * Work paid for an outcome, not for the effort: a closed deal is worth 60 points because of
 * what it brings in, not because it took forty hours. Time says nothing about these, so they
 * get no expectation unless somebody sets one by hand.
 */
const OUTCOME_UNIT = /deal|lead|enrollment|partnership|milestone|event|pitch|interview|meeting|follow-up|contacts|filing|invoice|collection|purchase|per week|per task|per round|per incident|per post|per release/i;

/**
 * The rate card prices roughly 1.5 points per hour of production work, so a work type with no
 * typical time set falls back to that. Hourly work has no expectation — it is the clock.
 */
export const POINTS_PER_HOUR = 1.5;
export function typicalHoursOf(rate: Rate): number | null {
  if (isHourlyRate(rate)) return null;
  if (rate.typicalHours !== undefined) return rate.typicalHours || null;
  if (OUTCOME_UNIT.test(rate.unit)) return null;
  return Math.round((rate.rate / POINTS_PER_HOUR) * 4) / 4 || null;
}

/** Below this share of the typical time, a full deliverable claim is worth a second look. */
export const QUICK_CLAIM_RATIO = 0.4;

/**
 * True when an entry claims a whole deliverable in far less time than that work normally takes.
 * Contributions to a job card are exempt — those already split by time.
 */
export function isQuickClaim(e: Entry, rate: Rate | undefined) {
  // No time at all (null) predates the rule and isn't a claim; an explicit zero is.
  if (!rate || e.jobId || e.hours == null) return false;
  const typical = typicalHoursOf(rate);
  return typical !== null && e.hours < typical * QUICK_CLAIM_RATIO;
}
