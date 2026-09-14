import { clearSessionCookie } from "@/server/auth";
import { handle } from "@/server/http";

export function POST() {
  return handle(async () => {
    await clearSessionCookie();
  });
}
