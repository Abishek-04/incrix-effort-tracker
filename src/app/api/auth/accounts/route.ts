import { z } from "zod";
import { getAccount, listAccounts, publicAccount, reissueSession, requireSession, updateAccount } from "@/server/auth";
import { HttpError, handle } from "@/server/http";
import { passwordProblem, verifyPassword } from "@/server/password";
import { readJson } from "@/server/request";

export const dynamic = "force-dynamic";

const update = z.object({
  role: z.enum(["admin", "team"]),
  email: z.email("Enter a valid email address").max(254).optional(),
  newPassword: z.string().max(128).optional(),
  currentPassword: z.string().min(1, "Enter your administrator password").max(128),
});

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
    const admin = await getAccount("admin");
    if (!admin || !(await verifyPassword(b.currentPassword, admin.passwordHash)))
      throw new HttpError(403, "Your administrator password is incorrect");
    if (!b.email && !b.newPassword) throw new HttpError(400, "Nothing to change");
    if (b.newPassword) {
      const problem = passwordProblem(b.newPassword);
      if (problem) throw new HttpError(400, problem);
    }
    const updated = await updateAccount(b.role, { email: b.email, password: b.newPassword });
    if (b.role === session.role) await reissueSession(req, updated, session);
    return { accounts: (await listAccounts()).map(publicAccount) };
  });
}
