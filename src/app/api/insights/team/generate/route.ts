import { z } from "zod";
import { requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { generateTeamInsight } from "@/server/insights";
import { readJson } from "@/server/request";
import { periodKind } from "@/server/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const body = z.object({
  kind: periodKind,
  period: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  adminNote: z.string().trim().max(2000).optional(),
}).refine((v) => (v.kind === "month") === (v.period.length === 7), "Period doesn't match the week/month selected");

export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession("admin");
    const b = body.parse(await readJson(req));
    return { insight: await generateTeamInsight(session, { ...b, adminNote: b.adminNote ?? "" }) };
  });
}
