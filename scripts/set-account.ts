// Create or update a login account.
//   npm run auth:set -- admin admin@teamincrix.com     (prompts for the password, hidden)
//   npm run auth:set -- team  team@incrix.com
// Updating an existing login signs out every device using it.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { hashPassword, passwordProblem } from "../src/server/password.ts";

const TABLE = process.env.DYNAMODB_TABLE || "incrix-effort-tracker";
const region = process.env.APP_AWS_REGION || process.env.AWS_REGION || "ap-south-1";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const [role, emailArg] = process.argv.slice(2);
if ((role !== "admin" && role !== "team") || !emailArg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg)) {
  console.error("Usage: npm run auth:set -- <admin|team> <email>");
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();

function prompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "") process.exit(130);
        value = ch === "" ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped input: first line is the password.
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.split(/\r?\n/)[0];
  }
  const first = await prompt("Password: ");
  const second = await prompt("Confirm password: ");
  if (first !== second) {
    console.error("Passwords don't match.");
    process.exit(1);
  }
  return first;
}

const password = await readPassword();
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const others = await doc.send(
  new QueryCommand({ TableName: TABLE, KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)", ExpressionAttributeValues: { ":pk": "AUTH", ":sk": "ACCOUNT#" } }),
);
if ((others.Items ?? []).some((a) => a.role !== role && a.email === email)) {
  console.error(`${email} is already used by the other login.`);
  process.exit(1);
}

const key = { PK: "AUTH", SK: `ACCOUNT#${role}` };
const existing = await doc.send(new GetCommand({ TableName: TABLE, Key: key, ConsistentRead: true }));
const ver = existing.Item ? Number(existing.Item.ver) + 1 : 1;
await doc.send(
  new PutCommand({ TableName: TABLE, Item: { ...key, role, email, passwordHash: await hashPassword(password), ver, updatedAt: new Date().toISOString() } }),
);
console.log(`${existing.Item ? "Updated" : "Created"} ${role} login: ${email}${existing.Item ? " (existing sessions signed out)" : ""}`);
