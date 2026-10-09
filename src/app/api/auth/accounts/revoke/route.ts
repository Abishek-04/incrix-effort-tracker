import { z } from "zod";
import { reissueSession, requireSession, revokeSessions } from "@/server/auth";
import { HttpError, handle } from "@/server/http";
import { readJson } from "@/server/request";

const body = z.object({ role: z.enum(["admin", "team", "member"]), memberId: z.string().min(1).max(100).optional() });

export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession("admin");
    const { role, memberId } = body.parse(await readJson(req));
    if (role === "member" && !memberId) throw new HttpError(400, "Which member's login should be signed out?");
    const updated = await revokeSessions(role === "member" ? { role, memberId: memberId! } : { role });
    // Signing out "all admin devices" keeps the admin who clicked the button signed in.
    if (role === session.role && memberId === session.mid) await reissueSession(req, updated, session);
  });
}
