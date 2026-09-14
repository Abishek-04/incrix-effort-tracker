import { z } from "zod";
import { authenticate, setSessionCookie } from "@/server/auth";
import { handle } from "@/server/http";
import { readJson } from "@/server/request";

const body = z.object({
  email: z.string().trim().min(1, "Enter your email").max(254),
  password: z.string().min(1, "Enter your password").max(128),
  remember: z.boolean().optional(),
});

export function POST(req: Request) {
  return handle(async () => {
    const { email, password, remember } = body.parse(await readJson(req));
    const account = await authenticate(email, password);
    await setSessionCookie(req, account, !!remember);
    return { role: account.role, email: account.email };
  });
}
