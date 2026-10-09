import { requireSession, scopeOf } from "@/server/auth";
import { getBootstrap } from "@/server/db";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const session = await requireSession();
    return getBootstrap(scopeOf(session));
  });
}
