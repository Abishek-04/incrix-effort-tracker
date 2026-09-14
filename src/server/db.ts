// Server-only data access. Never import this file from a client component.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { defaultRates, defaultTeam } from "@/lib/defaults";
import { ENGINEERING, UIUX, type Bootstrap, type Entry, type Member, type Rate } from "@/lib/types";
import { HttpError } from "./http";
import type { EntryCreate, EntryInput, MemberCreate, MemberPatch, RateCreate, RatePatch } from "./validation";

export const TABLE = process.env.DYNAMODB_TABLE || "incrix-effort-tracker";
const DATA_VERSION = 3;

function makeClient() {
  // Some hosts (e.g. Vercel) reserve AWS_* variable names, so APP_AWS_* take precedence when set.
  // Otherwise the SDK's default chain reads AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
  const region = process.env.APP_AWS_REGION || process.env.AWS_REGION || "ap-south-1";
  const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY;
  const base = new DynamoDBClient({
    region,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  return DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
}

const globalForDb = globalThis as unknown as { __incrixDdb?: DynamoDBDocumentClient };
export const ddb = (globalForDb.__incrixDdb ??= makeClient());

/* ---------- keys ---------- */
const META_KEY = { PK: "META", SK: "CONFIG" };
const memberKey = (id: string) => ({ PK: "TEAM", SK: `MEMBER#${id}` });
const rateKey = (id: string) => ({ PK: "RATE", SK: `TYPE#${id}` });
const entryKey = (month: string, id: string) => ({ PK: `ENTRY#${month}`, SK: `ENTRY#${id}` });

type Item = Record<string, unknown>;
function strip<T>(item: Item): T {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as T;
}

/* ---------- low-level helpers ---------- */
async function queryAll<T>(pk: string): Promise<T[]> {
  const out: T[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: TABLE, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": pk }, ExclusiveStartKey }),
    );
    for (const it of r.Items ?? []) out.push(strip<T>(it));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function scanAll(projectKeysOnly = false): Promise<Item[]> {
  const out: Item[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({ TableName: TABLE, ExclusiveStartKey, ...(projectKeysOnly ? { ProjectionExpression: "PK, SK" } : {}) }),
    );
    out.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function batchWrite(requests: Item[]) {
  for (let i = 0; i < requests.length; i += 25) {
    let pending: Item[] | undefined = requests.slice(i, i + 25);
    for (let attempt = 0; pending?.length; attempt++) {
      if (attempt > 8) throw new Error("DynamoDB batch write did not complete");
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: pending as never } }));
      pending = r.UnprocessedItems?.[TABLE] as Item[] | undefined;
      if (pending?.length) await new Promise((res) => setTimeout(res, 100 * 2 ** attempt));
    }
  }
}
const putRequests = (items: Item[]) => items.map((Item) => ({ PutRequest: { Item } }));

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
export async function getBootstrap(): Promise<Bootstrap> {
  await ensureSeeded();
  const [team, rates] = await Promise.all([queryAll<Member>("TEAM"), queryAll<Rate>("RATE")]);
  return { team: team.sort((a, b) => a.order - b.order), rates: rates.sort((a, b) => a.order - b.order) };
}

/* ---------- entries ---------- */
export async function listEntries(month: string): Promise<Entry[]> {
  const items = await queryAll<Entry>(`ENTRY#${month}`);
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

async function resolveRefs(input: EntryInput) {
  const [m, r] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: memberKey(input.memberId) })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: rateKey(input.typeId) })),
  ]);
  if (!m.Item) throw new HttpError(400, "Selected team member no longer exists");
  if (!r.Item) throw new HttpError(400, "Selected work type no longer exists");
  const rate = strip<Rate>(r.Item);
  return { memberName: String(m.Item.name), typeName: rate.type, dept: rate.dept };
}

export async function createEntry(input: EntryCreate): Promise<Entry> {
  const refs = await resolveRefs(input);
  const now = new Date().toISOString();
  const entry: Entry = {
    id: input.id ?? crypto.randomUUID(),
    date: input.date, memberId: input.memberId, typeId: input.typeId,
    desc: input.desc, client: input.client ?? "", qty: input.qty, hours: input.hours ?? null, status: input.status,
    ...refs, createdAt: now, updatedAt: now,
  };
  try {
    await ddb.send(
      new PutCommand({ TableName: TABLE, Item: { ...entryKey(entry.date.slice(0, 7), entry.id), ...entry }, ConditionExpression: "attribute_not_exists(PK)" }),
    );
  } catch (e) {
    if ((e as Error).name === "ConditionalCheckFailedException") throw new HttpError(409, "Entry already exists");
    throw e;
  }
  return entry;
}

export async function updateEntry(id: string, prevMonth: string, input: EntryInput): Promise<Entry> {
  const old = await ddb.send(new GetCommand({ TableName: TABLE, Key: entryKey(prevMonth, id) }));
  if (!old.Item) throw new HttpError(404, "Entry not found — it may have been deleted");
  const refs = await resolveRefs(input);
  const prev = strip<Entry>(old.Item);
  const entry: Entry = {
    ...prev, date: input.date, memberId: input.memberId, typeId: input.typeId,
    desc: input.desc, client: input.client ?? "", qty: input.qty, hours: input.hours ?? null, status: input.status,
    ...refs, updatedAt: new Date().toISOString(),
  };
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

export async function deleteEntry(id: string, month: string): Promise<Entry> {
  const r = await ddb.send(new DeleteCommand({ TableName: TABLE, Key: entryKey(month, id), ReturnValues: "ALL_OLD" }));
  if (!r.Attributes) throw new HttpError(404, "Entry not found");
  return strip<Entry>(r.Attributes);
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
  const team: Member[] = [], rates: Rate[] = [], entries: Entry[] = [];
  for (const it of items) {
    if (it.PK === "TEAM") team.push(strip<Member>(it));
    else if (it.PK === "RATE") rates.push(strip<Rate>(it));
    else if (String(it.PK).startsWith("ENTRY#")) entries.push(strip<Entry>(it));
  }
  return {
    app: "incrix-effort-tracker", version: DATA_VERSION, exportedAt: new Date().toISOString(),
    team: team.sort((a, b) => a.order - b.order), rates: rates.sort((a, b) => a.order - b.order),
    entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Deletes tracker data. Login accounts (PK "AUTH") are never touched, so reset/restore can't lock anyone out. */
async function wipeAll() {
  const keys = (await scanAll(true)).filter((k) => k.PK !== "AUTH");
  await batchWrite(keys.map((Key) => ({ DeleteRequest: { Key } })));
}

export async function restoreAll(data: { team: Member[]; rates: Rate[]; entries: Entry[] }) {
  await wipeAll();
  await batchWrite(
    putRequests([
      ...data.team.map((m) => ({ ...memberKey(m.id), ...m })),
      ...data.rates.map((r) => ({ ...rateKey(r.id), ...r })),
      ...data.entries.map((e) => ({ ...entryKey(e.date.slice(0, 7), e.id), ...e })),
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
export function normalizeBackup(raw: unknown): { team: Member[]; rates: Rate[]; entries: Entry[] } {
  const d = raw as Record<string, unknown>;
  if (!d || !Array.isArray(d.team) || !Array.isArray(d.entries)) throw new HttpError(400, "That file isn't a valid tracker backup");
  const now = new Date().toISOString();

  // Current format: records already carry ids.
  if (Array.isArray(d.rates)) return { team: d.team as Member[], rates: d.rates as Rate[], entries: d.entries as Entry[] };

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
  return { team, rates, entries };
}
