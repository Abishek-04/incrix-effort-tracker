import { requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { generateInsight } from "@/server/insights";
import { readJson } from "@/server/request";
import { insightGenerate } from "@/server/validation";

export const dynamic = "force-dynamic";
// Gemini can take a while on a full month of entries.
export const maxDuration = 120;

export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession("admin");
    const b = insightGenerate.parse(await readJson(req));
    return { insight: await generateInsight(session, { ...b, adminNote: b.adminNote ?? "" }) };
  });
}
