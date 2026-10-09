// The DynamoDB client, table keys and low-level helpers shared by every server module.
// Kept separate from db.ts so job, insight and auth code can use them without import cycles.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.DYNAMODB_TABLE || "incrix-effort-tracker";

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
export const META_KEY = { PK: "META", SK: "CONFIG" };
export const memberKey = (id: string) => ({ PK: "TEAM", SK: `MEMBER#${id}` });
export const rateKey = (id: string) => ({ PK: "RATE", SK: `TYPE#${id}` });
export const entryKey = (month: string, id: string) => ({ PK: `ENTRY#${month}`, SK: `ENTRY#${id}` });
export const jobKey = (id: string) => ({ PK: "JOB", SK: `JOB#${id}` });
export const insightKey = (memberId: string, kind: string, period: string) => ({ PK: `INSIGHT#${memberId}`, SK: `${kind}#${period}` });

export type Item = Record<string, unknown>;

/** Drops the partition and sort keys, leaving the record itself. */
export function strip<T>(item: Item): T {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as T;
}

export async function queryAll<T>(pk: string): Promise<T[]> {
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

export async function scanAll(projectKeysOnly = false): Promise<Item[]> {
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

export async function batchWrite(requests: Item[]) {
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

export const putRequests = (items: Item[]) => items.map((Item) => ({ PutRequest: { Item } }));
