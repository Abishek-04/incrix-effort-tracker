// Creates the DynamoDB table (if missing) and seeds the default team and rate card.
// Run with: npm run db:setup
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateContinuousBackupsCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { defaultRates, defaultTeam } from "../src/lib/defaults.ts";

const TABLE = process.env.DYNAMODB_TABLE || "incrix-effort-tracker";
const region = process.env.APP_AWS_REGION || process.env.AWS_REGION || "ap-south-1";
const client = new DynamoDBClient({ region });
const doc = DynamoDBDocumentClient.from(client);

async function tableExists() {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE }));
    return true;
  } catch (e) {
    if ((e as Error).name === "ResourceNotFoundException") return false;
    throw e;
  }
}

async function createTable() {
  console.log(`Creating table "${TABLE}" in ${region}…`);
  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      DeletionProtectionEnabled: true,
      Tags: [{ Key: "project", Value: "incrix-effort-tracker" }],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 180 }, { TableName: TABLE });
  await client.send(
    new UpdateContinuousBackupsCommand({
      TableName: TABLE,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    }),
  );
  console.log("Table is active · on-demand billing · point-in-time recovery on · deletion protection on");
}

async function batchPut(items: Record<string, unknown>[]) {
  for (let i = 0; i < items.length; i += 25) {
    let pending: Record<string, unknown>[] | undefined = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending?.length; attempt++) {
      const r = await doc.send(new BatchWriteCommand({ RequestItems: { [TABLE]: pending as never } }));
      pending = r.UnprocessedItems?.[TABLE] as Record<string, unknown>[] | undefined;
      if (pending?.length) await new Promise((res) => setTimeout(res, 100 * 2 ** attempt));
    }
  }
}

async function seed() {
  const meta = await doc.send(new GetCommand({ TableName: TABLE, Key: { PK: "META", SK: "CONFIG" } }));
  if (meta.Item) {
    console.log("Already seeded — leaving existing data untouched.");
    return;
  }
  const team = defaultTeam(), rates = defaultRates();
  await batchPut([
    ...team.map((m) => ({ PK: "TEAM", SK: `MEMBER#${m.id}`, ...m })),
    ...rates.map((r) => ({ PK: "RATE", SK: `TYPE#${r.id}`, ...r })),
  ]);
  await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: "META", SK: "CONFIG", version: 3, seededAt: new Date().toISOString() } }));
  console.log(`Seeded ${team.length} team members and ${rates.length} work types.`);
}

if (await tableExists()) console.log(`Table "${TABLE}" already exists.`);
else await createTable();
await seed();
