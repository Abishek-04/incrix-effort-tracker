// Server-only: builds the performance picture for one member and has Gemini interpret it.
// Every number in an insight is worked out here from the entries; the model only explains them.
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  PRIORITIES, RATINGS, monthsOf, periodLabel, periodRange, periodShort, shiftPeriod, targetForRange, workingDaysInRange,
  type Insight, type InsightAnalysis, type InsightStats, type PeriodKind, type TeamAnalysis, type TeamInsight, type TeamStats,
} from "@/lib/insights";
import type { Entry, Member, Rate, Status } from "@/lib/types";
import { looksLikeSameWork } from "@/lib/rules";
import { QUICK_CLAIM_RATIO, isQuickClaim, parseISO, toISO, todayISO, typicalHoursOf } from "@/lib/utils";
import type { Session } from "@/lib/session";
import { ddb, TABLE, getBootstrap, getMember, insightKey, listEntries, listMemberEntries } from "./db";
import { listJobs } from "./jobs";
import { generateJson, type Schema } from "./gemini";
import { HttpError } from "./http";

const HISTORY_PERIODS = 4;
// The studio works to Indian time, so "logged the same day" is judged in IST wherever the server runs.
const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Kolkata";
const MAX_SAMPLES = 60;
const DESC_LIMIT = 180;

type Item = Record<string, unknown>;
const strip = (item: Item): Insight => {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as unknown as Insight;
};

/* ---------- figures ---------- */

function workingDaysBetweenISO(from: string, to: string) {
  const d = parseISO(from);
  d.setDate(d.getDate() + 1);
  let n = 0;
  while (toISO(d) < to) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** The calendar date an entry was saved on, as YYYY-MM-DD in the studio's timezone. */
const loggedOn = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const logDelay = (e: Entry) => Math.max(0, Math.round((Date.parse(`${loggedOn(e.createdAt)}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 86400000));

function pointsOf(e: Entry, rates: Map<string, Rate>) {
  if (e.points !== undefined) return e.points;
  const r = rates.get(e.typeId);
  return r ? (e.qty || 1) * r.rate : 0;
}

function statsFor(member: Member, kind: PeriodKind, period: string, all: Entry[], rates: Map<string, Rate>): InsightStats {
  const { from, to } = periodRange(kind, period);
  const entries = all.filter((e) => e.date >= from && e.date <= to);
  const wd = workingDaysInRange(from, to);
  const today = todayISO();
  const points = entries.reduce((a, e) => a + pointsOf(e, rates), 0);
  const hours = entries.reduce((a, e) => a + (e.hours ?? 0), 0);
  const target = targetForRange(member.target, from, to);

  const statusCounts = { Done: 0, "In Progress": 0, Blocked: 0 } as Record<Status, number>;
  for (const e of entries) statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;

  const byType = new Map<string, { type: string; dept: string; count: number; points: number }>();
  for (const e of entries) {
    const rate = rates.get(e.typeId);
    const name = rate?.type ?? e.typeName;
    const row = byType.get(name) ?? { type: name, dept: rate?.group || e.dept, count: 0, points: 0 };
    row.count += e.qty || 1;
    row.points += pointsOf(e, rates);
    byType.set(name, row);
  }

  const byClient = new Map<string, number>();
  for (const e of entries) if (e.client.trim()) byClient.set(e.client.trim(), (byClient.get(e.client.trim()) ?? 0) + 1);

  const days = [...new Set(entries.map((e) => e.date))].sort();
  const lastDay = days.length ? days[days.length - 1] : null;
  // Longest run of working days with nothing logged, inside the part of the period that has happened.
  const endOfElapsed = to < today ? to : today;
  let longestGap = 0;
  if (endOfElapsed >= from) {
    const marks = [from, ...days.filter((d) => d <= endOfElapsed), endOfElapsed];
    for (let i = 1; i < marks.length; i++) longestGap = Math.max(longestGap, workingDaysBetweenISO(marks[i - 1], marks[i]));
  }

  const delays = entries.map(logDelay);
  return {
    from, to,
    loggedSameDay: delays.filter((d) => d === 0).length,
    avgLogDelayDays: delays.length ? round(delays.reduce((a, d) => a + d, 0) / delays.length) : 0,
    points: round(points),
    target: round(target),
    attainment: target ? round((points / target) * 100) : 0,
    entries: entries.length,
    hours: round(hours),
    daysLogged: days.length,
    workingDays: wd.total,
    workingDaysElapsed: wd.elapsed,
    avgPointsPerEntry: entries.length ? round(points / entries.length) : 0,
    pointsPerHour: hours ? round(points / hours) : null,
    statusCounts,
    topTypes: [...byType.values()].sort((a, b) => b.points - a.points).slice(0, 8).map((t) => ({ ...t, points: round(t.points) })),
    clients: [...byClient.entries()].map(([name, n]) => ({ name, entries: n })).sort((a, b) => b.entries - a.entries).slice(0, 8),
    history: [],
    lastLogged: lastDay,
    longestGap,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Stats for the period plus the four before it, and the entries behind them. */
export async function buildSnapshot(memberId: string, kind: PeriodKind, period: string) {
  const member = await getMember(memberId);
  if (!member) throw new HttpError(404, "That team member no longer exists");
  const { rates } = await getBootstrap();
  const rateById = new Map(rates.map((r) => [r.id, r]));

  const past = Array.from({ length: HISTORY_PERIODS }, (_, i) => shiftPeriod(kind, period, i - HISTORY_PERIODS));
  const months = [...new Set([...past, period].flatMap((p) => monthsOf(kind, p)))];
  const all = await listMemberEntries(memberId, months);

  const stats = statsFor(member, kind, period, all, rateById);
  stats.history = past.map((key) => {
    const s = statsFor(member, kind, key, all, rateById);
    return { key, label: periodShort(kind, key), points: s.points, target: s.target, entries: s.entries };
  });

  const { from, to } = periodRange(kind, period);
  const entries = all.filter((e) => e.date >= from && e.date <= to);
  return { member, stats, entries, rateById };
}

/* ---------- the model ---------- */

const str = { type: "STRING" } as const;
const ANALYSIS_SCHEMA: Schema = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING", description: "Six to ten words summing up the period." },
    rating: { type: "STRING", enum: [...RATINGS] },
    score: { type: "INTEGER", description: "0-100 overall score for the period." },
    summary: { type: "STRING", description: "2-4 sentences for the manager, quoting the key numbers." },
    strengths: { type: "ARRAY", items: { type: "OBJECT", properties: { title: str, evidence: str }, required: ["title", "evidence"] } },
    weaknesses: { type: "ARRAY", items: { type: "OBJECT", properties: { title: str, evidence: str, impact: str }, required: ["title", "evidence", "impact"] } },
    recommendations: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { action: str, why: str, priority: { type: "STRING", enum: [...PRIORITIES] } }, required: ["action", "why", "priority"] },
    },
    focusNext: { type: "ARRAY", items: str, description: "2-4 short focus points for the next period." },
    employeeMessage: { type: "STRING", description: "The message shown to the employee." },
    caveats: { type: "ARRAY", items: str, description: "Limits of this data, e.g. very few entries. Empty if none." },
  },
  required: ["headline", "rating", "score", "summary", "strengths", "weaknesses", "recommendations", "focusNext", "employeeMessage", "caveats"],
  propertyOrdering: ["headline", "rating", "score", "summary", "strengths", "weaknesses", "recommendations", "focusNext", "employeeMessage", "caveats"],
};

const SYSTEM = `You are a fair, evidence-based performance analyst for Incrix, a small Indian creative and engineering studio.

You review one team member's logged work for one period and explain what the numbers mean.

Rules you must follow:
- Use ONLY the data given to you. Never invent tasks, clients, dates or figures. Every number you quote must appear in the data.
- Points are the studio's unit of effort: each work type is worth a fixed number of points, and a member has a monthly points target. Targets for a week are that monthly target shared across the working days in the week.
- Logged points measure recorded output, not a person's worth. Judge work patterns and behaviours (consistency, mix of work, blocked items, logging discipline), never personality or personal attributes.
- Weigh the manager's own recommendations heavily: they know context the log doesn't hold. If the log contradicts the manager's note, say so plainly and respectfully.
- Some entries note the time that work normally takes. A whole deliverable logged in far less than that may be a token contribution claimed in full — raise it as a question about how work is logged, never as an accusation.
- Each entry records when the work started and when it was saved to the tracker. Work logged days after it happened is a record-keeping habit worth naming, separately from the work itself — entries written from memory days later are also less reliable.
- Low entry counts mean low confidence. Say so in caveats rather than over-reading thin data. Missing logs may mean unlogged work, not idleness — treat it as a logging-discipline observation.
- Be specific and useful: "three of eight reels were premium edits" beats "did good work".
- Indian business English, plain and warm. No emoji, no bullet symbols inside strings, no markdown.

employeeMessage is read by the team member themselves. Address them by their first name, 110-170 words. Acknowledge what went well with specifics, name one or two things to improve, and give clear next steps. Include the manager's guidance as the manager's own words ("Abishek would like you to..."). Be honest but never harsh, and never mention this was written by an AI.`;

function buildPrompt(member: Member, kind: PeriodKind, period: string, stats: InsightStats, entries: Entry[], rateById: Map<string, Rate>, adminNote: string) {
  const log = entries.slice(-MAX_SAMPLES).map((e) => ({
    date: e.date,
    ...(() => {
      const r = rateById.get(e.typeId);
      const typical = r ? typicalHoursOf(r) : null;
      return typical && e.hours ? { typicalHoursForThisWork: typical, muchQuickerThanUsual: e.hours < typical * QUICK_CLAIM_RATIO } : {};
    })(),
    startedAt: e.startTime ?? "not recorded",
    ...(e.jobId ? { sharedJob: `shared deliverable — this person's share is ${Math.round((e.share ?? 0) * 100)}% of it` } : {}),
    loggedOn: loggedOn(e.createdAt),
    loggedAfterDays: logDelay(e),
    work: rateById.get(e.typeId)?.type ?? e.typeName,
    qty: e.qty,
    points: round(pointsOf(e, rateById)),
    hours: e.hours,
    status: e.status,
    client: e.client || undefined,
    what: e.desc.slice(0, DESC_LIMIT),
  }));
  const payload = {
    member: { name: member.name, role: member.role || "Not recorded", department: member.dept, monthlyTarget: member.target },
    period: { kind, label: periodLabel(kind, period), from: stats.from, to: stats.to, complete: stats.workingDaysElapsed >= stats.workingDays },
    figures: {
      pointsLogged: stats.points,
      targetForPeriod: stats.target,
      attainmentPercent: stats.attainment,
      entries: stats.entries,
      hoursRecorded: stats.hours,
      daysLogged: stats.daysLogged,
      workingDays: stats.workingDays,
      workingDaysSoFar: stats.workingDaysElapsed,
      averagePointsPerEntry: stats.avgPointsPerEntry,
      pointsPerHour: stats.pointsPerHour,
      statusCounts: stats.statusCounts,
      longestGapWorkingDays: stats.longestGap,
      lastLogged: stats.lastLogged,
      entriesLoggedOnTheDayOfTheWork: stats.loggedSameDay,
      averageDaysBetweenWorkAndLogging: stats.avgLogDelayDays,
    },
    workMix: stats.topTypes,
    clients: stats.clients,
    previousPeriods: stats.history,
    entryLog: log,
    managerRecommendations: adminNote.trim() || "(the manager did not add any notes this time)",
  };
  return `Analyse this team member's logged work.\n\n${JSON.stringify(payload, null, 1)}`;
}

/* ---------- storage ---------- */

export async function getInsight(memberId: string, kind: PeriodKind, period: string): Promise<Insight | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: insightKey(memberId, kind, period) }));
  return r.Item ? strip(r.Item) : null;
}

export async function listInsights(memberId: string, publishedOnly: boolean): Promise<Insight[]> {
  const r = await ddb.send(
    new QueryCommand({ TableName: TABLE, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": `INSIGHT#${memberId}` } }),
  );
  const all = (r.Items ?? []).map(strip).filter((i) => !publishedOnly || i.published);
  return all.sort((a, b) => b.period.localeCompare(a.period) || a.kind.localeCompare(b.kind));
}

async function save(insight: Insight) {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...insightKey(insight.memberId, insight.kind, insight.period), ...insight } }));
  return insight;
}

/* ---------- generate & publish ---------- */

export async function generateInsight(session: Session, input: { memberId: string; kind: PeriodKind; period: string; adminNote: string }): Promise<Insight> {
  const { member, stats, entries, rateById } = await buildSnapshot(input.memberId, input.kind, input.period);
  const previous = await getInsight(input.memberId, input.kind, input.period);

  const { data, model } = await generateJson<InsightAnalysis>({
    system: SYSTEM,
    prompt: buildPrompt(member, input.kind, input.period, stats, entries, rateById, input.adminNote),
    schema: ANALYSIS_SCHEMA,
    temperature: 0.4,
  });

  const analysis: InsightAnalysis = {
    ...data,
    score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))),
    strengths: data.strengths ?? [],
    weaknesses: data.weaknesses ?? [],
    recommendations: data.recommendations ?? [],
    focusNext: data.focusNext ?? [],
    caveats: data.caveats ?? [],
  };
  const now = new Date().toISOString();

  return save({
    memberId: member.id,
    memberName: member.name,
    kind: input.kind,
    period: input.period,
    stats,
    adminNote: input.adminNote,
    analysis,
    employeeMessage: analysis.employeeMessage,
    model,
    generatedAt: now,
    generatedBy: session.email,
    // Regenerating pulls a published insight back to draft so nothing reaches the employee unreviewed.
    published: false,
    publishedAt: previous?.publishedAt ?? null,
    publishedBy: previous?.publishedBy ?? null,
    updatedAt: now,
  });
}

export async function publishInsight(
  session: Session,
  input: { memberId: string; kind: PeriodKind; period: string; published: boolean; employeeMessage?: string },
): Promise<Insight> {
  const current = await getInsight(input.memberId, input.kind, input.period);
  if (!current) throw new HttpError(404, "Generate the analysis before sharing it");
  const now = new Date().toISOString();
  return save({
    ...current,
    employeeMessage: input.employeeMessage?.trim() || current.employeeMessage,
    published: input.published,
    publishedAt: input.published ? now : current.publishedAt,
    publishedBy: input.published ? session.email : current.publishedBy,
    updatedAt: now,
  });
}

/* ---------- the whole team ---------- */

const TEAM_KEY = (kind: string, period: string) => ({ PK: "INSIGHT#TEAM", SK: `${kind}#${period}` });

/** Every active member's figures for one period, plus how the team worked as a group. */
export async function buildTeamSnapshot(kind: PeriodKind, period: string): Promise<TeamStats> {
  const { team, rates } = await getBootstrap();
  const rateById = new Map(rates.map((r) => [r.id, r]));
  const active = team.filter((m) => m.active);
  const { from, to } = periodRange(kind, period);
  const wd = workingDaysInRange(from, to);

  const past = Array.from({ length: HISTORY_PERIODS }, (_, i) => shiftPeriod(kind, period, i - HISTORY_PERIODS));
  const months = [...new Set([...past, period].flatMap((p) => monthsOf(kind, p)))];
  const all = (await Promise.all(months.map((m) => listEntries(m)))).flat();
  const inRange = (a: string, b: string) => all.filter((e) => e.date >= a && e.date <= b);
  const entries = inRange(from, to);

  const perMember = active.map((m) => {
    const mine = entries.filter((e) => e.memberId === m.id);
    const points = round(mine.reduce((a, e) => a + pointsOf(e, rateById), 0));
    const target = round(targetForRange(m.target, from, to));
    return {
      id: m.id, name: m.name, dept: m.dept, role: m.role || "Not recorded",
      points, target, attainment: target ? round((points / target) * 100) : 0,
      entries: mine.length, hours: round(mine.reduce((a, e) => a + (e.hours ?? 0), 0)),
      daysLogged: new Set(mine.map((e) => e.date)).size,
    };
  }).sort((a, b) => b.points - a.points);

  const points = round(entries.reduce((a, e) => a + pointsOf(e, rateById), 0));
  const target = round(perMember.reduce((a, m) => a + m.target, 0));

  const byDept = new Map<string, { dept: string; points: number; entries: number; share: number }>();
  for (const e of entries) {
    const row = byDept.get(e.dept) ?? { dept: e.dept, points: 0, entries: 0, share: 0 };
    row.points += pointsOf(e, rateById);
    row.entries++;
    byDept.set(e.dept, row);
  }
  const perDept = [...byDept.values()]
    .map((d) => ({ ...d, points: round(d.points), share: points ? Math.round((d.points / points) * 100) : 0 }))
    .sort((a, b) => b.points - a.points);

  const byType = new Map<string, { type: string; dept: string; count: number; points: number }>();
  for (const e of entries) {
    const rate = rateById.get(e.typeId);
    const name = rate?.type ?? e.typeName;
    const row = byType.get(name) ?? { type: name, dept: rate?.group || e.dept, count: 0, points: 0 };
    row.count += e.qty || 1;
    row.points += pointsOf(e, rateById);
    byType.set(name, row);
  }
  const byClient = new Map<string, number>();
  for (const e of entries) if (e.client.trim()) byClient.set(e.client.trim(), (byClient.get(e.client.trim()) ?? 0) + 1);

  const jobs = await listJobs();
  const cards = jobs.filter((j) => j.contributions.some((c) => c.date >= from && c.date <= to));
  const delays = entries.map(logDelay);
  const quick = entries.filter((e) => isQuickClaim(e, rateById.get(e.typeId)));
  let duplicates = 0;
  const counted = new Set<string>();
  for (const a of entries) {
    if (counted.has(a.id) || a.jobId) continue;
    const twin = entries.find((b) => !counted.has(b.id) && looksLikeSameWork(a, b, rateById.get(a.typeId)));
    if (twin) { counted.add(a.id); counted.add(twin.id); duplicates++; }
  }

  return {
    from, to, points, target,
    attainment: target ? round((points / target) * 100) : 0,
    entries: entries.length,
    hours: round(entries.reduce((a, e) => a + (e.hours ?? 0), 0)),
    activeMembers: active.length,
    contributors: perMember.filter((m) => m.entries > 0).length,
    workingDays: wd.total,
    workingDaysElapsed: wd.elapsed,
    perMember,
    perDept,
    topTypes: [...byType.values()].sort((a, b) => b.points - a.points).slice(0, 10).map((t) => ({ ...t, points: round(t.points) })),
    clients: [...byClient.entries()].map(([name, n]) => ({ name, entries: n })).sort((a, b) => b.entries - a.entries).slice(0, 10),
    history: past.map((key) => {
      const r = periodRange(kind, key);
      const es = inRange(r.from, r.to);
      return {
        key, label: periodShort(kind, key),
        points: round(es.reduce((a, e) => a + pointsOf(e, rateById), 0)),
        target: round(active.reduce((a, m) => a + targetForRange(m.target, r.from, r.to), 0)),
        entries: es.length,
      };
    }),
    collaboration: {
      cards: cards.length,
      sharedPoints: round(cards.reduce((a, j) => a + j.points, 0)),
      peopleOnCards: new Set(cards.flatMap((j) => j.contributions.map((c) => c.memberId))).size,
    },
    discipline: {
      loggedSameDay: delays.filter((d) => d === 0).length,
      avgLogDelayDays: delays.length ? round(delays.reduce((a, d) => a + d, 0) / delays.length) : 0,
      blocked: entries.filter((e) => e.status === "Blocked").length,
      quickClaims: quick.length,
      possibleDuplicates: duplicates,
    },
  };
}

const TEAM_SCHEMA: Schema = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING", description: "Six to ten words on how the team did." },
    rating: { type: "STRING", enum: [...RATINGS] },
    score: { type: "INTEGER", description: "0-100 for the team's period." },
    summary: { type: "STRING", description: "3-5 sentences for the owner, quoting the key numbers." },
    strengths: { type: "ARRAY", items: { type: "OBJECT", properties: { title: str, evidence: str }, required: ["title", "evidence"] } },
    risks: { type: "ARRAY", items: { type: "OBJECT", properties: { title: str, evidence: str, impact: str }, required: ["title", "evidence", "impact"] } },
    recommendations: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { action: str, why: str, priority: { type: "STRING", enum: [...PRIORITIES] } }, required: ["action", "why", "priority"] },
    },
    focusNext: { type: "ARRAY", items: str, description: "3-5 short focus points for the team next period." },
    people: {
      type: "ARRAY",
      description: "Up to six people worth a word — carrying the load, blocked, or barely logging. Fair and specific.",
      items: { type: "OBJECT", properties: { name: str, note: str }, required: ["name", "note"] },
    },
    caveats: { type: "ARRAY", items: str, description: "Limits of this data. Empty if none." },
  },
  required: ["headline", "rating", "score", "summary", "strengths", "risks", "recommendations", "focusNext", "people", "caveats"],
  propertyOrdering: ["headline", "rating", "score", "summary", "strengths", "risks", "recommendations", "focusNext", "people", "caveats"],
};

const TEAM_SYSTEM = `${SYSTEM}

This time you are reviewing the whole team for a period, for the owner of the studio — not one person.

Additional rules for a team review:
- Talk about the team as a system: where the output came from, where capacity sat idle, which departments carried the month, which clients absorbed the effort.
- Points measure recorded output. A person with no entries may be doing unlogged work; say "not logging" rather than "not working".
- Name people only where it is useful and fair — someone carrying an unusual share, someone blocked, someone whose logging has stopped. Six people at most, one line each, no rankings of the whole team.
- Collaboration figures come from job cards: work several people shared. Low card use alongside duplicate-looking entries means the team is claiming the same work twice, not that they never collaborate.
- The owner's own recommendations carry the most weight of anything here.`;

function buildTeamPrompt(kind: PeriodKind, period: string, stats: TeamStats, adminNote: string) {
  const payload = {
    period: { kind, label: periodLabel(kind, period), from: stats.from, to: stats.to, complete: stats.workingDaysElapsed >= stats.workingDays },
    figures: {
      pointsLogged: stats.points,
      combinedTarget: stats.target,
      attainmentPercent: stats.attainment,
      entries: stats.entries,
      hoursRecorded: stats.hours,
      peopleOnTheTeam: stats.activeMembers,
      peopleWhoLoggedAnything: stats.contributors,
      workingDays: stats.workingDays,
      workingDaysSoFar: stats.workingDaysElapsed,
    },
    eachPerson: stats.perMember,
    byDepartment: stats.perDept,
    workMix: stats.topTypes,
    clients: stats.clients,
    previousPeriods: stats.history,
    sharedWork: stats.collaboration,
    loggingHabits: stats.discipline,
    ownerRecommendations: adminNote.trim() || "(the owner did not add any notes this time)",
  };
  return `Review how this team performed.\n\n${JSON.stringify(payload, null, 1)}`;
}

export async function getTeamInsight(kind: PeriodKind, period: string): Promise<TeamInsight | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: TEAM_KEY(kind, period) }));
  return r.Item ? (strip(r.Item) as unknown as TeamInsight) : null;
}

export async function generateTeamInsight(session: Session, input: { kind: PeriodKind; period: string; adminNote: string }): Promise<TeamInsight> {
  const stats = await buildTeamSnapshot(input.kind, input.period);
  const { data, model } = await generateJson<TeamAnalysis>({
    system: TEAM_SYSTEM,
    prompt: buildTeamPrompt(input.kind, input.period, stats, input.adminNote),
    schema: TEAM_SCHEMA,
    temperature: 0.4,
  });
  const now = new Date().toISOString();
  const insight: TeamInsight = {
    kind: input.kind, period: input.period, stats, adminNote: input.adminNote,
    analysis: {
      ...data,
      score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))),
      strengths: data.strengths ?? [], risks: data.risks ?? [], recommendations: data.recommendations ?? [],
      focusNext: data.focusNext ?? [], people: data.people ?? [], caveats: data.caveats ?? [],
    },
    model, generatedAt: now, generatedBy: session.email, updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...TEAM_KEY(input.kind, input.period), ...insight } }));
  return insight;
}
