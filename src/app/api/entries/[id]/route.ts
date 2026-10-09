import { requireSession, scopeOf } from "@/server/auth";
import { deleteEntry, updateEntry } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";
import { entryUpdate, monthParam } from "@/server/validation";

type Ctx = { params: Promise<{ id: string }> };

export function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const session = await requireSession();
    const { id } = await params;
    const { prevMonth, ...input } = entryUpdate.parse(await readJson(req));
    return updateEntry(id, prevMonth, input, scopeOf(session));
  });
}

export function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const session = await requireSession();
    const { id } = await params;
    const month = monthParam.parse(new URL(req.url).searchParams.get("month"));
    return deleteEntry(id, month, scopeOf(session));
  });
}
