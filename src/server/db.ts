// Server-only data access. Never import this file from a client component.
import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { defaultRates, defaultTeam } from "@/lib/defaults";
import type { Insight } from "@/lib/insights";
import { MAX_HOURS_PER_DAY } from "@/lib/rules";
import { ENGINEERING, UIUX, type Bootstrap, type Entry, type Job, type Member, type Rate } from "@/lib/types";
import { hoursLabel } from "@/lib/utils";
import {
  TABLE, batchWrite, ddb, entryKey, insightKey, jobKey, memberKey, META_KEY, putRequests, queryAll, rateKey, scanAll, strip, type Item,
} from "./ddb";
import { HttpError } from "./http";
import { applyContribution, detachContribution, getJob } from "./jobs";
import type { EntryCreate, EntryInput, MemberCreate, MemberPatch, RateCreate, RatePatch } from "./validation";

const DATA_VERSION = 3;
// Re-exported so existing server modules keep importing these from here.
export { ddb, TABLE, insightKey };

/* ---------- seeding ---------- */
async function seedDefaults(team = defaultTeam(), rates = defaultRates()) {
  await batchWrite(
    putRequests([
      ...team.map((m) => ({ ...memberKey(m.id), ...m })),
      ...rates.map((r) => ({ ...rateKey(r.id), ...r })),
    ]),
  );
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...META_KEY, version: DATA_VERSION, seededAt: new Date().toISOString() } }));
}

async function ensureSeeded() {
  const meta = await ddb.send(new GetCommand({ TableName: TABLE, Key: META_KEY }));
  if (!meta.Item) await seedDefaults();
}

/* ---------- bootstrap ---------- */
/** `scope` is a member id for personal logins: they only ever see their own record. */
export async function getBootstrap(scope: string | null = null): Promise<Bootstrap> {
  await ensureSeeded();
  const [team, rates] = await Promise.all([queryAll<Member>("TEAM"), queryAll<Rate>("RATE")]);
  const visible = scope ? team.filter((m) => m.id === scope) : team;
  return { team: visible.sort((a, b) => a.order - b.order), rates: rates.sort((a, b) => a.order - b.order) };
}

export async function getEntry(month: string, id: string): Promise<Entry | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: entryKey(month, id) }));
  return r.Item ? strip<Entry>(r.Item) : null;
}

export async function getMember(id: string): Promise<Member | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: memberKey(id) }));
  return r.Item ? strip<Member>(r.Item) : null;
}

/* ---------- entries ---------- */

/** What a team member may read: their own department's work, and their own figures. */
export async function departmentView(memberId: string): Promise<{ own: string; visible: string[] }> {
  const team = await queryAll<Member>("TEAM");
  const me = team.find((m) => m.id === memberId);
  const visible = me ? team.filter((m) => m.dept === me.dept).map((m) => m.id) : [memberId];
  return { own: memberId, visible };
}

/** Everything that lets points be worked out, removed — the work itself stays readable. */
function maskPoints(e: Entry): Entry {
  const { points: _p, pendingPoints: _pp, share: _s, qty: _q, ...rest } = e;
  return { ...rest, qty: 0, masked: true };
}

export async function listEntries(month: string, view: { own: string; visible: string[] } | null = null): Promise<Entry[]> {
  const items = await queryAll<Entry>(`ENTRY#${month}`);
  const seen = view ? items.filter((e) => view.visible.includes(e.memberId)).map((e) => (e.memberId === view.own ? e : maskPoints(e))) : items;
  return seen.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * Deliverables logged across the whole studio in the last fortnight that nobody has shared yet.
 * Everyone sees these, whatever their department — collaboration here crosses department lines,
 * and joining a job needs to know what it is worth.
 */
export async function joinableEntries(from: string, to: string): Promise<Entry[]> {
  const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];
  const pages = await Promise.all(months.map((m) => queryAll<Entry>(`ENTRY#${m}`)));
  return pages
    .flat()
    .filter((e) => !e.jobId && e.date >= from && e.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 120);
}

/**
 * Month totals for the whole studio, with nothing attributable to a person.
 * Everyone signed in may see these; only administrators see the breakdown behind them.
 */
export async function teamSummary(month: string) {
  const [entries, team, rates] = await Promise.all([queryAll<Entry>(`ENTRY#${month}`), queryAll<Member>("TEAM"), queryAll<Rate>("RATE")]);
  const rateById = new Map(rates.map((r) => [r.id, r]));
  const active = team.filter((m) => m.active);
  const points = entries.reduce((a, e) => a + (e.points !== undefined ? e.points : (rateById.get(e.typeId) ? (e.qty || 1) * rateById.get(e.typeId)!.rate : 0)), 0);
  return {
    month,
    points: Math.round(points * 10) / 10,
    target: active.reduce((a, m) => a + m.target, 0),
    entries: entries.length,
    hours: Math.round(entries.reduce((a, e) => a + (e.hours ?? 0), 0) * 10) / 10,
    activeMembers: active.length,
    contributors: new Set(entries.map((e) => e.memberId)).size,
  };
}

/** Entries for one member across a date range, read month by month. */
export async function listMemberEntries(memberId: string, months: string[]): Promise<Entry[]> {
  const pages = await Promise.all(months.map((m) => queryAll<Entry>(`ENTRY#${m}`)));
  return pages.flat().filter((e) => e.memberId === memberId).sort((a, b) => a.date.localeCompare(b.date));
}

async function resolveRefs(input: EntryInput) {
  const [m, r] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: memberKey(input.memberId) })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: rateKey(input.typeId) })),
  ]);
  if (!m.Item) throw new HttpError(400, "Selected team member no longer exists");
  if (!r.Item) throw new HttpError(400, "Selected work type no longer exists");
  const rate = strip<Rate>(r.Item);
  return { memberName: String(m.Item.name), typeName: rate.type, dept: rate.dept, rate };
}

/** Work types priced per hour earn by the clock, so their quantity is the time spent — never a separate claim. */
export const isHourly = (rate: Rate) => /per hour/i.test(rate.unit);
const quantityFor = (rate: Rate, input: EntryInput) => (isHourly(rate) && (input.hours ?? 0) > 0 ? input.hours : input.qty);

/**
 * Contributions inherit the deliverable from their job card, then take their share of its points.
 * A card's own work type wins over whatever the form sent.
 */
async function withJobSplit(entry: Entry, jobId: string | undefined, previousJobId?: string): Promise<Entry> {
  if (previousJobId && previousJobId !== jobId) await detachContribution(previousJobId, entry.id);
  if (!jobId) {
    const { jobId: _j, points: _p, pendingPoints: _pp, share: _s, ...plain } = entry;
    return plain as Entry;
  }
  const job = await getJob(jobId);
  if (!job) throw new HttpError(400, "That job card no longer exists");
  const linked: Entry = { ...entry, jobId, typeId: job.typeId, typeName: job.typeName, dept: job.dept, qty: 1 };
  const { points, pendingPoints, share } = await applyContribution(jobId, linked);
  return { ...linked, points, pendingPoints, share };
}

/** Rule 2 — a day has a limit, so hours can't be invented to inflate points or a card share. */
async function assertDayWithinLimit(input: EntryInput, exceptId?: string) {
  const hours = input.hours ?? 0;
  if (hours <= 0) return;
  const sameDay = (await listEntries(input.date.slice(0, 7)))
    .filter((e) => e.memberId === input.memberId && e.date === input.date && e.id !== exceptId);
  const already = sameDay.reduce((a, e) => a + (e.hours ?? 0), 0);
  if (already + hours > MAX_HOURS_PER_DAY) {
    throw new HttpError(
      400,
      `That would put ${hoursLabel(already + hours)} on ${input.date} — a day holds ${MAX_HOURS_PER_DAY} hours. ` +
        `${hoursLabel(already)} is already logged.`,
    );
  }
}

export async function createEntry(input: EntryCreate, scope: string | null = null): Promise<Entry> {
  if (scope && input.memberId !== scope) throw new HttpError(403, "You can only log work against your own name");
  const { rate, ...refs } = await resolveRefs(input);
  await assertDayWithinLimit(input);
  const now = new Date().toISOString();
  const draft: Entry = {
    id: input.id ?? crypto.randomUUID(),
    date: input.date, memberId: input.memberId, typeId: input.typeId,
    desc: input.desc, client: input.client ?? "", qty: quantityFor(rate, input), hours: input.hours ?? null, startTime: input.startTime, status: input.status,
    ...refs, createdAt: now, updatedAt: now,
  };
  let entry: Entry;
  try {
    entry = await withJobSplit(draft, input.jobId);
  } catch (e) {
    // The card must not keep a contribution for an entry that was never written.
    if (input.jobId) await detachContribution(input.jobId, draft.id);
    throw e;
  }
  try {
    await ddb.send(
      new PutCommand({ TableName: TABLE, Item: { ...entryKey(entry.date.slice(0, 7), entry.id), ...entry }, ConditionExpression: "attribute_not_exists(PK)" }),
    );
  } catch (e) {
    // Never leave the card holding a contribution whose entry wasn't written.
    if (entry.jobId) await detachContribution(entry.jobId, entry.id);
    if ((e as Error).name === "ConditionalCheckFailedException") throw new HttpError(409, "Entry already exists");
    throw e;
  }
  return entry;
}

export async function updateEntry(id: string, prevMonth: string, input: EntryInput, scope: string | null = null): Promise<Entry> {
  const old = await ddb.send(new GetCommand({ TableName: TABLE, Key: entryKey(prevMonth, id) }));
  if (!old.Item) throw new HttpError(404, "Entry not found — it may have been deleted");
  const prev = strip<Entry>(old.Item);
  if (scope && (prev.memberId !== scope || input.memberId !== scope)) throw new HttpError(403, "You can only change your own entries");
  const { rate, ...refs } = await resolveRefs(input);
  await assertDayWithinLimit(input, id);
  const draft: Entry = {
    ...prev, date: input.date, memberId: input.memberId, typeId: input.typeId,
    desc: input.desc, client: input.client ?? "", qty: quantityFor(rate, input), hours: input.hours ?? null, startTime: input.startTime, status: input.status,
    ...refs, updatedAt: new Date().toISOString(),
  };
  const entry = await withJobSplit(draft, input.jobId, prev.jobId);
  const newMonth = entry.date.slice(0, 7);
  const Item = { ...entryKey(newMonth, id), ...entry };
  if (newMonth === prevMonth) {
    await ddb.send(new PutCommand({ TableName: TABLE, Item }));
  } else {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: TABLE, Key: entryKey(prevMonth, id) } },
          { Put: { TableName: TABLE, Item } },
        ],
      }),
    );
  }
  return entry;
}

export async function deleteEntry(id: string, month: string, scope: string | null = null): Promise<Entry> {
  try {
    const r = await ddb.send(
      new DeleteCommand({
        TableName: TABLE, Key: entryKey(month, id), ReturnValues: "ALL_OLD",
        ...(scope ? { ConditionExpression: "memberId = :mid", ExpressionAttributeValues: { ":mid": scope } } : {}),
      }),
    );
    if (!r.Attributes) throw new HttpError(404, "Entry not found");
    const removed = strip<Entry>(r.Attributes);
    if (removed.jobId) await detachContribution(removed.jobId, removed.id);
    return removed;
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") throw new HttpError(403, "You can only delete your own entries");
    throw e;
  }
}

/* ---------- team ---------- */
async function assertUniqueMemberName(name: string, exceptId?: string) {
  const team = await queryAll<Member>("TEAM");
  if (team.some((m) => m.id !== exceptId && m.name.toLowerCase() === name.toLowerCase()))
    throw new HttpError(409, "Another member already has that name");
  return team;
}

export async function createMember(input: MemberCreate): Promise<Member> {
  const team = await assertUniqueMemberName(input.name);
  const member: Member = {
    id: input.id ?? crypto.randomUUID(), name: input.name, role: input.role ?? "", dept: input.dept,
    target: input.target, active: input.active ?? true, order: input.order ?? Math.max(-1, ...team.map((m) => m.order)) + 1,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...memberKey(member.id), ...member } }));
  return member;
}

export async function updateMember(id: string, patch: MemberPatch): Promise<Member> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: memberKey(id) }));
  if (!r.Item) throw new HttpError(404, "Member not found");
  if (patch.name) await assertUniqueMemberName(patch.name, id);
  const member: Member = { ...strip<Member>(r.Item), ...patch };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...memberKey(id), ...member } }));
  return member;
}

export async function deleteMember(id: string) {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: memberKey(id) }));
}

/* ---------- rates ---------- */
async function assertUniqueType(type: string, exceptId?: string) {
  const rates = await queryAll<Rate>("RATE");
  if (rates.some((r) => r.id !== exceptId && r.type.toLowerCase() === type.toLowerCase()))
    throw new HttpError(409, "That work type already exists");
  return rates;
}

export async function createRate(input: RateCreate): Promise<Rate> {
  const rates = await assertUniqueType(input.type);
  const rate: Rate = {
    id: input.id ?? crypto.randomUUID(), dept: input.dept, type: input.type, unit: input.unit ?? "per item", rate: input.rate,
    group: input.group ?? (input.dept === "Software" ? ENGINEERING : ""), order: input.order ?? Math.max(-1, ...rates.map((r) => r.order)) + 1,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...rateKey(rate.id), ...rate } }));
  return rate;
}

export async function updateRate(id: string, patch: RatePatch): Promise<Rate> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: rateKey(id) }));
  if (!r.Item) throw new HttpError(404, "Work type not found");
  if (patch.type) await assertUniqueType(patch.type, id);
  const rate: Rate = { ...strip<Rate>(r.Item), ...patch };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...rateKey(id), ...rate } }));
  return rate;
}

export async function deleteRate(id: string) {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: rateKey(id) }));
}

/* ---------- backup / restore / reset ---------- */
export async function exportAll() {
  const items = await scanAll();
  const team: Member[] = [], rates: Rate[] = [], entries: Entry[] = [], insights: Insight[] = [], jobs: Job[] = [];
  for (const it of items) {
    if (it.PK === "TEAM") team.push(strip<Member>(it));
    else if (it.PK === "RATE") rates.push(strip<Rate>(it));
    else if (String(it.PK).startsWith("ENTRY#")) entries.push(strip<Entry>(it));
    else if (it.PK === "JOB") jobs.push(strip<Job>(it));
    else if (String(it.PK).startsWith("INSIGHT#")) insights.push(strip<Insight>(it));
  }
  return {
    app: "incrix-effort-tracker", version: DATA_VERSION, exportedAt: new Date().toISOString(),
    team: team.sort((a, b) => a.order - b.order), rates: rates.sort((a, b) => a.order - b.order),
    entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
    insights: insights.sort((a, b) => a.period.localeCompare(b.period)),
    jobs: jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

/** Deletes tracker data. Login accounts (PK "AUTH") are never touched, so reset/restore can't lock anyone out. */
async function wipeAll() {
  const keys = (await scanAll(true)).filter((k) => k.PK !== "AUTH");
  await batchWrite(keys.map((Key) => ({ DeleteRequest: { Key } })));
}

export async function restoreAll(data: { team: Member[]; rates: Rate[]; entries: Entry[]; insights?: Insight[]; jobs?: Job[] }) {
  await wipeAll();
  await batchWrite(
    putRequests([
      ...data.team.map((m) => ({ ...memberKey(m.id), ...m })),
      ...data.rates.map((r) => ({ ...rateKey(r.id), ...r })),
      ...data.entries.map((e) => ({ ...entryKey(e.date.slice(0, 7), e.id), ...e })),
      ...(data.insights ?? []).map((i) => ({ ...insightKey(i.memberId, i.kind, i.period), ...i })),
      ...(data.jobs ?? []).map((j) => ({ ...jobKey(j.id), ...j })),
    ]),
  );
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...META_KEY, version: DATA_VERSION, restoredAt: new Date().toISOString() } }));
  return { team: data.team.length, rates: data.rates.length, entries: data.entries.length };
}

export async function resetAll() {
  await wipeAll();
  await seedDefaults();
}

/** Converts a backup from this app, or from the original single-file HTML tracker, into records. */
export function normalizeBackup(raw: unknown): { team: Member[]; rates: Rate[]; entries: Entry[]; insights: Insight[]; jobs: Job[] } {
  const d = raw as Record<string, unknown>;
  if (!d || !Array.isArray(d.team) || !Array.isArray(d.entries)) throw new HttpError(400, "That file isn't a valid tracker backup");
  const now = new Date().toISOString();

  // Current format: records already carry ids.
  if (Array.isArray(d.rates))
    return {
      team: d.team as Member[], rates: d.rates as Rate[], entries: d.entries as Entry[],
      insights: Array.isArray(d.insights) ? (d.insights as Insight[]) : [],
      jobs: Array.isArray(d.jobs) ? (d.jobs as Job[]) : [],
    };

  // Legacy HTML format: names instead of ids, "points" instead of "rates".
  type LegacyMember = { name: string; role?: string; dept: Member["dept"]; target?: number; active?: boolean };
  type LegacyPoint = { dept: Rate["dept"]; type: string; unit?: string; rate?: number; group?: string };
  type LegacyEntry = { date: string; member: string; dept: Entry["dept"]; type: string; desc?: string; client?: string; qty?: number; hours?: number | null; status?: Entry["status"]; sample?: boolean };

  const team: Member[] = (d.team as LegacyMember[]).map((m, order) => ({
    id: crypto.randomUUID(), name: String(m.name), role: m.role ?? "", dept: m.dept, target: Number(m.target) || 0, active: m.active !== false, order,
  }));
  const points = Array.isArray(d.points) ? (d.points as LegacyPoint[]) : null;
  const rates: Rate[] = points
    ? points.map((p, order) => ({
        id: crypto.randomUUID(), dept: p.dept, type: String(p.type), unit: p.unit ?? "per item", rate: Number(p.rate) || 0,
        group: p.group ?? (p.dept === "Software" ? ENGINEERING : ""), order,
      }))
    : defaultRates();
  // Older files predate the UI/UX group — add any missing default UI/UX work types.
  for (const r of defaultRates()) {
    if (r.group === UIUX && !rates.some((x) => x.type === r.type)) rates.push({ ...r, order: rates.length });
  }
  const byName = new Map(team.map((m) => [m.name, m]));
  const byType = new Map(rates.map((r) => [r.type, r]));
  const entries: Entry[] = (d.entries as LegacyEntry[])
    .filter((e) => !e.sample && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .map((e) => ({
      id: crypto.randomUUID(), date: e.date,
      memberId: byName.get(e.member)?.id ?? "", memberName: e.member,
      dept: e.dept, typeId: byType.get(e.type)?.id ?? "", typeName: e.type,
      desc: e.desc ?? "", client: e.client ?? "", qty: Number(e.qty) || 1, hours: e.hours ?? null, status: e.status ?? "Done",
      createdAt: now, updatedAt: now,
    }));
  return { team, rates, entries, insights: [], jobs: [] };
}
