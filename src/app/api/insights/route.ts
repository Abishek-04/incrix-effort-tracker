import { assertCanAccessMember, requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { getInsight, listInsights } from "@/server/insights";
import { insightTarget } from "@/server/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * With `kind` and `period`: one insight. With `memberId` alone: that member's history.
 * Personal logins only ever see their own, and only once published.
 */
export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession();
    const q = new URL(req.url).searchParams;
    const memberId = z.string().min(1).max(100).parse(q.get("memberId"));
    assertCanAccessMember(session, memberId);
    const publishedOnly = session.role !== "admin";

    if (q.get("kind") || q.get("period")) {
      const target = insightTarget.parse({ memberId, kind: q.get("kind"), period: q.get("period") });
      const insight = await getInsight(target.memberId, target.kind, target.period);
      return { insight: insight && (!publishedOnly || insight.published) ? insight : null };
    }
    return { insights: await listInsights(memberId, publishedOnly) };
  });
}
