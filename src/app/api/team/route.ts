import { requireSession } from "@/server/auth";
import { createMember } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";
import { memberCreate } from "@/server/validation";

export function POST(req: Request) {
  return handle(async () => {
    await requireSession("admin");
    return createMember(memberCreate.parse(await readJson(req)));
  }, 201);
}
