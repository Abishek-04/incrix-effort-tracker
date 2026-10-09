import { deleteMemberAccount, requireSession } from "@/server/auth";
import { deleteMember, updateMember } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";
import { memberPatch } from "@/server/validation";

type Ctx = { params: Promise<{ id: string }> };

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession("admin");
    return updateMember((await params).id, memberPatch.parse(await readJson(req)));
  });
}

export function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession("admin");
    const { id } = await params;
    // Their personal login goes with them, so the email can be reused.
    await deleteMemberAccount(id);
    return deleteMember(id);
  });
}
