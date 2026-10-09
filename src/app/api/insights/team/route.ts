import { z } from "zod";
import { requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { buildTeamSnapshot, getTeamInsight } from "@/server/insights";
import { periodKind } from "@/server/validation";

export const dynamic = "force-dynamic";

const target = z.object({ kind: periodKind, period: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/) })
  .refine((v) => (v.kind === "month") === (v.period.length === 7), "Period doesn't match the week/month selected");

/** The team's figures, and the last review of them if there is one. Administrators only. */
export function GET(req: Request) {
  return handle(async () => {
    await requireSession("admin");
    const q = new URL(req.url).searchParams;
    const { kind, period } = target.parse({ kind: q.get("kind"), period: q.get("period") });
    const [stats, insight] = await Promise.all([buildTeamSnapshot(kind, period), getTeamInsight(kind, period)]);
    return { stats, insight };
  });
}
