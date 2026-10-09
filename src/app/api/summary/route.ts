import { requireSession } from "@/server/auth";
import { teamSummary } from "@/server/db";
import { handle } from "@/server/http";
import { monthParam } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * The studio's totals for a month — points, target, entries, how many people logged.
 * Deliberately aggregate only: no figures for any individual, so it is safe for everyone.
 */
export function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const month = monthParam.parse(new URL(req.url).searchParams.get("month"));
    return teamSummary(month);
  });
}
