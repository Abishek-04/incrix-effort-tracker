import { z } from "zod";
import { createMemberAccount, deleteMemberAccount, getAccount, listAccounts, publicAccount, requireSession } from "@/server/auth";
import { getMember } from "@/server/db";
import { HttpError, handle } from "@/server/http";
import { passwordProblem, verifyPassword } from "@/server/password";
import { readJson } from "@/server/request";
import { memberAccountCreate } from "@/server/validation";

export const dynamic = "force-dynamic";

const withConfirmation = memberAccountCreate.extend({ currentPassword: z.string().min(1, "Enter your administrator password").max(128) });

async function assertAdminPassword(currentPassword: string) {
  const admin = await getAccount({ role: "admin" });
  if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash)))
    throw new HttpError(403, "Your administrator password is incorrect");
}

/** Creates a personal login for one team member. */
export function POST(req: Request) {
  return handle(async () => {
    await requireSession("admin");
    const b = withConfirmation.parse(await readJson(req));
    await assertAdminPassword(b.currentPassword);
    const problem = passwordProblem(b.password);
    if (problem) throw new HttpError(400, problem);
    if (!(await getMember(b.memberId))) throw new HttpError(404, "That team member no longer exists");
    await createMemberAccount(b.memberId, b.email, b.password);
    return { accounts: (await listAccounts()).map(publicAccount) };
  });
}

/** Removes a personal login. The member's entries and insights are untouched. */
export function DELETE(req: Request) {
  return handle(async () => {
    await requireSession("admin");
    const b = z.object({ memberId: z.string().min(1).max(100), currentPassword: z.string().min(1).max(128) }).parse(await readJson(req));
    await assertAdminPassword(b.currentPassword);
    await deleteMemberAccount(b.memberId);
    return { accounts: (await listAccounts()).map(publicAccount) };
  });
}
