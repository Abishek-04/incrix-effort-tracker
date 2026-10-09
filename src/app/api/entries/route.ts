import { requireSession, scopeOf } from "@/server/auth";
import { createEntry, departmentView, listEntries } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";
import { entryCreate, monthParam } from "@/server/validation";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession();
    const month = monthParam.parse(new URL(req.url).searchParams.get("month"));
    const scope = scopeOf(session);
    return { month, entries: await listEntries(month, scope ? await departmentView(scope) : null) };
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession();
    return createEntry(entryCreate.parse(await readJson(req)), scopeOf(session));
  }, 201);
}
