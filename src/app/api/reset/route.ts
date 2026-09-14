import { requireSession } from "@/server/auth";
import { resetAll } from "@/server/db";
import { HttpError, handle } from "@/server/http";
import { readJson } from "@/server/request";

export function POST(req: Request) {
  return handle(async () => {
    await requireSession("admin");
    const body = (await readJson(req)) as { confirm?: string };
    if (body?.confirm !== "RESET") throw new HttpError(400, 'Send {"confirm":"RESET"} to reset all data');
    await resetAll();
  });
}
