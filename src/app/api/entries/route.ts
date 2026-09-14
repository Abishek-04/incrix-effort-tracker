import { requireSession } from "@/server/auth";
import { createEntry, listEntries } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";
import { entryCreate, monthParam } from "@/server/validation";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const month = monthParam.parse(new URL(req.url).searchParams.get("month"));
    return { month, entries: await listEntries(month) };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    await requireSession();
    return createEntry(entryCreate.parse(await readJson(req)));
  }, 201);
}
