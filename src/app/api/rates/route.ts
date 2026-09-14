import { requireSession } from "@/server/auth";
import { createRate } from "@/server/db";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";
import { rateCreate } from "@/server/validation";

export function POST(req: Request) {
  return handle(async () => {
    await requireSession("admin");
    return createRate(rateCreate.parse(await readJson(req)));
  }, 201);
}
