// The rules that decide how points can be earned. Shared by the form, the API and the reports,
// so there is exactly one definition of each and no way round it.
//
// Tune the three numbers below; everything else follows from them.
import type { Entry, Rate } from "./types";
import { isHourlyRate } from "./utils";

/** How far back the form looks for work a second person might be joining. */
export const JOIN_WINDOW_DAYS = 14;
/** How close together two entries must be before they look like the same job. */
export const DUPLICATE_WINDOW_DAYS = 7;
/** A card worth more than this needs an administrator's confirmation before its points count. */
export const CONFIRM_ABOVE_POINTS = 5;
/** Nobody logs more than this in a single day, across every entry. */
export const MAX_HOURS_PER_DAY = 14;

/**
 * Rule 1 — one deliverable, one set of points.
 * Work done alone is just logged. The moment a second person works on the same thing, it becomes
 * a job card: the points that were already claimed are split by time instead of claimed twice.
 * A deliverable can be joined; time-priced work can't, because the clock already handles it.
 */
export const canBeShared = (rate: Rate) => !isHourlyRate(rate);

/** Work logged by anyone that a person could plausibly be joining. */
export function isJoinable(e: Entry, rate: Rate | undefined, today: string) {
  if (!rate || !canBeShared(rate)) return false;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 86400000;
  return age >= 0 && age <= JOIN_WINDOW_DAYS;
}

/** Rough word overlap between two descriptions, ignoring the filler. */
const STOP = new Set(["the", "and", "for", "with", "a", "of", "to", "in", "on", "reel", "video", "design", "work", "done", "completed", "added"]);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
export function descriptionOverlap(a: string, b: string) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

/** Work that is meant to happen over and over — rounds, posts, calls. Repeats prove nothing. */
const REPEATABLE_UNIT = /per round|per post|per follow-up|contacts|per invoice|per lead|per enrollment|per fix/i;

/**
 * Two entries that look like the same piece of work: same deliverable, same client or a
 * description that overlaps, and close together in time. A suggestion, never a verdict.
 */
export function looksLikeSameWork(a: Entry, b: Entry, rate: Rate | undefined) {
  if (!rate || !canBeShared(rate) || a.id === b.id) return false;
  if (a.typeId !== b.typeId || a.jobId || b.jobId) return false;
  const apart = Math.abs(Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${b.date}T00:00:00Z`)) / 86400000;
  if (apart > DUPLICATE_WINDOW_DAYS) return false;

  const sameClient = !!a.client.trim() && a.client.trim().toLowerCase() === b.client.trim().toLowerCase();
  const overlap = descriptionOverlap(a.desc, b.desc);
  // One person: only a description that really matches, and never for work meant to repeat —
  // four posters for one client in a week is the job, not a double claim.
  if (a.memberId === b.memberId) return !REPEATABLE_UNIT.test(rate.unit) && overlap >= 0.6;
  // Two people: the same client needs some agreement in wording too, or the wording alone must be strong.
  return (sameClient && overlap >= 0.3) || overlap >= 0.6;
}

/** Rule 3 — a card this valuable doesn't count until someone else has looked at it. */
export const needsConfirmation = (points: number) => points > CONFIRM_ABOVE_POINTS;

/** What an entry is worth once it counts — which is nothing while its card is unconfirmed. */
export const pendingPointsOf = (e: Entry) => (e.points === 0 && e.pendingPoints ? e.pendingPoints : 0);
export const isPending = (e: Entry) => pendingPointsOf(e) > 0;

export const hoursLeftToday = (loggedToday: number) => Math.max(0, MAX_HOURS_PER_DAY - loggedToday);
