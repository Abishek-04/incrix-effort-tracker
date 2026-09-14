import { z } from "zod";
import { reissueSession, requireSession, revokeSessions } from "@/server/auth";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";

const body = z.object({ role: z.enum(["admin", "team"]) });

export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession("admin");
    const { role } = body.parse(await readJson(req));
    const updated = await revokeSessions(role);
    // Signing out "all admin devices" keeps the admin who clicked the button signed in.
    if (role === session.role) await reissueSession(req, updated, session);
  });
}
