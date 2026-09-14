import { requireSession } from "@/server/auth";
import { deleteRate, updateRate } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";
import { ratePatch } from "@/server/validation";

type Ctx = { params: Promise<{ id: string }> };

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession("admin");
    return updateRate((await params).id, ratePatch.parse(await readJson(req)));
  });
}

export function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession("admin");
    return deleteRate((await params).id);
  });
}
