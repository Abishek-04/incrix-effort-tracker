import { z } from "zod";
import { requireSession } from "@/server/auth";
import { getEntry } from "@/server/db";
import { HttpError, handle } from "@/server/http";
import { cardFromEntry } from "@/server/jobs";
import { readJson } from "@/server/request";
import { monthParam } from "@/server/validation";

export const dynamic = "force-dynamic";

const body = z.object({ entryId: z.string().min(1).max(100), month: monthParam });

/**
 * Turns work someone already logged into a shared job card, so a second person can join it.
 * Anyone signed in can do this — it's how collaboration gets recorded after the fact.
 */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession();
    const { entryId, month } = body.parse(await readJson(req));
    const entry = await getEntry(month, entryId);
    if (!entry) throw new HttpError(404, "That entry no longer exists");
    return cardFromEntry(entry, session.email);
  });
}
