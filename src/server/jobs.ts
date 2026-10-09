// Job cards: one deliverable, one set of points, split between everyone who worked on it.
//
// The card is the source of truth for the split. Every time a contribution is added, changed or
// removed, the whole card is recalculated and each contributor's points are stamped back onto
// their entry — so the dashboard, grid, exports and insights need no knowledge of job cards.
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { needsConfirmation } from "@/lib/rules";
import type { Contribution, Entry, Job, JobStatus, Rate } from "@/lib/types";
import { TABLE, ddb, entryKey, jobKey, queryAll, strip } from "./ddb";
import { HttpError } from "./http";

const round = (n: number) => Math.round(n * 100) / 100;

async function rateOf(typeId: string): Promise<Rate> {
  const rates = await queryAll<Rate>("RATE");
  const rate = rates.find((r) => r.id === typeId);
  if (!rate) throw new HttpError(400, "That work type no longer exists");
  return rate;
}

/** The points a card is worth in total — what the deliverable earns, once. */
export const jobPot = (rate: Rate, qty: number) => round((qty || 1) * rate.rate);

/**
 * Splits the pot across contributions by time spent, and writes the result to the card
 * and to every contributor's entry. Entries with no hours recorded share equally.
 */
async function recalculate(job: Job, skipEntryId?: string): Promise<Job> {
  const totalHours = job.contributions.reduce((a, c) => a + (c.hours || 0), 0);
  const n = job.contributions.length;
  const contributions = job.contributions.map((c) => {
    const share = n === 0 ? 0 : totalHours > 0 ? (c.hours || 0) / totalHours : 1 / n;
    return { ...c, share: round(share * 1000) / 1000, points: round(job.points * share) };
  });
  const next: Job = { ...job, contributions, updatedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...jobKey(next.id), ...next } }));

  // Stamp each contributor's share onto their own entry. The entry being written by the caller
  // is skipped — it carries the new values already.
  await Promise.all(
    contributions
      .filter((c) => c.entryId !== skipEntryId)
      .map((c) =>
        ddb.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: entryKey(c.month, c.entryId),
            // "share" is a reserved word in DynamoDB, so every attribute here goes through a name alias.
            // An unconfirmed card counts for nobody: the entry holds 0 points and what it will be worth.
            UpdateExpression: "SET #points = :p, #pending = :q, #share = :s, #updatedAt = :u",
            ConditionExpression: "attribute_exists(PK)",
            ExpressionAttributeNames: { "#points": "points", "#pending": "pendingPoints", "#share": "share", "#updatedAt": "updatedAt" },
            ExpressionAttributeValues: {
              ":p": next.confirmed ? c.points : 0,
              ":q": next.confirmed ? 0 : c.points,
              ":s": c.share, ":u": next.updatedAt,
            },
          }),
        ).catch((e) => {
          // A contribution whose entry has vanished shouldn't block the rest of the split.
          if ((e as Error).name !== "ConditionalCheckFailedException") throw e;
        }),
      ),
  );
  return next;
}

export async function getJob(id: string): Promise<Job | null> {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: jobKey(id), ConsistentRead: true }));
  return r.Item ? strip<Job>(r.Item) : null;
}

export async function listJobs(status?: JobStatus): Promise<Job[]> {
  const jobs = await queryAll<Job>("JOB");
  return jobs
    .filter((j) => !status || j.status === status)
    .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === "Open" ? -1 : 1));
}

export async function createJob(input: { title: string; client?: string; typeId: string; qty?: number }, by: string): Promise<Job> {
  const rate = await rateOf(input.typeId);
  const now = new Date().toISOString();
  const pot = jobPot(rate, input.qty ?? 1);
  const job: Job = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    client: input.client?.trim() ?? "",
    dept: rate.dept,
    typeId: rate.id,
    typeName: rate.type,
    qty: input.qty ?? 1,
    status: "Open",
    points: pot,
    // Anything small enough confirms itself; the rest waits for an administrator.
    confirmed: !needsConfirmation(pot),
    confirmedBy: needsConfirmation(pot) ? null : "automatic",
    confirmedAt: needsConfirmation(pot) ? null : now,
    contributions: [],
    createdBy: by,
    createdAt: now,
    closedAt: null,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: { ...jobKey(job.id), ...job } }));
  return job;
}

export async function updateJob(id: string, patch: { title?: string; client?: string; typeId?: string; qty?: number; status?: JobStatus }): Promise<Job> {
  const job = await getJob(id);
  if (!job) throw new HttpError(404, "That job card no longer exists");
  const rate = patch.typeId && patch.typeId !== job.typeId ? await rateOf(patch.typeId) : null;
  const qty = patch.qty ?? job.qty;
  const next: Job = {
    ...job,
    title: patch.title?.trim() || job.title,
    client: patch.client?.trim() ?? job.client,
    ...(rate ? { typeId: rate.id, typeName: rate.type, dept: rate.dept } : {}),
    qty,
    status: patch.status ?? job.status,
    closedAt: patch.status === "Done" ? (job.closedAt ?? new Date().toISOString()) : patch.status === "Open" ? null : job.closedAt,
  };
  // The pot changes whenever the deliverable or its quantity does — e.g. a reel upgraded to premium.
  next.points = jobPot(rate ?? (await rateOf(next.typeId)), qty);
  // Changing what the card is worth undoes any confirmation: it has to be looked at again.
  if (next.points !== job.points) {
    const auto = !needsConfirmation(next.points);
    next.confirmed = auto;
    next.confirmedBy = auto ? "automatic" : null;
    next.confirmedAt = auto ? new Date().toISOString() : null;
  }
  return recalculate(next);
}

/** An administrator vouches for the deliverable, and only then do its points start counting. */
export async function confirmJob(id: string, by: string, confirmed: boolean): Promise<Job> {
  const job = await getJob(id);
  if (!job) throw new HttpError(404, "That job card no longer exists");
  const now = new Date().toISOString();
  return recalculate({ ...job, confirmed, confirmedBy: confirmed ? by : null, confirmedAt: confirmed ? now : null });
}

export async function deleteJob(id: string) {
  const job = await getJob(id);
  if (!job) return;
  const live = await pruneMissing(job);
  if (live.contributions.length) throw new HttpError(409, "Remove the logged contributions before deleting this card");
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: jobKey(id) }));
}

/** Drops contributions whose entry has gone, so a half-written card can still be tidied away. */
async function pruneMissing(job: Job): Promise<Job> {
  const checked = await Promise.all(
    job.contributions.map(async (c) => {
      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: entryKey(c.month, c.entryId) }));
      return r.Item ? c : null;
    }),
  );
  const contributions = checked.filter((c): c is Contribution => c !== null);
  return contributions.length === job.contributions.length ? job : recalculate({ ...job, contributions });
}

/**
 * Records one entry as a contribution to a card and returns the entry's own share of the points.
 * Called whenever a contribution entry is created or changed.
 */
export async function applyContribution(jobId: string, entry: Entry): Promise<{ points: number; pendingPoints: number; share: number; job: Job }> {
  const job = await getJob(jobId);
  if (!job) throw new HttpError(400, "That job card no longer exists");
  const already = job.contributions.some((c) => c.entryId === entry.id);
  // A closed card takes no new work, but an existing contribution can still be corrected.
  if (job.status === "Done" && !already) throw new HttpError(409, `“${job.title}” is closed — reopen it to log more work`);

  const month = entry.date.slice(0, 7);
  const mine: Contribution = {
    entryId: entry.id, month, memberId: entry.memberId, memberName: entry.memberName,
    date: entry.date, hours: entry.hours ?? 0, share: 0, points: 0,
  };
  const contributions = [...job.contributions.filter((c) => c.entryId !== entry.id), mine];
  const updated = await recalculate({ ...job, contributions }, entry.id);
  const saved = updated.contributions.find((c) => c.entryId === entry.id)!;
  return {
    points: updated.confirmed ? saved.points : 0,
    pendingPoints: updated.confirmed ? 0 : saved.points,
    share: saved.share,
    job: updated,
  };
}

/**
 * Turns work already logged by one person into a shared card, so a second person can join it.
 * Their claimed points become the card's pot and are re-split by time from that moment on.
 */
export async function cardFromEntry(entry: Entry, by: string): Promise<Job> {
  if (entry.jobId) {
    const existing = await getJob(entry.jobId);
    if (existing) return existing;
  }
  const rate = await rateOf(entry.typeId);
  const pot = jobPot(rate, entry.qty);
  const now = new Date().toISOString();
  const job: Job = {
    id: crypto.randomUUID(),
    title: entry.desc.trim().slice(0, 120) || rate.type,
    client: entry.client,
    dept: rate.dept,
    typeId: rate.id,
    typeName: rate.type,
    qty: entry.qty,
    status: "Open",
    points: pot,
    confirmed: !needsConfirmation(pot),
    confirmedBy: needsConfirmation(pot) ? null : "automatic",
    confirmedAt: needsConfirmation(pot) ? null : now,
    contributions: [{
      entryId: entry.id, month: entry.date.slice(0, 7), memberId: entry.memberId, memberName: entry.memberName,
      date: entry.date, hours: entry.hours ?? 0, share: 1, points: pot,
    }],
    createdBy: by,
    fromEntry: true,
    createdAt: now,
    closedAt: null,
    updatedAt: now,
  };
  const saved = await recalculate(job);
  // The original entry now belongs to the card.
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: entryKey(entry.date.slice(0, 7), entry.id),
    UpdateExpression: "SET jobId = :j, #updatedAt = :u",
    ExpressionAttributeNames: { "#updatedAt": "updatedAt" },
    ExpressionAttributeValues: { ":j": saved.id, ":u": now },
  }));
  return saved;
}

/** Removes an entry from a card (deleted, or moved off the card) and re-splits what's left. */
export async function detachContribution(jobId: string, entryId: string) {
  const job = await getJob(jobId);
  if (!job || !job.contributions.some((c) => c.entryId === entryId)) return;
  const contributions = job.contributions.filter((c) => c.entryId !== entryId);
  // A card that only existed because someone joined goes when the work it held goes.
  if (!contributions.length && job.fromEntry) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: jobKey(job.id) }));
    return;
  }
  await recalculate({ ...job, contributions }, entryId);
}
