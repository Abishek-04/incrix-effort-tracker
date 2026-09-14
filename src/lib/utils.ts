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
