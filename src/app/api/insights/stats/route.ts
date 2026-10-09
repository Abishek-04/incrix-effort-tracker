import { assertCanAccessMember, requireSession } from "@/server/auth";
import { handle } from "@/server/http";
import { buildSnapshot } from "@/server/insights";
import { insightTarget } from "@/server/validation";

export const dynamic = "force-dynamic";

/** The figures for a member and period, worked out without calling the AI. */
export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession();
    const q = new URL(req.url).searchParams;
    const target = insightTarget.parse({ memberId: q.get("memberId"), kind: q.get("kind"), period: q.get("period") });
    assertCanAccessMember(session, target.memberId);
    const { member, stats } = await buildSnapshot(target.memberId, target.kind, target.period);
    return { memberName: member.name, stats };
  });
}
