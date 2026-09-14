import { requireSession } from "@/server/auth";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const s = await requireSession();
    return { role: s.role, email: s.email, expiresAt: new Date(s.exp * 1000).toISOString() };
  });
}
