import { requireSession } from "@/server/auth";
import { exportAll } from "@/server/db";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    await requireSession("admin");
    return exportAll();
  });
}
