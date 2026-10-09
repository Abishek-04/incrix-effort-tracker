import { z } from "zod";
import { getAccount, listAccounts, publicAccount, reissueSession, requireSession, updateAccount, type AccountRef } from "@/server/auth";
import { HttpError, handle } from "@/server/http";
import { passwordProblem, verifyPassword } from "@/server/password";
import { readJson } from "@/server/request";

export const dynamic = "force-dynamic";

const update = z.object({
  role: z.enum(["admin", "team", "member"]),
  memberId: z.string().min(1).max(100).optional(),
  email: z.email("Enter a valid email address").max(254).optional(),
  newPassword: z.string().max(128).optional(),
  currentPassword: z.string().min(1, "Enter your administrator password").max(128),
});

/** Turns the request into the login it names, rejecting a member without an id. */
function refOf(b: z.infer<typeof update>): AccountRef {
  if (b.role !== "member") return { role: b.role };
  if (!b.memberId) throw new HttpError(400, "Which member's login should change?");
  return { role: "member", memberId: b.memberId };
}

export function GET() {
  return handle(async () => {
    await requireSession("admin");
    return { accounts: (await listAccounts()).map(publicAccount) };
  });
}

export function PUT(req: Request) {
  return handle(async () => {
    const session = await requireSession("admin");
    const b = update.parse(await readJson(req));
    const admin = await getAccount({ role: "admin" });
    if (!admin || !(await verifyPassword(b.currentPassword, admin.passwordHash)))
      throw new HttpError(403, "Your administrator password is incorrect");
    if (!b.email && !b.newPassword) throw new HttpError(400, "Nothing to change");
    if (b.newPassword) {
      const problem = passwordProblem(b.newPassword);
      if (problem) throw new HttpError(400, problem);
    }
    const ref = refOf(b);
    const updated = await updateAccount(ref, { email: b.email, password: b.newPassword });
    if (b.role === session.role && b.memberId === session.mid) await reissueSession(req, updated, session);
    return { accounts: (await listAccounts()).map(publicAccount) };
  });
}
