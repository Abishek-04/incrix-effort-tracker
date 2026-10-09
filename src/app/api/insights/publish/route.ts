import { requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { publishInsight } from "@/server/insights";
import { readJson } from "@/server/request";
import { insightPublish } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Shares the reviewed message with the team member, or takes it back down. */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession("admin");
    const b = insightPublish.parse(await readJson(req));
    return { insight: await publishInsight(session, b) };
  });
}
